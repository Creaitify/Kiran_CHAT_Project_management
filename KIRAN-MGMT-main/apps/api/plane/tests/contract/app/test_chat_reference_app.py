# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Cross-app backlinks: which chat messages reference somebody else's object.

Two properties carry the weight.

**Room membership is the whole permission model.** A work item's sidebar renders
this list, and a work item can be seen by anyone on the project — so a reference
sitting in a private room must not leak through it. That is the one way this
feature could turn into a disclosure bug, and it is what most of this file is
about.

**A link is a reference; a number in a sentence is not.** Matching the bare
identifier would fill every work item's panel with messages that merely said its
number out loud.
"""

import pytest
from django.urls import reverse
from django.utils import timezone
from datetime import timedelta
from rest_framework import status

from plane.db.models import ChatMessage, ChatRoom, ChatRoomMember, WorkspaceMember
from plane.tests.factories import UserFactory


def _url(workspace):
    return reverse("chat-reference", kwargs={"slug": workspace.slug})


@pytest.fixture
def other(db, workspace):
    user = UserFactory()
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
    return user


def _room(workspace, members, name="General"):
    room = ChatRoom.objects.create(workspace=workspace, type=ChatRoom.RoomType.GROUP, name=name)
    for member in members:
        ChatRoomMember.objects.create(workspace=workspace, room=room, member=member)
    return room


def _say(workspace, room, sender, content, **extra):
    return ChatMessage.objects.create(
        workspace=workspace,
        room=room,
        sender=sender,
        client_id=f"c-{ChatMessage.objects.count()}",
        content=content,
        **extra,
    )


def _fetch(client, workspace, kind="work-item", entity_id="KIR-42"):
    return client.get(_url(workspace), {"kind": kind, "id": entity_id})


@pytest.mark.contract
class TestChatReferences:
    @pytest.mark.django_db
    def test_a_linked_work_item_is_found(self, session_client, workspace, create_user, other):
        room = _room(workspace, [create_user, other])
        _say(workspace, room, other, "blocked on /kiran/browse/KIR-42/ until Friday")

        body = _fetch(session_client, workspace).json()

        assert len(body["items"]) == 1
        assert "KIR-42" in body["items"][0]["excerpt"]
        assert body["items"][0]["room_id"] == str(room.id)

    @pytest.mark.django_db
    def test_the_bare_identifier_is_not_a_reference(self, session_client, workspace, create_user, other):
        """"KIR-42 is blocked" is a person talking. Counting it would fill the
        panel with every message that said the number out loud."""
        room = _room(workspace, [create_user, other])
        _say(workspace, room, other, "KIR-42 is blocked until Friday")

        assert _fetch(session_client, workspace).json()["items"] == []

    @pytest.mark.django_db
    def test_a_reference_in_a_room_you_are_not_in_is_invisible(self, session_client, workspace, create_user, other):
        """The disclosure case. A work item is visible to the whole project; the
        private room discussing it is not."""
        theirs = _room(workspace, [other], name="Private")
        _say(workspace, theirs, other, "see /kiran/browse/KIR-42/ — bad news")

        assert _fetch(session_client, workspace).json()["items"] == []

    @pytest.mark.django_db
    def test_a_tombstoned_message_is_not_returned(self, session_client, workspace, create_user, other):
        room = _room(workspace, [create_user, other])
        _say(workspace, room, other, "/kiran/browse/KIR-42/", tombstoned_at=timezone.now())

        assert _fetch(session_client, workspace).json()["items"] == []

    @pytest.mark.django_db
    def test_a_queued_message_has_not_been_said_yet(self, session_client, workspace, create_user, other):
        room = _room(workspace, [create_user, other])
        _say(
            workspace,
            room,
            other,
            "/kiran/browse/KIR-42/",
            scheduled_for=timezone.now() + timedelta(hours=3),
        )

        assert _fetch(session_client, workspace).json()["items"] == []

    @pytest.mark.django_db
    def test_a_different_work_item_does_not_match(self, session_client, workspace, create_user, other):
        room = _room(workspace, [create_user, other])
        _say(workspace, room, other, "see /kiran/browse/KIR-420/")

        assert _fetch(session_client, workspace, entity_id="KIR-42").json()["items"] == []

    @pytest.mark.django_db
    def test_an_unknown_kind_returns_nothing_rather_than_erroring(
        self, session_client, workspace, create_user, other
    ):
        """Chat does not know what kinds exist. An app it has never heard of
        asking about an object it cannot search for is a normal thing, not a
        400."""
        room = _room(workspace, [create_user, other])
        _say(workspace, room, other, "/kiran/browse/KIR-42/")

        response = _fetch(session_client, workspace, kind="invoice")

        assert response.status_code == status.HTTP_200_OK
        assert response.json()["items"] == []

    @pytest.mark.django_db
    @pytest.mark.parametrize("entity_id", ["", "KIR%42", "KIR_42", "../etc", "x" * 200])
    def test_a_hostile_identifier_matches_nothing(
        self, session_client, workspace, create_user, other, entity_id
    ):
        """The id goes into a LIKE pattern. `%` and `_` are wildcards there, and
        a slash would let a caller widen the search past the kind's own path."""
        room = _room(workspace, [create_user, other])
        _say(workspace, room, other, "/kiran/browse/KIR-42/")

        response = _fetch(session_client, workspace, entity_id=entity_id)

        assert response.status_code == status.HTTP_200_OK
        assert response.json()["items"] == []

    @pytest.mark.django_db
    def test_the_excerpt_is_flat_plain_text(self, session_client, workspace, create_user, other):
        """The consumer is another app's sidebar, which has no business
        rendering chat's markdown or resolving chat's mention tokens."""
        room = _room(workspace, [create_user, other])
        _say(workspace, room, other, "line one\n\n  line two   /kiran/browse/KIR-42/")

        excerpt = _fetch(session_client, workspace).json()["items"][0]["excerpt"]

        assert "\n" not in excerpt
        assert "  " not in excerpt
        assert excerpt.startswith("line one line two")

    @pytest.mark.django_db
    def test_newest_first(self, session_client, workspace, create_user, other):
        room = _room(workspace, [create_user, other])
        _say(workspace, room, other, "older /kiran/browse/KIR-42/")
        _say(workspace, room, other, "newer /kiran/browse/KIR-42/")

        items = _fetch(session_client, workspace).json()["items"]

        assert items[0]["excerpt"].startswith("newer")

    @pytest.mark.django_db
    def test_a_signed_out_caller_gets_nothing(self, api_client, workspace):
        response = _fetch(api_client, workspace)

        assert response.status_code in (
            status.HTTP_401_UNAUTHORIZED,
            status.HTTP_403_FORBIDDEN,
        )
