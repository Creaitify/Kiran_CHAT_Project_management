# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import uuid

# Django imports
from django.db import transaction
from django.db.models import Count, OuterRef, Q, Subquery
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.views.base import BaseViewSet
from plane.app.permissions import ROLE, allow_permission
from plane.db.models import ChatMessage, ChatRoom, ChatRoomMember, Workspace, WorkspaceMember
from plane.app.serializers import ChatRoomMemberSerializer, ChatRoomSerializer

# A message that mentions @channel or @here mentions everyone in the room, so it
# counts towards the unread mention badge without naming anyone.
BROADCAST_HANDLES = ["channel", "here"]


def _forbidden(detail):
    return Response({"error": detail}, status=status.HTTP_403_FORBIDDEN)


def _not_found(detail):
    return Response({"error": detail}, status=status.HTTP_404_NOT_FOUND)


def _bad_request(detail):
    return Response({"error": detail}, status=status.HTTP_400_BAD_REQUEST)


def _caller_membership(slug, room_id, user_id):
    """
    The caller's own live member row, or None.

    Every chat action is scoped through this rather than through the request
    body: the URL says which room, the session says who is asking, and nothing
    the client sends participates in either decision. `room__deleted_at` has to
    be checked by hand because a join does not run the related model's manager,
    so a soft-deleted room would otherwise still answer.
    """
    return ChatRoomMember.objects.filter(
        workspace__slug=slug,
        room_id=room_id,
        room__deleted_at__isnull=True,
        member_id=user_id,
        left_at__isnull=True,
    ).first()


def _workspace_member_ids(workspace_id, candidate_ids):
    return set(
        WorkspaceMember.objects.filter(
            workspace_id=workspace_id, member_id__in=candidate_ids, is_active=True
        ).values_list("member_id", flat=True)
    )


def _system_message(workspace_id, room_id, content, actor_id):
    """
    "X added Y", written as a real message so it lands in history, in the
    keyset cursor and in the last-message preview like anything else.
    """
    return ChatMessage(
        workspace_id=workspace_id,
        room_id=room_id,
        sender=None,
        is_system=True,
        # client_id is unique per room and this send has no client to mint one.
        client_id=f"system-{uuid.uuid4().hex}",
        content=content,
        created_by_id=actor_id,
    )


def _promote_successor(room_id):
    """
    Hand the room to its longest-standing remaining member when the last admin
    walks out. A room nobody can rename, invite to or delete is a dead end, and
    the alternative -- refusing to let the last admin leave -- traps them.
    """
    if ChatRoomMember.objects.filter(
        room_id=room_id, left_at__isnull=True, role=ChatRoomMember.Role.ADMIN
    ).exists():
        return
    successor = (
        ChatRoomMember.objects.filter(room_id=room_id, left_at__isnull=True).order_by("created_at").first()
    )
    if successor:
        successor.role = ChatRoomMember.Role.ADMIN
        successor.save(update_fields=["role", "updated_at", "updated_by"])


def room_list_context(rooms, user_id):
    """
    Bulk-resolve `last_message` and `unread` for a page of rooms.

    The N+1 this avoids is the obvious one: a last message and an unread
    count per room is two queries per row. Instead everything is keyed by
    room id up front and handed to the serializer as context, which is why
    `ChatRoomSerializer.get_last_message`/`get_unread` are dictionary reads
    rather than queries.

    Four queries total, whatever the page size:
      1. DISTINCT ON (room_id) for the newest visible message per room.
      2. its reactions, prefetched.
      3. one GROUP BY room_id for the unread total and mention count.
      4. DISTINCT ON (room_id) for the oldest unread message per room.
    The read markers themselves cost nothing -- they are already on the
    member rows the room queryset prefetched.

    Module level rather than a viewset method because `/updates/` needs the same
    context: a room arriving in the delta without it serializes `last_message`
    and `unread` as null, which wipes the badge the client already had.
    """
    room_ids = [room.id for room in rooms]
    if not room_ids:
        return {"last_messages": {}, "unread": {}}

    now = timezone.now()
    # A queued message is nobody's last message and nobody's unread, not
    # even its author's -- the preview is shared surface.
    visible = Q(scheduled_for__isnull=True) | Q(scheduled_for__lte=now)

    last_messages = {
        message.room_id: message
        for message in (
            ChatMessage.objects.filter(room_id__in=room_ids, thread_root__isnull=True)
            .filter(visible)
            .select_related("forwarded_from")
            .prefetch_related("reactions")
            .order_by("room_id", "-created_at", "-id")
            .distinct("room_id")
        )
    }

    # One OR-chain rather than one query per room, because each room's
    # cutoff is that room's own read marker.
    cutoff = Q()
    for room in rooms:
        own = next((m for m in room.members.all() if m.member_id == user_id and m.left_at is None), None)
        marker = own.last_read_at if own else None
        cutoff |= Q(room_id=room.id) if marker is None else Q(room_id=room.id, created_at__gt=marker)

    unread_messages = (
        ChatMessage.objects.filter(room_id__in=room_ids, thread_root__isnull=True, tombstoned_at__isnull=True)
        .filter(visible)
        .exclude(sender_id=user_id)
        .filter(cutoff)
    )
    mentions_me = Q(mentions__users__contains=[str(user_id)]) | Q(mentions__broadcast__in=BROADCAST_HANDLES)

    unread = {}
    # order_by() clears ChatMessage.Meta.ordering, which would otherwise
    # join created_at to the GROUP BY and give one row per message.
    for row in (
        unread_messages.values("room_id")
        .annotate(total=Count("id"), mentions=Count("id", filter=mentions_me))
        .order_by()
    ):
        unread[row["room_id"]] = {"total": row["total"], "mentions": row["mentions"], "first_unread_id": None}

    for room_id, message_id in (
        unread_messages.order_by("room_id", "created_at", "id")
        .distinct("room_id")
        .values_list("room_id", "id")
    ):
        if room_id in unread:
            unread[room_id]["first_unread_id"] = str(message_id)

    for room_id in room_ids:
        unread.setdefault(room_id, {"total": 0, "mentions": 0, "first_unread_id": None})

    return {"last_messages": last_messages, "unread": unread}


class ChatRoomViewSet(BaseViewSet):
    serializer_class = ChatRoomSerializer
    model = ChatRoom

    def get_queryset(self):
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(
                members__member_id=self.request.user.id,
                members__left_at__isnull=True,
                members__deleted_at__isnull=True,
            )
            .select_related("workspace")
            # Member rows are prefetched including the ones with `left_at` set:
            # their past messages still need a resolvable author, and the
            # serializer emits `left_at` so the client can tell them apart.
            # `avatar_asset` rides along because `User.avatar_url` reads it, and
            # without it every avatar in the room list is its own query.
            .prefetch_related("members__member__avatar_asset", "invites")
            .distinct()
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def list(self, request, slug):
        rooms = self.get_queryset()
        if request.query_params.get("archived") != "true":
            rooms = rooms.filter(archived_at__isnull=True)

        return self.paginate(
            request=request,
            queryset=rooms,
            on_results=lambda rooms: ChatRoomSerializer(
                rooms, many=True, context=room_list_context(rooms, request.user.id)
            ).data,
            default_per_page=50,
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def create(self, request, slug):
        workspace = Workspace.objects.get(slug=slug)

        room_type = request.data.get("type", ChatRoom.RoomType.GROUP)
        if room_type not in ChatRoom.RoomType.values:
            return _bad_request("type must be one of group, direct or groupdm.")

        participant_ids = request.data.get("participant_ids") or []
        if not isinstance(participant_ids, list):
            return _bad_request("participant_ids must be a list of user ids.")

        # The caller is a participant whether or not they said so, and never a
        # duplicate of one.
        others = {str(participant_id) for participant_id in participant_ids} - {str(request.user.id)}
        # Membership of the room is bounded by membership of the workspace --
        # this is what stops the request body naming an outsider.
        resolved = _workspace_member_ids(workspace.id, others)
        if len(resolved) != len(others):
            return _bad_request("Every participant must be an active member of this workspace.")

        if room_type == ChatRoom.RoomType.DIRECT:
            if len(resolved) != 1:
                return _bad_request("A direct room has exactly one other participant.")
            existing = self._existing_direct_room(next(iter(resolved)))
            if existing:
                # Dedupe rather than 409: the client asked to talk to someone
                # and the answer to that is the conversation, new or not.
                return Response(ChatRoomSerializer(existing).data, status=status.HTTP_200_OK)
        elif room_type == ChatRoom.RoomType.GROUP and not (request.data.get("name") or "").strip():
            return _bad_request("A group room needs a name.")

        serializer = ChatRoomSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            # `type` is read-only on the serializer -- a direct room must never
            # be able to turn itself into a group later -- so it is set here.
            room = serializer.save(workspace_id=workspace.id, type=room_type)
            # In a direct room there is no asymmetry to model: either person may
            # set the topic or archive it.
            member_role = (
                ChatRoomMember.Role.ADMIN
                if room_type == ChatRoom.RoomType.DIRECT
                else ChatRoomMember.Role.MEMBER
            )
            ChatRoomMember.objects.bulk_create(
                [
                    ChatRoomMember(
                        workspace_id=workspace.id,
                        room_id=room.id,
                        member_id=request.user.id,
                        role=ChatRoomMember.Role.ADMIN,
                        created_by_id=request.user.id,
                    )
                ]
                + [
                    ChatRoomMember(
                        workspace_id=workspace.id,
                        room_id=room.id,
                        member_id=member_id,
                        role=member_role,
                        created_by_id=request.user.id,
                    )
                    for member_id in resolved
                ],
                batch_size=100,
            )

        return Response(
            ChatRoomSerializer(self.get_queryset().get(pk=room.id)).data, status=status.HTTP_201_CREATED
        )

    def _existing_direct_room(self, other_id):
        """
        The direct room holding exactly these two people, if there is one.

        `get_queryset` already pins the caller and the workspace; this adds
        the other participant and a subquery counting the live member rows,
        so a group DM that happens to contain the pair is not mistaken for
        their 1:1.
        """
        active_members = (
            ChatRoomMember.objects.filter(room=OuterRef("pk"), left_at__isnull=True)
            .values("room")
            .annotate(count=Count("id"))
            .values("count")
        )
        return (
            self.get_queryset()
            .filter(type=ChatRoom.RoomType.DIRECT)
            .filter(members__member_id=other_id, members__left_at__isnull=True)
            .annotate(active_member_count=Subquery(active_members))
            .filter(active_member_count=2)
            .first()
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def retrieve(self, request, slug, pk):
        room = self.get_queryset().filter(pk=pk).first()
        if room is None:
            return _not_found("The room does not exist or you are not a member of it.")
        return Response(ChatRoomSerializer(room).data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def partial_update(self, request, slug, pk):
        membership = _caller_membership(slug, pk, request.user.id)
        if membership is None:
            return _forbidden("You are not a member of this room.")

        # Topic is "what are we doing right now" and changes hourly -- it is the
        # one field the /topic slash command lets any member set. Identity and
        # lifecycle (name, photo, colour, description, archived) are the room
        # admin's, per ChatRoomMember.role.
        if membership.role != ChatRoomMember.Role.ADMIN and set(request.data.keys()) - {"topic"}:
            return _forbidden("Only a room admin can change this room.")

        room = self.get_queryset().filter(pk=pk).first()
        if room is None:
            return _not_found("The room does not exist or you are not a member of it.")

        serializer = ChatRoomSerializer(room, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def destroy(self, request, slug, pk):
        membership = _caller_membership(slug, pk, request.user.id)
        if membership is None:
            return _not_found("The room does not exist or you are not a member of it.")
        if membership.role != ChatRoomMember.Role.ADMIN:
            return _forbidden("Only a room admin can delete this room.")

        room = self.get_queryset().filter(pk=pk).first()
        if room is None:
            return _not_found("The room does not exist or you are not a member of it.")

        room.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ChatRoomMemberViewSet(BaseViewSet):
    serializer_class = ChatRoomMemberSerializer
    model = ChatRoomMember

    def get_queryset(self):
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(room_id=self.kwargs.get("room_id"), room__deleted_at__isnull=True)
            .select_related("member", "member__avatar_asset", "room")
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def list(self, request, slug, room_id):
        if _caller_membership(slug, room_id, request.user.id) is None:
            return _forbidden("You are not a member of this room.")
        members = self.get_queryset()
        return Response(ChatRoomMemberSerializer(members, many=True).data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def create(self, request, slug, room_id):
        membership = _caller_membership(slug, room_id, request.user.id)
        if membership is None:
            return _forbidden("You are not a member of this room.")

        room = membership.room
        if room.type == ChatRoom.RoomType.DIRECT:
            # A 1:1 that grew a third person is a group DM, and turning one into
            # the other silently would rewrite what everyone already sees.
            return _bad_request("A direct room cannot take more members.")

        member_ids = request.data.get("member_ids") or []
        if not isinstance(member_ids, list) or not member_ids:
            return _bad_request("member_ids must be a non-empty list of user ids.")

        candidates = {str(member_id) for member_id in member_ids}
        resolved = _workspace_member_ids(room.workspace_id, candidates)
        if len(resolved) != len(candidates):
            return _bad_request("Every member must be an active member of this workspace.")

        existing = {row.member_id: row for row in ChatRoomMember.objects.filter(room_id=room.id)}

        with transaction.atomic():
            added = []
            for member_id in resolved:
                previous = existing.get(member_id)
                if previous is None:
                    added.append(
                        ChatRoomMember.objects.create(
                            workspace_id=room.workspace_id, room_id=room.id, member_id=member_id
                        )
                    )
                elif previous.left_at is not None:
                    # Re-join reuses the row rather than inserting a second one:
                    # (room, member) is unique, and reusing it keeps the read
                    # marker they left with.
                    previous.left_at = None
                    previous.save(update_fields=["left_at", "updated_at", "updated_by"])
                    added.append(previous)

            if added:
                actor = request.user.display_name or request.user.email
                ChatMessage.objects.bulk_create(
                    [
                        _system_message(
                            room.workspace_id,
                            room.id,
                            f"{actor} added {row.member.display_name or row.member.email}",
                            request.user.id,
                        )
                        for row in ChatRoomMember.objects.filter(
                            pk__in=[row.pk for row in added]
                        ).select_related("member")
                    ],
                    batch_size=100,
                )

        return Response(
            ChatRoomMemberSerializer(self.get_queryset(), many=True).data, status=status.HTTP_201_CREATED
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def partial_update(self, request, slug, room_id, pk):
        membership = _caller_membership(slug, room_id, request.user.id)
        if membership is None:
            return _forbidden("You are not a member of this room.")

        target = self.get_queryset().filter(pk=pk).first()
        if target is None:
            return _not_found("The member does not exist in this room.")

        data = {}
        if "role" in request.data:
            if membership.role != ChatRoomMember.Role.ADMIN:
                return _forbidden("Only a room admin can change a member's role.")
            if (
                target.role == ChatRoomMember.Role.ADMIN
                and str(request.data["role"]) != str(ChatRoomMember.Role.ADMIN.value)
                and not ChatRoomMember.objects.filter(
                    room_id=room_id, left_at__isnull=True, role=ChatRoomMember.Role.ADMIN
                )
                .exclude(pk=target.pk)
                .exists()
            ):
                return _bad_request("A room keeps at least one admin.")
            data["role"] = request.data["role"]

        for field in ("notification_level", "is_muted"):
            if field in request.data:
                # Muting and notification level are how loud the room is for one
                # person. Nobody gets to set that for somebody else, admin or not.
                if target.member_id != request.user.id:
                    return _forbidden("You can only change your own notification settings.")
                data[field] = request.data[field]

        if not data:
            return _bad_request("Nothing to update.")

        serializer = ChatRoomMemberSerializer(target, data=data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def destroy(self, request, slug, room_id, pk):
        membership = _caller_membership(slug, room_id, request.user.id)
        if membership is None:
            return _forbidden("You are not a member of this room.")

        target = self.get_queryset().filter(pk=pk, left_at__isnull=True).first()
        if target is None:
            return _not_found("The member does not exist in this room.")

        is_self = target.member_id == request.user.id
        if not is_self and membership.role != ChatRoomMember.Role.ADMIN:
            return _forbidden("Only a room admin can remove a member.")

        with transaction.atomic():
            # The row survives with `left_at` set -- see the model docstring.
            # Deleting it would orphan every message they ever sent.
            target.left_at = timezone.now()
            target.save(update_fields=["left_at", "updated_at", "updated_by"])
            _promote_successor(room_id)

        return Response(status=status.HTTP_204_NO_CONTENT)


class ChatRoomReadMarkerViewSet(BaseViewSet):
    """POST-only: advance the caller's read marker in one room."""

    serializer_class = ChatRoomMemberSerializer
    model = ChatRoomMember

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def create(self, request, slug, room_id):
        membership = _caller_membership(slug, room_id, request.user.id)
        if membership is None:
            return _forbidden("You are not a member of this room.")

        messages = ChatMessage.objects.filter(workspace__slug=slug, room_id=room_id)
        message_id = request.data.get("message_id")
        if message_id:
            message = messages.filter(pk=message_id).first()
            if message is None:
                return _not_found("The message does not exist in this room.")
        else:
            message = messages.order_by("-created_at", "-id").first()

        # A marker only ever moves forward. Two tabs acking out of order, or a
        # stale ack arriving after the user scrolled on, must not mark read
        # messages unread again.
        if message and (membership.last_read_at is None or membership.last_read_at < message.created_at):
            membership.last_read_message = message
            membership.last_read_at = message.created_at
            membership.save(update_fields=["last_read_message", "last_read_at", "updated_at", "updated_by"])

        return Response(ChatRoomMemberSerializer(membership).data, status=status.HTTP_200_OK)
