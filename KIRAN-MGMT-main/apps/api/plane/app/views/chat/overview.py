# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Chat, summarised for people who are not in chat.

The rail badge and the command palette both live in the shell, outside
`ChatProvider`, and both need to know something about chat before anyone opens
it -- an unread count on the icon, and a list of conversations to jump to. The
chat store cannot answer either: it only exists while the chat app is mounted,
which is exactly when the badge stops mattering.

Neither can `GET /chat/rooms/`. That endpoint returns whole rooms -- every
member, the last message, its reactions -- because the conversation list renders
all of it. Polling it from the rail on every page in the product, to draw a
number, would be the most expensive request in the shell.

So: one small endpoint, one poll, two consumers. `useChatOverview` on the client
shares a single in-flight request between the badge and the palette for the same
reason this endpoint exists.

The unread arithmetic is deliberately *not* reimplemented here -- `mentions_me_q`
is imported from `room.py`. A badge that counted mentions differently from the
conversation list would be a red dot with nothing behind it, and that is the kind
of bug people stop trusting the badge over.
"""

# Django imports
from django.db.models import Count, Q
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseViewSet
from plane.db.models import ChatMessage, ChatRoom, ChatRoomMember

from .room import mentions_me_q

# The palette is a jump list, not a directory. Someone in three hundred rooms
# wants the ones they are actually in the middle of, and the palette's own
# search runs over what it is given -- so this is ordered by recency and cut.
MAX_PALETTE_ROOMS = 50


class ChatOverviewViewSet(BaseViewSet):
    model = ChatRoom

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def retrieve(self, request, slug):
        memberships = list(
            ChatRoomMember.objects.filter(
                workspace__slug=slug,
                member=request.user,
                left_at__isnull=True,
                # A join does not run the related manager, so a soft-deleted room
                # would otherwise keep contributing to the badge forever.
                room__deleted_at__isnull=True,
                room__archived_at__isnull=True,
            )
            .select_related("room")
            # `_title` walks a direct room's members. Without this it is a query
            # per room, which is the N+1 this endpoint exists to avoid.
            .prefetch_related("room__members__member")
        )

        if not memberships:
            return Response(
                {"unread": {"total": 0, "mentions": 0}, "rooms": []},
                status=status.HTTP_200_OK,
            )

        now = timezone.now()
        # A queued message is nobody's unread, not even its author's.
        visible = Q(scheduled_for__isnull=True) | Q(scheduled_for__lte=now)

        # One OR-chain rather than a query per room: each room's cutoff is that
        # room's own read marker.
        cutoff = Q()
        for membership in memberships:
            if membership.last_read_at is None:
                cutoff |= Q(room_id=membership.room_id)
            else:
                cutoff |= Q(room_id=membership.room_id, created_at__gt=membership.last_read_at)

        room_ids = [membership.room_id for membership in memberships]
        workspace_ids = {membership.workspace_id for membership in memberships}

        counts = (
            ChatMessage.objects.filter(
                room_id__in=room_ids, thread_root__isnull=True, tombstoned_at__isnull=True
            )
            .filter(visible)
            .exclude(sender_id=request.user.id)
            .filter(cutoff)
            .values("room_id")
            # order_by() clears ChatMessage.Meta.ordering, which would otherwise
            # join created_at to the GROUP BY and give one row per message.
            .annotate(
                total=Count("id"),
                mentions=Count("id", filter=mentions_me_q(request.user.id, workspace_ids)),
            )
            .order_by()
        )
        by_room = {row["room_id"]: row for row in counts}

        # Most recently active first: a jump list is for the conversation you
        # were just in, not the one that happens to be oldest. One indexed query
        # on (room, -created_at, -id), the same index the message list walks.
        last_activity = {
            row["room_id"]: row["created_at"]
            for row in (
                ChatMessage.objects.filter(room_id__in=room_ids, thread_root__isnull=True)
                .filter(visible)
                .order_by("room_id", "-created_at", "-id")
                .distinct("room_id")
                .values("room_id", "created_at")
            )
        }

        ordered = sorted(
            memberships,
            # A room nobody has spoken in falls back to when it was created, so
            # a brand-new conversation is still reachable.
            key=lambda m: last_activity.get(m.room_id) or m.room.created_at,
            reverse=True,
        )[:MAX_PALETTE_ROOMS]

        rooms = [
            {
                "id": str(membership.room_id),
                "title": self._title(membership.room, request.user.id),
                "type": membership.room.type,
                "unread": by_room.get(membership.room_id, {}).get("total", 0),
                "mentions": by_room.get(membership.room_id, {}).get("mentions", 0),
            }
            for membership in ordered
        ]

        return Response(
            {
                "unread": {
                    "total": sum(row["total"] for row in by_room.values()),
                    "mentions": sum(row["mentions"] for row in by_room.values()),
                },
                "rooms": rooms,
            },
            status=status.HTTP_200_OK,
        )

    @staticmethod
    def _title(room, user_id):
        """A name the palette can show without a member directory.

        A direct room has no stored name -- it is called "the other people in
        it", which the chat app renders from a directory it already has. The
        palette has no such directory, and shipping every participant's id so the
        shell can look them up would be handing the caller a join to do. The
        server does it instead, once.
        """
        if room.name:
            return room.name

        others = [
            member.member.display_name or member.member.email or "Someone"
            for member in room.members.all()
            if member.member_id != user_id and member.left_at is None and member.member_id
        ]
        return ", ".join(others) if others else "Empty conversation"
