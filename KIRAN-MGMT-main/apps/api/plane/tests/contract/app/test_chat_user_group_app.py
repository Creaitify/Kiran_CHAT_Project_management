# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Mention groups -- `@engineering` and friends.

Three properties are load-bearing and none of them are obvious from the model:

1. **A handle has to survive a round trip through a message body.** Mentions are
   written as `<!handle>` and read back with `/<!([a-zA-Z0-9_-]+)>/`, so a handle
   outside that character class produces a group that looks mentionable and
   notifies nobody.
2. **Editing the membership has to move the group row's `updated_at`.**
   Membership is its own table and removals are soft deletes performed with
   `.update()`, which bypasses `auto_now` -- so neither table's own timestamp
   can be the poll's signal. The group row is touched deliberately.
3. **Writes are workspace admin only.** The handle is global; a member being
   able to add themselves to `@on-call` would make it worth less than typing the
   names out.
"""

import pytest
from django.urls import reverse
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


def _list_url(workspace):
    return reverse("chat-user-group", kwargs={"slug": workspace.slug})


def _detail_url(workspace, group_id):
    return reverse("chat-user-group", kwargs={"slug": workspace.slug, "pk": group_id})


def _make_group(workspace, handle="engineering", name="Engineering", members=()):
    group = ChatUserGroup.objects.create(workspace=workspace, handle=handle, name=name)
    for member in members:
        ChatUserGroupMember.objects.create(workspace=workspace, group=group, member=member)
    return group


@pytest.mark.contract
class TestChatUserGroupEndpoint:
    @pytest.mark.django_db
    def test_create_and_list(self, session_client, workspace, create_user):
        response = session_client.post(
            _list_url(workspace),
            {"handle": "engineering", "name": "Engineering", "member_ids": [str(create_user.id)]},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        assert response.json()["member_ids"] == [str(create_user.id)]

        listed = session_client.get(_list_url(workspace))
        assert listed.status_code == status.HTTP_200_OK
        assert [group["handle"] for group in listed.json()] == ["engineering"]

    @pytest.mark.django_db
    def test_a_handle_is_lower_cased(self, session_client, workspace):
        response = session_client.post(
            _list_url(workspace), {"handle": "  Engineering  ", "name": "Engineering"}, format="json"
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.json()["handle"] == "engineering"

    @pytest.mark.django_db
    @pytest.mark.parametrize("handle", ["eng team", "eng.team", "eng@team", "eng/team", ""])
    def test_a_handle_the_tokeniser_cannot_read_is_rejected(self, session_client, workspace, handle):
        """`<!eng team>` would be written into a message and never parse back
        out of it: the group would look mentionable and reach nobody."""
        response = session_client.post(
            _list_url(workspace), {"handle": handle, "name": "Engineering"}, format="json"
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "handle" in response.json()

    @pytest.mark.django_db
    @pytest.mark.parametrize("handle", ["channel", "here", "agent", "CHANNEL"])
    def test_reserved_handles_are_rejected(self, session_client, workspace, handle):
        """`parseMentions` checks `isBroadcast` before it looks at the group
        list, so a group called `@here` could never resolve."""
        response = session_client.post(
            _list_url(workspace), {"handle": handle, "name": "Anything"}, format="json"
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "handle" in response.json()

    @pytest.mark.django_db
    def test_a_duplicate_handle_is_a_field_error_not_a_500(self, session_client, workspace):
        _make_group(workspace)

        response = session_client.post(
            _list_url(workspace), {"handle": "engineering", "name": "Engineering Again"}, format="json"
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "handle" in response.json()

    @pytest.mark.django_db
    def test_members_who_are_not_in_the_workspace_are_dropped(self, session_client, workspace, create_user):
        """Silently, on purpose: failing the whole edit because one person left
        last week loses the other nine changes in the same request."""
        outsider = UserFactory()

        response = session_client.post(
            _list_url(workspace),
            {
                "handle": "engineering",
                "name": "Engineering",
                "member_ids": [str(create_user.id), str(outsider.id)],
            },
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.json()["member_ids"] == [str(create_user.id)]

    @pytest.mark.django_db
    def test_updating_members_replaces_the_set(self, session_client, workspace, create_user):
        other = UserFactory()
        WorkspaceMember.objects.create(workspace=workspace, member=other, role=15)
        group = _make_group(workspace, members=[create_user])

        response = session_client.patch(
            _detail_url(workspace, group.id), {"member_ids": [str(other.id)]}, format="json"
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.json()["member_ids"] == [str(other.id)]

    @pytest.mark.django_db
    def test_omitting_member_ids_leaves_the_membership_alone(self, session_client, workspace, create_user):
        """Absent and `[]` are different requests."""
        group = _make_group(workspace, members=[create_user])

        response = session_client.patch(
            _detail_url(workspace, group.id), {"name": "Platform"}, format="json"
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.json()["name"] == "Platform"
        assert response.json()["member_ids"] == [str(create_user.id)]

    @pytest.mark.django_db
    def test_an_empty_member_ids_empties_the_group(self, session_client, workspace, create_user):
        group = _make_group(workspace, members=[create_user])

        response = session_client.patch(
            _detail_url(workspace, group.id), {"member_ids": []}, format="json"
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.json()["member_ids"] == []

    @pytest.mark.django_db
    def test_a_membership_change_touches_the_group_row(self, session_client, workspace, create_user):
        """The poll is `updated_at > since` on the group row alone. If adding
        someone did not move it, nobody would ever learn about it."""
        group = _make_group(workspace)
        before = group.updated_at

        session_client.patch(
            _detail_url(workspace, group.id), {"member_ids": [str(create_user.id)]}, format="json"
        )

        group.refresh_from_db()
        assert group.updated_at > before

    @pytest.mark.django_db
    def test_a_removal_also_touches_the_group_row(self, session_client, workspace, create_user):
        """The case a membership-table poll would miss entirely: a removal is a
        soft delete done with `.update()`, which bypasses `auto_now`."""
        group = _make_group(workspace, members=[create_user])
        group.refresh_from_db()
        before = group.updated_at

        session_client.patch(_detail_url(workspace, group.id), {"member_ids": []}, format="json")

        group.refresh_from_db()
        assert group.updated_at > before

    @pytest.mark.django_db
    def test_a_no_op_edit_does_not_touch_the_group_row(self, session_client, workspace, create_user):
        """Re-sending the same membership must not manufacture a delta for every
        connected client."""
        group = _make_group(workspace, members=[create_user])
        group.refresh_from_db()
        before = group.updated_at

        session_client.patch(
            _detail_url(workspace, group.id), {"member_ids": [str(create_user.id)]}, format="json"
        )

        group.refresh_from_db()
        assert group.updated_at == before

    @pytest.mark.django_db
    def test_delete(self, session_client, workspace):
        group = _make_group(workspace)

        response = session_client.delete(_detail_url(workspace, group.id))

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not ChatUserGroup.objects.filter(pk=group.id).exists()

    @pytest.mark.django_db
    def test_a_member_may_read_but_not_write(self, session_client, workspace, create_user):
        WorkspaceMember.objects.filter(workspace=workspace, member=create_user).update(role=15)
        _make_group(workspace)

        assert session_client.get(_list_url(workspace)).status_code == status.HTTP_200_OK

        response = session_client.post(
            _list_url(workspace), {"handle": "sales", "name": "Sales"}, format="json"
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN

    @pytest.mark.django_db
    def test_groups_do_not_leak_across_workspaces(self, session_client, workspace, create_user):
        from plane.tests.factories import WorkspaceFactory

        other_workspace = WorkspaceFactory(owner=UserFactory())
        _make_group(other_workspace, handle="secret", name="Other Workspace")
        _make_group(workspace)

        listed = session_client.get(_list_url(workspace)).json()

        assert [group["handle"] for group in listed] == ["engineering"]


@pytest.mark.contract
class TestGroupMentionsCountAsMentions:
    """`@engineering` is a mention of everyone in @engineering.

    The unread badge distinguishes "messages" from "messages that mention you",
    and before mention groups existed it only knew about direct mentions and
    broadcasts. A group mention that did not count would make the badge quietly
    wrong for exactly the people the message was aimed at.
    """

    @staticmethod
    def _room_with(workspace, user):
        room = ChatRoom.objects.create(
            workspace=workspace, type=ChatRoom.RoomType.GROUP, name="Room"
        )
        ChatRoomMember.objects.create(workspace=workspace, room=room, member=user)
        return room

    @staticmethod
    def _post(workspace, room, sender, mentions, client_id):
        return ChatMessage.objects.create(
            workspace=workspace,
            room=room,
            sender=sender,
            client_id=client_id,
            content="heads up",
            mentions=mentions,
        )

    @pytest.mark.django_db
    def test_a_group_mention_counts_for_its_members(self, session_client, workspace, create_user):
        other = UserFactory()
        WorkspaceMember.objects.create(workspace=workspace, member=other, role=15)
        room = self._room_with(workspace, create_user)
        ChatRoomMember.objects.create(workspace=workspace, room=room, member=other)

        group = _make_group(workspace, members=[create_user])
        self._post(
            workspace,
            room,
            other,
            {"users": [], "groups": [group.handle], "broadcast": None},
            "grp",
        )

        response = session_client.get(reverse("chat-room", kwargs={"slug": workspace.slug})).json()
        rooms = response.get("results", response) if isinstance(response, dict) else response
        unread = next(entry["unread"] for entry in rooms if entry["id"] == str(room.id))

        assert unread["total"] == 1
        assert unread["mentions"] == 1

    @pytest.mark.django_db
    def test_a_group_mention_does_not_count_for_a_non_member(self, session_client, workspace, create_user):
        other = UserFactory()
        WorkspaceMember.objects.create(workspace=workspace, member=other, role=15)
        room = self._room_with(workspace, create_user)
        ChatRoomMember.objects.create(workspace=workspace, room=room, member=other)

        # The caller is deliberately not in the group.
        group = _make_group(workspace, members=[other])
        self._post(
            workspace,
            room,
            other,
            {"users": [], "groups": [group.handle], "broadcast": None},
            "grp",
        )

        response = session_client.get(reverse("chat-room", kwargs={"slug": workspace.slug})).json()
        rooms = response.get("results", response) if isinstance(response, dict) else response
        unread = next(entry["unread"] for entry in rooms if entry["id"] == str(room.id))

        assert unread["total"] == 1
        assert unread["mentions"] == 0
