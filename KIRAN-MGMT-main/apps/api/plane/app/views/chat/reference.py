# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
"Which messages mention this?"

The other half of Stage 4's cross-app link. A work item's screen asks the shell
what points at it; the shell asks every app that registered a backlink provider;
chat's provider calls this.

---------------------------------------------------------------------------
Why this endpoint knows nothing about work items
---------------------------------------------------------------------------
It takes an opaque `kind` and `id` and searches for the URL those imply. It does
not import anything from projects, does not validate that `work-item` is a real
kind, and does not know that `KIR-42` is a project identifier followed by a
sequence number. If it did, adding a fourth app with referenceable objects would
mean editing chat -- which is the coupling the whole exercise exists to avoid.

What it does own is the search: chat stores message text, so finding references
means looking in message text, and only chat should know that.

---------------------------------------------------------------------------
Matching the URL form, not the bare identifier
---------------------------------------------------------------------------
A message saying "KIR-42 is blocked" is a person talking. A message containing
`/browse/KIR-42` is a link someone deliberately pasted. Only the second is a
reference, and matching the first would fill a work item's panel with every
message that happened to mention its number.

`icontains` over `content` is a sequential scan. That is honest for a demo and
wrong at scale; the fix is a trigram index on `chat_messages.content`, which is
a migration nobody should write before someone has seen this feature work.
"""

import re

# Django imports
from django.db.models import Q
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseViewSet
from plane.db.models import ChatMessage, ChatRoomMember

# A work item's panel is a summary, not an archive. Newest first, and if there
# are more than this the conversation is the place to read them.
MAX_REFERENCES = 20

# Every kind this endpoint can search for, and the URL fragment that identifies
# it. Adding a kind is one line here -- but note it is a *routing* table, not
# knowledge: chat still has no idea what any of these objects are.
KIND_PATHS = {"work-item": "/browse/{id}"}

# The identifier goes into a LIKE pattern, so it may not carry pattern
# metacharacters or path separators of its own.
MAX_ID_LENGTH = 64


class ChatReferenceViewSet(BaseViewSet):
    """`GET /api/workspaces/<slug>/chat/references/?kind=&id=`

    Returns messages, in rooms the caller is a member of, whose text contains a
    link to the given entity. Room membership is the whole permission model: a
    reference in a room you are not in is not yours to see, and a work item's
    panel must not become a way to read private conversations.
    """

    model = ChatMessage

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def list(self, request, slug):
        kind = (request.query_params.get("kind") or "").strip()
        entity_id = (request.query_params.get("id") or "").strip()

        template = KIND_PATHS.get(kind)
        if not template or not entity_id:
            return Response({"items": []}, status=status.HTTP_200_OK)

        if len(entity_id) > MAX_ID_LENGTH or any(c in entity_id for c in "%_/\\"):
            return Response({"items": []}, status=status.HTTP_200_OK)

        needle = template.format(id=entity_id)

        room_ids = list(
            ChatRoomMember.objects.filter(
                workspace__slug=slug,
                member=request.user,
                left_at__isnull=True,
                room__deleted_at__isnull=True,
            ).values_list("room_id", flat=True)
        )
        if not room_ids:
            return Response({"items": []}, status=status.HTTP_200_OK)

        now = timezone.now()
        messages = (
            ChatMessage.objects.filter(room_id__in=room_ids, content__icontains=needle)
            .filter(tombstoned_at__isnull=True)
            # A queued message has not been said yet.
            .filter(Q(scheduled_for__isnull=True) | Q(scheduled_for__lte=now))
            .select_related("sender", "room")
            # `_room_title` walks a direct room's members; without this it is a
            # query per result.
            .prefetch_related("room__members__member")
            .order_by("-created_at", "-id")[:MAX_REFERENCES]
        )

        needle_pattern = re.compile(rf"{re.escape(needle)}(?:[/?#\s,\.\)\]'\"!:]|$)", re.IGNORECASE)

        matching_messages = [
            message for message in messages
            if needle_pattern.search(message.content)
        ][:MAX_REFERENCES]

        return Response(
            {
                "items": [
                    {
                        "id": str(message.id),
                        "room_id": str(message.room_id),
                        "room_title": self._room_title(message.room, request.user.id),
                        "excerpt": self._excerpt(message.content),
                        "author": (
                            message.sender.display_name or message.sender.email
                            if message.sender
                            else None
                        ),
                        "created_at": message.created_at,
                    }
                    for message in matching_messages
                ]
            },
            status=status.HTTP_200_OK,
        )

    @staticmethod
    def _excerpt(content: str, limit: int = 160) -> str:
        """One line of context, as plain text.

        The consumer is another app's side panel, which has no business
        rendering chat's markdown or resolving chat's mention tokens -- so
        neither reaches it.
        """
        flat = " ".join(content.split())
        return flat if len(flat) <= limit else f"{flat[: limit - 1]}…"

    @staticmethod
    def _room_title(room, user_id):
        if room.name:
            return room.name
        others = [
            member.member.display_name or member.member.email or "Someone"
            for member in room.members.all()
            if member.member_id != user_id and member.left_at is None and member.member_id
        ]
        return ", ".join(others) if others else "Direct message"
