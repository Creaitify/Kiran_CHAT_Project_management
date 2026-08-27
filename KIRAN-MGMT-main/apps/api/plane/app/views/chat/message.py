# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import uuid
from datetime import datetime
from datetime import timezone as datetime_timezone

# Django imports
from django.db import IntegrityError
from django.db.models import Q
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.exceptions import ParseError
from rest_framework.response import Response

# Module imports
from plane.app.views.base import BaseViewSet
from plane.app.permissions import ROLE, allow_permission
from plane.db.models import ChatMessage, ChatMessageReaction, ChatRoom, ChatRoomMember, ChatSavedMessage
from plane.app.serializers import ChatMessageCreateSerializer, ChatMessageSerializer


# Matches the client's PAGE_SIZE in lib/paginate.ts. The cap exists so a caller
# cannot ask for the whole room in one request.
CHAT_MESSAGE_PAGE_SIZE = 40
CHAT_MESSAGE_MAX_PAGE_SIZE = 100


def encode_cursor(message):
    """Serialize a row as the client's `encodeCursor` does: `<epoch_ms>:<uuid>`.

    The client mints and compares cursors with this exact string, so the two
    encoders have to agree byte for byte -- see `encodeCursor` in
    `src/lib/chat-types.ts`.
    """
    return f"{int(message.created_at.timestamp() * 1000)}:{message.id}"


def decode_cursor(cursor):
    """Inverse of `encode_cursor`, or None when no cursor was supplied.

    A malformed cursor is a 400 rather than a silently ignored parameter: the
    alternative is handing back page one and looking like the end of history.
    """
    if not cursor:
        return None

    epoch_ms, separator, raw_id = cursor.partition(":")
    if not separator:
        raise ParseError("Invalid cursor parameter.")

    try:
        timestamp = datetime.fromtimestamp(int(epoch_ms) / 1000, tz=datetime_timezone.utc)
        message_id = uuid.UUID(raw_id)
    except (OSError, OverflowError, ValueError):
        raise ParseError("Invalid cursor parameter.")

    return timestamp, message_id


class ChatMessageViewSet(BaseViewSet):
    serializer_class = ChatMessageSerializer
    model = ChatMessage

    def get_queryset(self):
        # Membership is part of the scope, not a check applied afterwards. A
        # caller who is not an active member of the room sees an empty set, so
        # every action below inherits the guard whether or not it asks for it.
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(room_id=self.kwargs.get("room_id"))
            .filter(
                room__members__member=self.request.user,
                room__members__left_at__isnull=True,
                room__members__deleted_at__isnull=True,
            )
            # A queued message is invisible to everyone but its author until the
            # clock passes it.
            .filter(Q(scheduled_for__isnull=True) | Q(scheduled_for__lte=timezone.now()) | Q(sender=self.request.user))
            .select_related("sender", "forwarded_from")
            .prefetch_related("reactions")
        )

    def get_room(self):
        """The room this request is scoped to, or ObjectDoesNotExist -> 404.

        A room the caller has left is deliberately indistinguishable from a room
        that does not exist.
        """
        return ChatRoom.objects.get(
            pk=self.kwargs.get("room_id"),
            workspace__slug=self.kwargs.get("slug"),
            members__member=self.request.user,
            members__left_at__isnull=True,
            members__deleted_at__isnull=True,
        )

    def get_membership(self, room):
        return ChatRoomMember.objects.get(room_id=room.id, member=self.request.user, left_at__isnull=True)

    def is_member_of(self, room_id):
        return ChatRoomMember.objects.filter(
            room_id=room_id,
            room__workspace__slug=self.kwargs.get("slug"),
            member=self.request.user,
            left_at__isnull=True,
        ).exists()

    def get_limit(self, request):
        try:
            limit = int(request.query_params.get("limit", CHAT_MESSAGE_PAGE_SIZE))
        except (TypeError, ValueError):
            raise ParseError("Invalid limit parameter.")
        return max(1, min(limit, CHAT_MESSAGE_MAX_PAGE_SIZE))

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def list(self, request, slug, room_id):
        self.get_room()
        messages = self.get_queryset()

        thread_root = request.query_params.get("thread_root")
        if thread_root:
            messages = messages.filter(thread_root_id=thread_root)
        else:
            # Thread replies live in the thread panel and are never part of the
            # channel transcript.
            messages = messages.filter(thread_root__isnull=True)

        # Newest first, tie-broken by id, matching the (room, -created_at, -id)
        # index so a deep scroll stays one index scan.
        messages = messages.order_by("-created_at", "-id")

        cursor = decode_cursor(request.query_params.get("cursor"))
        if cursor:
            timestamp, message_id = cursor
            # Prefer the anchor row's own timestamp. The cursor carries whole
            # milliseconds while created_at holds microseconds, so paginating
            # off the rounded value would skip anything written in the same
            # millisecond as the anchor.
            created_at = (
                ChatMessage.objects.filter(room_id=room_id, id=message_id)
                .values_list("created_at", flat=True)
                .first()
                or timestamp
            )
            messages = messages.filter(Q(created_at__lt=created_at) | Q(created_at=created_at, id__lt=message_id))

        limit = self.get_limit(request)
        # One row past the page is how has_more is answered without a count().
        page = list(messages[: limit + 1])
        has_more = len(page) > limit
        page = page[:limit]

        return Response(
            {
                "items": ChatMessageSerializer(page, many=True).data,
                "next_cursor": encode_cursor(page[-1]) if has_more and page else None,
                "has_more": has_more,
            },
            status=status.HTTP_200_OK,
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def retrieve(self, request, slug, room_id, pk):
        self.get_room()
        message = self.get_queryset().get(pk=pk)
        return Response(ChatMessageSerializer(message).data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def create(self, request, slug, room_id):
        room = self.get_room()

        # The idempotency lookup runs before validation so a retry of a send
        # that already landed costs one indexed query and cannot fail on a rule
        # that has since changed.
        client_id = (request.data.get("client_id") or "").strip()
        if client_id:
            existing = ChatMessage.objects.filter(room_id=room.id, client_id=client_id).first()
            if existing:
                return Response(ChatMessageSerializer(existing).data, status=status.HTTP_200_OK)

        serializer = ChatMessageCreateSerializer(data=request.data, context={"room": room})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        # The serializer deliberately exempts forwarded_from from its same-room
        # check, so the reachability check belongs here: forwarding must not be
        # a way to read a message out of a room the caller is not in.
        origin = serializer.validated_data.get("forwarded_from")
        if origin and not self.is_member_of(origin.room_id):
            return Response(
                {"error": "You don't have the required permissions."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            message = serializer.save(workspace_id=room.workspace_id, room_id=room.id, sender_id=request.user.id)
        except IntegrityError:
            # Two retries of the same send raced past the lookup above. The
            # unique (room, client_id) constraint is what actually makes this
            # idempotent; the lookup is only the fast path.
            message = ChatMessage.objects.get(room_id=room.id, client_id=serializer.validated_data["client_id"])
            return Response(ChatMessageSerializer(message).data, status=status.HTTP_200_OK)

        return Response(ChatMessageSerializer(message).data, status=status.HTTP_201_CREATED)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def partial_update(self, request, slug, room_id, pk):
        self.get_room()
        message = self.get_queryset().get(pk=pk)

        # Editing is the author's alone -- a room admin may remove a message but
        # may not put words in someone else's mouth.
        if message.sender_id != request.user.id:
            return Response(
                {"error": "You don't have the required permissions."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if message.tombstoned_at:
            return Response({"error": "A deleted message cannot be edited."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = ChatMessageSerializer(message, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        serializer.save(edited_at=timezone.now())
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def destroy(self, request, slug, room_id, pk):
        room = self.get_room()
        message = self.get_queryset().get(pk=pk)

        if message.sender_id != request.user.id and self.get_membership(room).role != ChatRoomMember.Role.ADMIN:
            return Response(
                {"error": "You don't have the required permissions."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # A message still queued has never been seen by anyone but its author,
        # so there is nothing for a tombstone to explain and nothing pointing at
        # it -- you cannot reply to, thread on, or link to a message that was
        # never delivered. Cancelling one removes it. Whoever is allowed to
        # delete it is established above; this only decides how.
        if message.scheduled_for:
            message.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        # Tombstone, not delete: replies point at this row, threads are rooted
        # on it and keyset cursors walk through it. What goes is the content.
        if not message.tombstoned_at:
            message.tombstoned_at = timezone.now()
            message.deleted_by = request.user
            message.content = ""
            message.attachment = None
            message.link_previews = []
            message.save()

        # The tombstoned row is returned rather than a 204 so the client can
        # replace the message in place instead of dropping it out of the list.
        return Response(ChatMessageSerializer(message).data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def send_now(self, request, slug, room_id, pk):
        """Release a queued message ahead of its send time.

        A separate action rather than a writable `scheduled_for`: releasing is
        the only edit to that field anyone is allowed to make, and exposing the
        column would also expose rescheduling into the past, which is a way to
        insert a message above messages people have already read.

        Does the same two things the beat sweep does -- claim now as the send
        time, clear the queue flag -- so a message released by hand and one
        released by the clock are indistinguishable afterwards.
        """
        self.get_room()
        message = self.get_queryset().get(pk=pk)

        if message.sender_id != request.user.id:
            return Response(
                {"error": "You don't have the required permissions."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if message.scheduled_for:
            # `created_at` is `auto_now_add`, which only fires on insert, so
            # assigning it on an existing row sticks.
            message.created_at = timezone.now()
            message.scheduled_for = None
            message.save()

        # Idempotent: releasing an already-released message is a no-op that
        # returns the row, because the client cannot tell whether its first
        # request landed.
        return Response(ChatMessageSerializer(message).data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def reactions(self, request, slug, room_id, pk):
        self.get_room()
        message = self.get_queryset().get(pk=pk)

        emoji = (request.data.get("emoji") or "").strip()
        if not emoji:
            return Response({"error": "emoji is required."}, status=status.HTTP_400_BAD_REQUEST)

        reaction = ChatMessageReaction.objects.filter(message_id=message.id, actor=request.user, emoji=emoji).first()
        if reaction:
            reaction.delete()
        else:
            ChatMessageReaction.objects.create(
                workspace_id=message.workspace_id, message_id=message.id, actor=request.user, emoji=emoji
            )

        # get_queryset prefetches reactions, so `message` is still holding the
        # set as it was before the toggle. Without the re-read the response
        # echoes back exactly the state the caller just asked to change.
        message = self.get_queryset().get(pk=pk)

        # The whole message comes back so the caller re-renders from the grouped
        # `reactions` map rather than patching a count it computed itself.
        return Response(ChatMessageSerializer(message).data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def pin(self, request, slug, room_id, pk):
        self.get_room()
        message = self.get_queryset().get(pk=pk)

        # A pin is room state, not personal state: whoever set it, any member of
        # the room can take it down.
        if message.pinned_at:
            message.pinned_by = None
            message.pinned_at = None
        else:
            message.pinned_by = request.user
            message.pinned_at = timezone.now()
        message.save()

        return Response(ChatMessageSerializer(message).data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def save_message(self, request, slug, room_id, pk):
        self.get_room()
        message = self.get_queryset().get(pk=pk)

        kind = request.data.get("kind") or ChatSavedMessage.Kind.SAVED
        if kind not in ChatSavedMessage.Kind.values:
            return Response({"error": "Invalid kind."}, status=status.HTTP_400_BAD_REQUEST)

        saved = ChatSavedMessage.objects.filter(message_id=message.id, member=request.user, kind=kind).first()
        if saved:
            saved.delete()
        else:
            ChatSavedMessage.objects.create(
                workspace_id=message.workspace_id, message_id=message.id, member=request.user, kind=kind
            )

        # A bookmark is the caller's alone and is not part of the message shape,
        # so the new state is reported on its own rather than on the row.
        return Response(
            {"message_id": str(message.id), "kind": kind, "saved": saved is None},
            status=status.HTTP_200_OK,
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def forward(self, request, slug, room_id, pk):
        self.get_room()
        message = self.get_queryset().get(pk=pk)

        if message.tombstoned_at:
            return Response({"error": "A deleted message cannot be forwarded."}, status=status.HTTP_400_BAD_REQUEST)

        target_ids = []
        for raw_id in request.data.get("target_room_ids") or []:
            try:
                target_ids.append(uuid.UUID(str(raw_id)))
            except ValueError:
                return Response({"error": "target_room_ids must be room ids."}, status=status.HTTP_400_BAD_REQUEST)

        if not target_ids:
            return Response({"error": "target_room_ids is required."}, status=status.HTTP_400_BAD_REQUEST)

        # Silently dropping rooms the caller is not in would make forwarding a
        # way to write into a room they cannot post to, so the set is narrowed
        # to their own memberships before anything is created.
        targets = ChatRoom.objects.filter(
            pk__in=target_ids,
            workspace__slug=slug,
            members__member=request.user,
            members__left_at__isnull=True,
            members__deleted_at__isnull=True,
        ).distinct()

        # One idempotency key per target, derived from a single base the client
        # sends, so retrying the whole forward re-resolves to the same rows.
        base_client_id = (request.data.get("client_id") or "").strip() or str(uuid.uuid4())

        forwarded = []
        for target in targets:
            client_id = f"{base_client_id}:{target.id}"
            existing = ChatMessage.objects.filter(room_id=target.id, client_id=client_id).first()
            if existing:
                forwarded.append(existing)
                continue

            forwarded.append(
                ChatMessage.objects.create(
                    workspace_id=target.workspace_id,
                    room_id=target.id,
                    sender_id=request.user.id,
                    client_id=client_id,
                    # The body is copied rather than read through the link so a
                    # forward survives the original being tombstoned.
                    content=message.content,
                    attachment=message.attachment,
                    forwarded_from=message,
                )
            )

        return Response(ChatMessageSerializer(forwarded, many=True).data, status=status.HTTP_201_CREATED)
