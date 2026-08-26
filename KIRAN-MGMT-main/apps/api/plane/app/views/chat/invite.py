# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Chat invites.

`invite-rules.ts` already implements the three-way usable/expired/exhausted
check on the client, but as a client-only rule it is a devtools edit away from
being bypassed. This module is the authority: the same ordering -- expiry before
exhaustion -- evaluated against a row the caller cannot reach, under a row lock
so two people redeeming the last use of a link cannot both win.

Room-level authority comes from `ChatRoomMember.role`, not from the workspace
role. `@allow_permission` says you may touch chat at all; being a room admin is
what says you may mint or revoke a link for this particular room.
"""

# Python imports
import uuid
from datetime import timedelta
from secrets import token_urlsafe

# Django imports
from django.db import IntegrityError, transaction
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import ChatRoomInviteSerializer, ChatRoomSerializer
from plane.app.views.base import BaseViewSet
from plane.db.models import ChatMessage, ChatRoom, ChatRoomInvite, ChatRoomMember

# A code is pasted into a chat window and sometimes retyped, so it trades a
# little entropy for legibility. Nine bytes is twelve url-safe characters.
INVITE_CODE_BYTES = 9
# `code` is unique, so a collision is a lost write rather than a wrong answer;
# retrying a couple of times is the whole mitigation.
INVITE_CODE_ATTEMPTS = 5


def parse_positive_int(value, field):
    """Parse an optional positive integer, treating null and absent as unlimited."""
    if value in (None, ""):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field} must be a positive integer.")
    if parsed <= 0:
        raise ValueError(f"{field} must be a positive integer.")
    return parsed


def room_admin_membership(slug, room_id, user):
    """The caller's active admin membership of this room, or None."""
    return ChatRoomMember.objects.filter(
        workspace__slug=slug,
        room_id=room_id,
        member=user,
        role=ChatRoomMember.Role.ADMIN,
        left_at__isnull=True,
    ).first()


class ChatRoomInviteViewSet(BaseViewSet):
    serializer_class = ChatRoomInviteSerializer
    model = ChatRoomInvite

    def get_queryset(self):
        # Scoped by the URL and nothing else: an invite id belonging to another
        # workspace or another room simply is not in this queryset, so there is
        # no code path where a payload could widen the scope.
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(room_id=self.kwargs.get("room_id"))
            .select_related("workspace", "room")
            .distinct()
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def create(self, request, slug, room_id):
        if not room_admin_membership(slug, room_id, request.user):
            return Response(
                {"error": "You don't have the required permissions."},
                status=status.HTTP_403_FORBIDDEN,
            )

        room = ChatRoom.objects.get(pk=room_id, workspace__slug=slug)

        # The client sends a duration rather than an instant, so a link created
        # on a device with a skewed clock still expires when the server says it
        # does. This is also why the serializer is not used for input: its
        # `expires_at` is the stored column, not the submitted field.
        try:
            expires_in_ms = parse_positive_int(request.data.get("expires_in_ms"), "expires_in_ms")
            max_uses = parse_positive_int(request.data.get("max_uses"), "max_uses")
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        expires_at = timezone.now() + timedelta(milliseconds=expires_in_ms) if expires_in_ms else None

        with transaction.atomic():
            # One live link per room. Rotating rather than accumulating makes
            # "revoke the link" unambiguous -- there is only ever one to revoke,
            # and an old link dies the moment a new one is minted.
            ChatRoomInvite.objects.filter(room=room, is_active=True).update(
                is_active=False, updated_at=timezone.now()
            )

            invite = None
            for _ in range(INVITE_CODE_ATTEMPTS):
                try:
                    # Nested atomic so a unique-code collision rolls back only
                    # the failed insert; the deactivation above must survive it.
                    with transaction.atomic():
                        invite = ChatRoomInvite.objects.create(
                            workspace_id=room.workspace_id,
                            room=room,
                            code=token_urlsafe(INVITE_CODE_BYTES),
                            expires_at=expires_at,
                            max_uses=max_uses,
                        )
                    break
                except IntegrityError:
                    continue

        if invite is None:
            return Response(
                {"error": "Could not generate an invite code, please try again."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(ChatRoomInviteSerializer(invite).data, status=status.HTTP_201_CREATED)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def destroy(self, request, slug, room_id, pk):
        if not room_admin_membership(slug, room_id, request.user):
            return Response(
                {"error": "You don't have the required permissions."},
                status=status.HTTP_403_FORBIDDEN,
            )

        invite = self.get_queryset().get(pk=pk)
        # Deactivated, not deleted. The row is the record that a link was once
        # shared, and `uses` is the only trace of how far it travelled.
        invite.is_active = False
        invite.save()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ChatInviteJoinViewSet(BaseViewSet):
    """
    Redeeming a link.

    Mounted outside the room tree, because the whole point of holding a code is
    that you do not yet know the room id it belongs to.
    """

    serializer_class = ChatRoomSerializer
    model = ChatRoom

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def join(self, request, slug, code):
        with transaction.atomic():
            # The lock is what makes `uses` a limit rather than a suggestion:
            # without it, two simultaneous redemptions of a one-use link both
            # read uses=0 and both write uses=1.
            invite = (
                ChatRoomInvite.objects.select_for_update()
                .select_related("room")
                .filter(workspace__slug=slug, code=code, is_active=True)
                .first()
            )
            if invite is None:
                return Response({"error": "This invite link is not valid."}, status=status.HTTP_404_NOT_FOUND)

            # Same ordering as the serializer's `state` and as the client's
            # `inviteIsUsable`: a link that is both expired and exhausted reads
            # as expired, so the three surfaces never disagree about why.
            if invite.expires_at and invite.expires_at <= timezone.now():
                return Response({"error": "This invite link has expired."}, status=status.HTTP_400_BAD_REQUEST)
            if invite.max_uses is not None and invite.uses >= invite.max_uses:
                return Response(
                    {"error": "This invite link has reached its limit."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if invite.room.archived_at:
                return Response({"error": "This room is archived."}, status=status.HTTP_400_BAD_REQUEST)

            membership = ChatRoomMember.objects.filter(room=invite.room, member=request.user).first()
            if membership and membership.left_at is None:
                # Already in. Returning the room rather than an error makes the
                # link idempotent -- clicking it twice lands you in the same
                # place -- and spends no use.
                return Response(self.room_payload(invite.room), status=status.HTTP_200_OK)

            if membership:
                # Re-joining. The row survived a departure precisely so that the
                # read marker on it would survive too; only `left_at` is undone.
                membership.left_at = None
                membership.save()
            else:
                membership = ChatRoomMember.objects.create(
                    workspace_id=invite.room.workspace_id,
                    room=invite.room,
                    member=request.user,
                    role=ChatRoomMember.Role.MEMBER,
                )

            invite.uses = invite.uses + 1
            invite.save()

            ChatMessage.objects.create(
                workspace_id=invite.room.workspace_id,
                room=invite.room,
                sender=None,
                client_id=f"system-join-{uuid.uuid4().hex}",
                content=f"{request.user.display_name} joined via an invite link.",
                is_system=True,
            )

        return Response(self.room_payload(invite.room), status=status.HTTP_201_CREATED)

    def room_payload(self, room):
        # Re-read with the room list's prefetches so a join returns exactly the
        # shape the client already knows how to merge into its room list.
        room = (
            ChatRoom.objects.select_related("workspace")
            .prefetch_related("members__member__avatar_asset", "invites")
            .get(pk=room.pk)
        )
        return ChatRoomSerializer(room).data
