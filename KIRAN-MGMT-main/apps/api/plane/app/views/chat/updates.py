# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
The chat delta endpoint -- chat's entire real-time transport.

This Django runs under gunicorn + UvicornWorker in production, where sync views
share one thread-sensitive executor per worker: a long-lived SSE response would
not cost one connection, it would stall every other request on that worker. The
service that would have carried websockets (`apps/live`) has never bound its
port. So the transport is a short poll, and everything here exists to make that
poll cheap enough to run every three seconds per connected person.

Two properties are load-bearing:

1. **`server_time` is the next `since`, not a clock reading.** The client passes
   back whatever it was handed last, so skew between its clock and the server's
   can never open a window in which an update is dropped. The value is captured
   *before* the queries run, which means a row written mid-request is re-sent on
   the next poll rather than missed -- duplicates are free, gaps are not.

2. **`truncated` means "poll again now", not "you lost data".** When a page hits
   the cap, `server_time` comes back as the newest row actually returned instead
   of the wall clock, so the next poll resumes exactly where this one stopped.
"""

# Python imports
from datetime import timedelta

# Django imports
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import ChatMessageSerializer, ChatRoomMemberSerializer, ChatRoomSerializer
from plane.app.views.base import BaseViewSet
from plane.db.models import ChatMessage, ChatMessageReaction, ChatRoom, ChatRoomInvite, ChatRoomMember

from .room import room_list_context

# Per entity type. A poll that returns more than this is a client that has been
# away long enough that it should be walking forward in pages, not trying to
# swallow the backlog in one response.
MAX_DELTA_ROWS = 200


class ChatUpdatesViewSet(BaseViewSet):
    serializer_class = ChatMessageSerializer
    model = ChatMessage
    # Deliberately NOT on the read replica, despite being the highest-volume
    # read in the app. Your own message must be in the very next poll after you
    # send it; replica lag would make it vanish and come back, which reads as a
    # bug no matter how briefly it lasts.
    use_read_replica = False

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def list(self, request, slug):
        # Captured first, deliberately. See the module docstring: a row written
        # between here and the queries below is re-sent, never skipped.
        server_time = timezone.now()

        since = request.query_params.get("since")
        if not since:
            # The bootstrap handshake. The client has no `since` on its first
            # poll, and replaying all of history to find that out would be the
            # most expensive request in the app. It gets a clock to poll with
            # and loads its initial state from the room and message endpoints.
            return Response(
                {
                    "messages": [],
                    "rooms": [],
                    "members": [],
                    "truncated": False,
                    "server_time": server_time,
                },
                status=status.HTTP_200_OK,
            )

        since = parse_datetime(since)
        if since is None:
            return Response(
                {"error": "since must be an ISO 8601 timestamp."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if timezone.is_naive(since):
            since = timezone.make_aware(since)

        # Every query below is scoped to this list, so room membership is
        # checked once rather than re-derived per entity type. Hits the
        # (member, room) index on chat_room_members.
        room_ids = list(
            ChatRoomMember.objects.filter(
                workspace__slug=slug, member=request.user, left_at__isnull=True
            ).values_list("room_id", flat=True)
        )
        if not room_ids:
            return Response(
                {
                    "messages": [],
                    "rooms": [],
                    "members": [],
                    "truncated": False,
                    "server_time": server_time,
                },
                status=status.HTTP_200_OK,
            )

        # A reaction is a row on its own table, so toggling one does not touch
        # the message's `updated_at` and the message would never be re-sent.
        # Collecting the affected ids is cheaper than putting a trigger on the
        # message row, and it keeps emoji live for everyone else in the room.
        reacted_message_ids = list(
            ChatMessageReaction.objects.filter(message__room_id__in=room_ids, updated_at__gte=since).values_list(
                "message_id", flat=True
            )[: MAX_DELTA_ROWS + 1]
        )

        messages = (
            ChatMessage.objects.filter(room_id__in=room_ids)
            .filter(Q(updated_at__gte=since) | Q(id__in=reacted_message_ids))
            # A scheduled message is invisible to everyone but its author until
            # the clock passes it, and the delta is the one place that rule
            # could leak: the row exists and its `updated_at` is current.
            .exclude(Q(scheduled_for__gt=server_time) & ~Q(sender_id=request.user.id))
            .select_related("forwarded_from")
            .prefetch_related("reactions")
            .order_by("updated_at", "id")
        )

        # Minting or revoking a link changes ChatRoomInvite, not ChatRoom, but
        # the client reads the invite off the room -- so a room whose link moved
        # has to ride along in the rooms delta.
        invited_room_ids = list(
            ChatRoomInvite.objects.filter(room_id__in=room_ids, updated_at__gte=since).values_list(
                "room_id", flat=True
            )[: MAX_DELTA_ROWS + 1]
        )

        rooms = (
            ChatRoom.objects.filter(id__in=room_ids)
            .filter(Q(updated_at__gte=since) | Q(id__in=invited_room_ids))
            .select_related("workspace")
            .prefetch_related("members__member__avatar_asset", "invites")
            .order_by("updated_at", "id")
        )

        members = (
            ChatRoomMember.objects.filter(room_id__in=room_ids, updated_at__gte=since)
            .select_related("member", "member__avatar_asset")
            .order_by("updated_at", "id")
        )

        messages, messages_cutoff = self.cap(messages)
        rooms, rooms_cutoff = self.cap(rooms)
        members, members_cutoff = self.cap(members)

        # Resume at the oldest cutoff among the pages that were cut short. The
        # types that were not cut get re-sent from that point, which costs a
        # duplicate merge and guarantees nothing between the two is skipped.
        cutoffs = [cutoff for cutoff in (messages_cutoff, rooms_cutoff, members_cutoff) if cutoff]
        truncated = bool(cutoffs)
        if truncated:
            server_time = min(cutoffs)
            if server_time <= since:
                # Enough rows share one `updated_at` to fill the whole page. Step
                # past it rather than hand back a `since` that cannot advance and
                # would leave the client polling the same page forever.
                server_time = since + timedelta(microseconds=1)

        return Response(
            {
                "messages": ChatMessageSerializer(messages, many=True).data,
                "rooms": ChatRoomSerializer(
                    rooms, many=True, context=room_list_context(rooms, request.user.id)
                ).data,
                "members": ChatRoomMemberSerializer(members, many=True).data,
                "truncated": truncated,
                "server_time": server_time,
            },
            status=status.HTTP_200_OK,
        )

    def cap(self, queryset):
        """Take a page, and report the resume point when there was more behind it."""
        rows = list(queryset[: MAX_DELTA_ROWS + 1])
        if len(rows) <= MAX_DELTA_ROWS:
            return rows, None
        rows = rows[:MAX_DELTA_ROWS]
        return rows, rows[-1].updated_at
