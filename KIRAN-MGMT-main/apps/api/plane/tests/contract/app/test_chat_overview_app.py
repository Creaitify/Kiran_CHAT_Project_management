# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
The shell's view of chat: the rail badge's number and the palette's jump list.

The thing worth guarding is that this endpoint and the conversation list never
disagree. They share `mentions_me_q` rather than each computing "does this
mention me", because a badge that counts mentions differently from the room list
is a red dot with nothing behind it -- and people stop trusting a badge like that
permanently.

Everything else here is about the badge being *quiet when it should be*: your own
messages, messages you have already read, queued messages and archived rooms all
have to count for nothing, or the number never reaches zero and stops meaning
anything.
"""

from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone
from rest_framework import status

from plane.db.models import (
    ChatMessage,
    ChatRoom,
    ChatRoomMember,
    ChatUserGroup,
    ChatUserGroupMember,
    WorkspaceMember,
)
from plane.tests.factories import UserFactory


def _url(workspace):
    return reverse("chat-overview", kwargs={"slug": workspace.slug})


@pytest.fixture
def other(db, workspace):
    """A second workspace member, to send messages the caller has not read."""
    user = UserFactory()
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
    return user


def _room(workspace, members, name="General", room_type=None):
    room = ChatRoom.objects.create(
        workspace=workspace,
        type=room_type or ChatRoom.RoomType.GROUP,
        name=name,
    )
    for member in members:
        ChatRoomMember.objects.create(workspace=workspace, room=room, member=member)
    return room


def _say(workspace, room, sender, content="hello", mentions=None, **extra):
    return ChatMessage.objects.create(
        workspace=workspace,
        room=room,
        sender=sender,
        client_id=f"c-{ChatMessage.objects.count()}-{content[:8]}",
        content=content,
        mentions=mentions or {"users": [], "groups": [], "broadcast": None},
        **extra,
    )


@pytest.mark.contract
class TestChatOverview:
    @pytest.mark.django_db
    def test_no_rooms_is_a_zero_not_an_error(self, session_client, workspace):
        response = session_client.get(_url(workspace))

        assert response.status_code == status.HTTP_200_OK
        assert response.json() == {"unread": {"total": 0, "mentions": 0}, "rooms": []}

    @pytest.mark.django_db
    def test_unread_messages_are_counted(self, session_client, workspace, create_user, other):
        room = _room(workspace, [create_user, other])
        _say(workspace, room, other)
        _say(workspace, room, other, content="again")

        body = session_client.get(_url(workspace)).json()

        assert body["unread"]["total"] == 2
        assert body["rooms"][0]["unread"] == 2

    @pytest.mark.django_db
    def test_your_own_messages_are_not_unread(self, session_client, workspace, create_user, other):
        room = _room(workspace, [create_user, other])
        _say(workspace, room, create_user)

        assert session_client.get(_url(workspace)).json()["unread"]["total"] == 0

    @pytest.mark.django_db
    def test_messages_before_your_read_marker_are_not_unread(
        self, session_client, workspace, create_user, other
    ):
        room = _room(workspace, [create_user, other])
        _say(workspace, room, other, content="old")
        ChatRoomMember.objects.filter(room=room, member=create_user).update(
            last_read_at=timezone.now()
        )
        _say(workspace, room, other, content="new")

        assert session_client.get(_url(workspace)).json()["unread"]["total"] == 1

    @pytest.mark.django_db
    def test_a_queued_message_is_nobody_s_unread(self, session_client, workspace, create_user, other):
        room = _room(workspace, [create_user, other])
        _say(workspace, room, other, scheduled_for=timezone.now() + timedelta(hours=2))

        assert session_client.get(_url(workspace)).json()["unread"]["total"] == 0

    @pytest.mark.django_db
    def test_a_tombstoned_message_is_not_unread(self, session_client, workspace, create_user, other):
        room = _room(workspace, [create_user, other])
        _say(workspace, room, other, tombstoned_at=timezone.now())

        assert session_client.get(_url(workspace)).json()["unread"]["total"] == 0

    @pytest.mark.django_db
    def test_an_archived_room_does_not_keep_the_badge_lit(
        self, session_client, workspace, create_user, other
    ):
        room = _room(workspace, [create_user, other])
        _say(workspace, room, other)
        ChatRoom.objects.filter(pk=room.id).update(archived_at=timezone.now())

        body = session_client.get(_url(workspace)).json()

        assert body["unread"]["total"] == 0
        assert body["rooms"] == []

    @pytest.mark.django_db
    def test_a_direct_mention_is_emphasised(self, session_client, workspace, create_user, other):
        room = _room(workspace, [create_user, other])
        _say(workspace, room, other)
        _say(
            workspace,
            room,
            other,
            content="you",
            mentions={"users": [str(create_user.id)], "groups": [], "broadcast": None},
        )

        body = session_client.get(_url(workspace)).json()

        assert body["unread"]["total"] == 2
        assert body["unread"]["mentions"] == 1

    @pytest.mark.django_db
    def test_a_broadcast_counts_as_a_mention(self, session_client, workspace, create_user, other):
        room = _room(workspace, [create_user, other])
        _say(
            workspace,
            room,
            other,
            mentions={"users": [], "groups": [], "broadcast": "channel"},
        )

        assert session_client.get(_url(workspace)).json()["unread"]["mentions"] == 1

    @pytest.mark.django_db
    def test_a_group_mention_counts_the_same_way_the_room_list_counts_it(
        self, session_client, workspace, create_user, other
    ):
        """The badge and the conversation list share `mentions_me_q` precisely so
        this cannot drift."""
        room = _room(workspace, [create_user, other])
        group = ChatUserGroup.objects.create(
            workspace=workspace, handle="engineering", name="Engineering"
        )
        ChatUserGroupMember.objects.create(workspace=workspace, group=group, member=create_user)
        _say(
            workspace,
            room,
            other,
            mentions={"users": [], "groups": ["engineering"], "broadcast": None},
        )

        assert session_client.get(_url(workspace)).json()["unread"]["mentions"] == 1

    @pytest.mark.django_db
    def test_a_group_you_are_not_in_does_not_light_the_badge(
        self, session_client, workspace, create_user, other
    ):
        room = _room(workspace, [create_user, other])
        group = ChatUserGroup.objects.create(
            workspace=workspace, handle="engineering", name="Engineering"
        )
        ChatUserGroupMember.objects.create(workspace=workspace, group=group, member=other)
        _say(
            workspace,
            room,
            other,
            mentions={"users": [], "groups": ["engineering"], "broadcast": None},
        )

        body = session_client.get(_url(workspace)).json()
        assert body["unread"]["total"] == 1
        assert body["unread"]["mentions"] == 0

    @pytest.mark.django_db
    def test_rooms_come_back_most_recently_active_first(
        self, session_client, workspace, create_user, other
    ):
        """A jump list is for the conversation you were just in."""
        quiet = _room(workspace, [create_user, other], name="Quiet")
        busy = _room(workspace, [create_user, other], name="Busy")
        _say(workspace, quiet, other, content="ages ago")
        _say(workspace, busy, other, content="just now")

        titles = [room["title"] for room in session_client.get(_url(workspace)).json()["rooms"]]

        assert titles[0] == "Busy"

    @pytest.mark.django_db
    def test_a_direct_room_gets_a_title_the_palette_can_show(
        self, session_client, workspace, create_user, other
    ):
        """A DM has no stored name, and the palette has no member directory to
        resolve one with -- so the server names it."""
        other.display_name = "Ravi Kumar"
        other.save()
        _room(workspace, [create_user, other], name=None, room_type=ChatRoom.RoomType.DIRECT)

        rooms = session_client.get(_url(workspace)).json()["rooms"]

        assert rooms[0]["title"] == "Ravi Kumar"
        assert rooms[0]["type"] == "direct"

    @pytest.mark.django_db
    def test_a_room_you_are_not_in_is_invisible(self, session_client, workspace, create_user, other):
        theirs = _room(workspace, [other], name="Not Yours")
        _say(workspace, theirs, other)

        body = session_client.get(_url(workspace)).json()

        assert body["unread"]["total"] == 0
        assert body["rooms"] == []

    @pytest.mark.django_db
    def test_a_signed_out_caller_gets_nothing(self, api_client, workspace):
        response = api_client.get(_url(workspace))

        assert response.status_code in (
            status.HTTP_401_UNAUTHORIZED,
            status.HTTP_403_FORBIDDEN,
        )
