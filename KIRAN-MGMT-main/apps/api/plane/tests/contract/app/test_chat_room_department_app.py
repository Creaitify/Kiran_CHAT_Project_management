# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
The chat/operations seam: a conversation that belongs to a department.

Three properties carry the weight, and only the first is about the happy path.

**Attaching a department is not a way to join a room.** The FK is metadata; room
membership is still the entire permission model. If linking a department made a
room visible to that department, changing a dropdown would silently republish a
transcript to people who were never in the conversation.

**The link cannot cross a workspace.** There is no database constraint spanning
the two foreign keys, so the serializer is the only thing standing between a
request body and a room pointing at another tenant's department.

**Only a room admin may set it.** The room's identity fields are the admin's;
`topic` is the one field an ordinary member may write.
"""

import pytest
from django.urls import reverse
from rest_framework import status

from plane.db.models import ChatRoom, ChatRoomMember, Department, Workspace, WorkspaceMember
from plane.bgtasks.deletion_task import soft_delete_related_objects
from plane.tests.factories import UserFactory


def _list_url(workspace):
    return reverse("chat-room", kwargs={"slug": workspace.slug})


def _detail_url(workspace, room):
    return reverse("chat-room", kwargs={"slug": workspace.slug, "pk": room.id})


@pytest.fixture
def other(db, workspace):
    user = UserFactory()
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
    return user


@pytest.fixture
def department(db, workspace):
    return Department.objects.create(workspace=workspace, name="Operations", code="OPS")


def _room(workspace, members, name="General", admin=None, **extra):
    room = ChatRoom.objects.create(
        workspace=workspace, type=ChatRoom.RoomType.GROUP, name=name, **extra
    )
    for member in members:
        ChatRoomMember.objects.create(
            workspace=workspace,
            room=room,
            member=member,
            role=(
                ChatRoomMember.Role.ADMIN
                if admin is not None and member.id == admin.id
                else ChatRoomMember.Role.MEMBER
            ),
        )
    return room


@pytest.mark.contract
class TestRoomDepartmentLink:
    @pytest.mark.django_db
    def test_an_admin_can_attach_a_department(self, session_client, workspace, create_user, department):
        room = _room(workspace, [create_user], admin=create_user)

        response = session_client.patch(
            _detail_url(workspace, room),
            {"department": str(department.id)},
            content_type="application/json",
        )

        assert response.status_code == status.HTTP_200_OK
        body = response.json()
        assert body["department"] == str(department.id)
        # The code and name ride along so a room list can render a chip without
        # the client holding the department directory.
        assert body["department_code"] == "OPS"
        assert body["department_name"] == "Operations"

    @pytest.mark.django_db
    def test_a_room_can_be_detached(self, session_client, workspace, create_user, department):
        room = _room(workspace, [create_user], admin=create_user, department=department)

        response = session_client.patch(
            _detail_url(workspace, room), {"department": None}, content_type="application/json"
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.json()["department"] is None
        room.refresh_from_db()
        assert room.department_id is None

    @pytest.mark.django_db
    def test_an_ordinary_member_cannot_set_it(self, session_client, workspace, create_user, other, department):
        """Only `topic` is a member's to write. Everything else is the admin's."""
        room = _room(workspace, [create_user, other], admin=other)

        response = session_client.patch(
            _detail_url(workspace, room),
            {"department": str(department.id)},
            content_type="application/json",
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN
        room.refresh_from_db()
        assert room.department_id is None

    @pytest.mark.django_db
    def test_a_department_from_another_workspace_is_rejected(self, session_client, workspace, create_user):
        """The one thing no database constraint here is watching."""
        elsewhere = Workspace.objects.create(
            name="Elsewhere", slug="elsewhere", owner=create_user
        )
        theirs = Department.objects.create(workspace=elsewhere, name="Theirs", code="THX")
        room = _room(workspace, [create_user], admin=create_user)

        response = session_client.patch(
            _detail_url(workspace, room),
            {"department": str(theirs.id)},
            content_type="application/json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "department" in response.json()
        room.refresh_from_db()
        assert room.department_id is None

    @pytest.mark.django_db
    def test_the_same_rule_holds_on_create(self, session_client, workspace, create_user):
        """POST is a second way in, and it validates against the context rather
        than an existing row -- so it needs its own test, not an assumption."""
        elsewhere = Workspace.objects.create(name="Other", slug="other-ws", owner=create_user)
        theirs = Department.objects.create(workspace=elsewhere, name="Theirs", code="THY")

        response = session_client.post(
            _list_url(workspace),
            {"type": "group", "name": "Standup", "department": str(theirs.id)},
            content_type="application/json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.django_db
    def test_the_filter_never_widens_visibility(self, session_client, workspace, create_user, other, department):
        """`?department=` narrows the caller's own rooms. It is not a directory:
        a department's room you are not in stays invisible, because attaching a
        department has never been a way to join one."""
        mine = _room(workspace, [create_user], name="Mine", admin=create_user, department=department)
        _room(workspace, [other], name="Theirs", admin=other, department=department)

        response = session_client.get(_list_url(workspace), {"department": str(department.id)})

        assert response.status_code == status.HTTP_200_OK
        returned = {room["id"] for room in response.json()["results"]}
        assert returned == {str(mine.id)}

    @pytest.mark.django_db
    def test_a_malformed_department_filter_is_a_400(self, session_client, workspace, create_user):
        _room(workspace, [create_user], admin=create_user)

        response = session_client.get(_list_url(workspace), {"department": "not-a-uuid"})

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.django_db
    def test_deleting_the_department_keeps_the_conversation(self, session_client, workspace, create_user, department):
        """SET_NULL, not CASCADE. The transcript is the record of what happened
        and it outlives the org chart.

        Deletion here is soft, and the cascade that honours `SET_NULL` is a
        celery task, so this runs it inline. That asynchrony is the point of the
        next test.
        """
        room = _room(workspace, [create_user], admin=create_user, department=department)

        department.delete()
        soft_delete_related_objects("db", "department", department.pk)

        room.refresh_from_db()
        assert ChatRoom.objects.filter(pk=room.id).exists()
        assert room.department_id is None

    @pytest.mark.django_db
    def test_a_dissolved_department_stops_being_reported_immediately(
        self, session_client, workspace, create_user, department
    ):
        """The window between the soft delete and the cascade task.

        The FK still points at the department during it -- and `select_related`
        joins the raw table, so the ORM returns the soft-deleted row without
        complaint. A room list rendered in that window would show a chip for a
        department that no longer exists, and would keep showing it forever if
        the task never ran. The read side does not wait for the task.
        """
        room = _room(workspace, [create_user], admin=create_user, department=department)

        department.delete()  # soft; the cascade task is NOT run

        response = session_client.get(_detail_url(workspace, room))

        assert response.status_code == status.HTTP_200_OK
        body = response.json()
        assert body["department_code"] is None
        assert body["department_name"] is None
