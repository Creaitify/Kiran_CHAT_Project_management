# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
The operations endpoints.

Most of this file is about **who may see whose numbers**, because that is where
this feature can actually hurt someone. A timesheet is a record of how a person
spent their week and a rate is what a colleague costs; both are readable by
workspace admins and by nobody else, and the tests below are what stop that
slipping.

The arithmetic itself lives in `plane/tests/unit/utils/test_operations_rollup.py`.
"""

from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone
from rest_framework import status

from plane.db.models import Department, MemberRate, Project, Reminder, TimeEntry, WorkspaceMember
from plane.tests.factories import UserFactory


@pytest.fixture
def other(db, workspace):
    user = UserFactory()
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
    return user


@pytest.fixture
def project(db, workspace):
    return Project.objects.create(
        workspace=workspace,
        name="Platform",
        identifier="PLT",
        default_assignee=workspace.owner,
        project_lead=workspace.owner,
    )


def _url(name, workspace, **kwargs):
    return reverse(name, kwargs={"slug": workspace.slug, **kwargs})


def _demote(workspace, user):
    """Make the caller a plain member rather than an admin."""
    WorkspaceMember.objects.filter(workspace=workspace, member=user).update(role=15)


@pytest.mark.contract
class TestDepartments:
    @pytest.mark.django_db
    def test_create_and_list(self, session_client, workspace):
        response = session_client.post(
            _url("operations-department", workspace), {"name": "Engineering", "code": "eng"}, format="json"
        )

        assert response.status_code == status.HTTP_201_CREATED
        # Uppercased rather than rejected: "eng" and "ENG" are the same
        # department to everyone except a unique constraint.
        assert response.json()["code"] == "ENG"

        listed = session_client.get(_url("operations-department", workspace)).json()
        assert [row["code"] for row in listed] == ["ENG"]

    @pytest.mark.django_db
    def test_a_duplicate_code_is_a_field_error(self, session_client, workspace):
        Department.objects.create(workspace=workspace, name="Engineering", code="ENG")

        response = session_client.post(
            _url("operations-department", workspace), {"name": "Eng again", "code": "ENG"}, format="json"
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "code" in response.json()

    @pytest.mark.django_db
    @pytest.mark.parametrize("code", ["", "TOO-LONG-A-CODE-HERE", "EN G", "EN/G"])
    def test_a_bad_code_is_rejected(self, session_client, workspace, code):
        response = session_client.post(
            _url("operations-department", workspace), {"name": "X", "code": code}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.django_db
    def test_a_member_may_read_but_not_write(self, session_client, workspace, create_user):
        Department.objects.create(workspace=workspace, name="Engineering", code="ENG")
        _demote(workspace, create_user)

        assert session_client.get(_url("operations-department", workspace)).status_code == status.HTTP_200_OK

        response = session_client.post(
            _url("operations-department", workspace), {"name": "Sales", "code": "SLS"}, format="json"
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN

    @pytest.mark.django_db
    def test_setting_projects_replaces_the_list(self, session_client, workspace, project):
        department = Department.objects.create(workspace=workspace, name="Engineering", code="ENG")

        response = session_client.post(
            _url("operations-department-projects", workspace, pk=department.id),
            {"project_ids": [str(project.id)]},
            format="json",
        )

        assert response.status_code == status.HTTP_200_OK
        assert len(response.json()) == 1

        emptied = session_client.post(
            _url("operations-department-projects", workspace, pk=department.id),
            {"project_ids": []},
            format="json",
        )
        assert emptied.json() == []


@pytest.mark.contract
class TestTimeEntries:
    @pytest.mark.django_db
    def test_log_and_read_back(self, session_client, workspace, project):
        response = session_client.post(
            _url("operations-time-entry", workspace),
            {"project": str(project.id), "spent_on": str(timezone.now().date()), "minutes": 90},
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED

        listed = session_client.get(_url("operations-time-entry", workspace)).json()
        assert listed["total_minutes"] == 90

    @pytest.mark.django_db
    def test_future_time_is_rejected(self, session_client, workspace, project):
        tomorrow = timezone.now().date() + timedelta(days=1)

        response = session_client.post(
            _url("operations-time-entry", workspace),
            {"project": str(project.id), "spent_on": str(tomorrow), "minutes": 60},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "spent_on" in response.json()

    @pytest.mark.django_db
    def test_an_implausible_duration_is_rejected(self, session_client, workspace, project):
        """A typo guard, not a policy. 20 hours in one entry is almost always a
        minutes/hours mix-up, and catching it here is far cheaper than finding
        it in a quarterly total."""
        response = session_client.post(
            _url("operations-time-entry", workspace),
            {"project": str(project.id), "spent_on": str(timezone.now().date()), "minutes": 20 * 60},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "minutes" in response.json()

    @pytest.mark.django_db
    def test_a_plain_member_sees_only_their_own_time(self, session_client, workspace, create_user, other, project):
        """The disclosure case. A timesheet is a record of how a person spent
        their week."""
        TimeEntry.objects.create(
            workspace=workspace, project=project, member=other, spent_on=timezone.now().date(), minutes=120
        )
        TimeEntry.objects.create(
            workspace=workspace, project=project, member=create_user, spent_on=timezone.now().date(), minutes=60
        )
        _demote(workspace, create_user)

        listed = session_client.get(_url("operations-time-entry", workspace)).json()

        assert listed["total_minutes"] == 60
        assert {row["member_id"] for row in listed["items"]} == {str(create_user.id)}

    @pytest.mark.django_db
    def test_a_member_cannot_widen_the_view_with_a_query_param(
        self, session_client, workspace, create_user, other, project
    ):
        """Scope is the permission, applied before anything else can widen it."""
        TimeEntry.objects.create(
            workspace=workspace, project=project, member=other, spent_on=timezone.now().date(), minutes=120
        )
        _demote(workspace, create_user)

        listed = session_client.get(
            _url("operations-time-entry", workspace), {"member": str(other.id)}
        ).json()

        assert listed["items"] == []

    @pytest.mark.django_db
    def test_an_admin_sees_everyone(self, session_client, workspace, other, project):
        TimeEntry.objects.create(
            workspace=workspace, project=project, member=other, spent_on=timezone.now().date(), minutes=120
        )

        listed = session_client.get(_url("operations-time-entry", workspace)).json()

        assert listed["total_minutes"] == 120

    @pytest.mark.django_db
    def test_you_cannot_edit_someone_else_s_entry(self, session_client, workspace, other, project):
        entry = TimeEntry.objects.create(
            workspace=workspace, project=project, member=other, spent_on=timezone.now().date(), minutes=120
        )

        response = session_client.patch(
            _url("operations-time-entry", workspace, pk=entry.id), {"minutes": 30}, format="json"
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN

    @pytest.mark.django_db
    def test_time_is_always_logged_as_the_caller(self, session_client, workspace, other, project):
        """Logging on someone else's behalf is a different feature with a
        different audit story."""
        response = session_client.post(
            _url("operations-time-entry", workspace),
            {
                "project": str(project.id),
                "spent_on": str(timezone.now().date()),
                "minutes": 60,
                "member": str(other.id),
            },
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.json()["member_id"] != str(other.id)


@pytest.mark.contract
class TestRatesAndCost:
    @pytest.mark.django_db
    def test_a_plain_member_may_not_read_rates(self, session_client, workspace, create_user):
        """There is no version of a team where everyone knowing what a colleague
        costs is a neutral fact."""
        _demote(workspace, create_user)

        response = session_client.get(_url("operations-member-rate", workspace))

        assert response.status_code == status.HTTP_403_FORBIDDEN

    @pytest.mark.django_db
    def test_a_plain_member_may_not_read_cost(self, session_client, workspace, create_user):
        _demote(workspace, create_user)

        response = session_client.get(_url("operations-cost", workspace))

        assert response.status_code == status.HTTP_403_FORBIDDEN

    @pytest.mark.django_db
    def test_setting_the_same_date_twice_is_a_correction(self, session_client, workspace, create_user):
        payload = {
            "member": str(create_user.id),
            "amount_minor": 50_000,
            "currency": "INR",
            "effective_from": "2026-01-01",
        }
        session_client.post(_url("operations-member-rate", workspace), payload, format="json")
        session_client.post(
            _url("operations-member-rate", workspace), {**payload, "amount_minor": 60_000}, format="json"
        )

        rates = MemberRate.objects.filter(workspace=workspace, member=create_user)
        assert rates.count() == 1
        assert rates.first().amount_minor == 60_000

    @pytest.mark.django_db
    def test_a_rate_for_a_non_member_is_rejected(self, session_client, workspace):
        outsider = UserFactory()

        response = session_client.post(
            _url("operations-member-rate", workspace),
            {"member": str(outsider.id), "amount_minor": 1000, "effective_from": "2026-01-01"},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.django_db
    def test_cost_reports_unpriced_time_separately(self, session_client, workspace, create_user, project):
        TimeEntry.objects.create(
            workspace=workspace, project=project, member=create_user, spent_on=timezone.now().date(), minutes=120
        )

        body = session_client.get(_url("operations-cost", workspace)).json()

        assert body["totals"]["minutes"] == 120
        assert body["totals"]["cost_minor"] == 0
        assert body["totals"]["unpriced_minutes"] == 120


@pytest.mark.contract
class TestReminders:
    @pytest.mark.django_db
    def test_create_and_list(self, session_client, workspace):
        when = (timezone.now() + timedelta(hours=2)).isoformat()

        response = session_client.post(
            _url("operations-reminder", workspace),
            {"entity_kind": "work-item", "entity_id": "KIR-42", "note": "Follow up", "remind_at": when},
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED

        listed = session_client.get(_url("operations-reminder", workspace)).json()
        assert len(listed["items"]) == 1
        assert listed["due_count"] == 0

    @pytest.mark.django_db
    def test_a_reminder_in_the_past_is_rejected(self, session_client, workspace):
        response = session_client.post(
            _url("operations-reminder", workspace),
            {
                "entity_kind": "work-item",
                "entity_id": "KIR-42",
                "remind_at": (timezone.now() - timedelta(hours=1)).isoformat(),
            },
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.django_db
    def test_you_never_see_someone_else_s_reminders(self, session_client, workspace, other):
        Reminder.objects.create(
            workspace=workspace,
            member=other,
            entity_kind="work-item",
            entity_id="KIR-42",
            remind_at=timezone.now() + timedelta(hours=1),
        )

        listed = session_client.get(_url("operations-reminder", workspace)).json()

        assert listed["items"] == []

    @pytest.mark.django_db
    def test_an_unknown_entity_kind_is_accepted(self, session_client, workspace):
        """`entity_kind` is opaque on purpose. Validating it against a list would
        mean adding an app requires editing operations."""
        response = session_client.post(
            _url("operations-reminder", workspace),
            {
                "entity_kind": "invoice",
                "entity_id": "INV-9",
                "remind_at": (timezone.now() + timedelta(hours=1)).isoformat(),
            },
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED

    @pytest.mark.django_db
    def test_dismiss(self, session_client, workspace, create_user):
        reminder = Reminder.objects.create(
            workspace=workspace,
            member=create_user,
            entity_kind="work-item",
            entity_id="KIR-42",
            remind_at=timezone.now() + timedelta(hours=1),
        )

        response = session_client.post(_url("operations-reminder-dismiss", workspace, pk=reminder.id))

        assert response.status_code == status.HTTP_200_OK
        assert response.json()["state"] == "dismissed"

    @pytest.mark.django_db
    def test_due_count_reflects_the_clock(self, session_client, workspace, create_user):
        Reminder.objects.create(
            workspace=workspace,
            member=create_user,
            entity_kind="work-item",
            entity_id="KIR-1",
            remind_at=timezone.now() + timedelta(hours=1),
        )
        overdue = Reminder.objects.create(
            workspace=workspace,
            member=create_user,
            entity_kind="work-item",
            entity_id="KIR-2",
            remind_at=timezone.now() + timedelta(hours=1),
        )
        Reminder.objects.filter(pk=overdue.pk).update(remind_at=timezone.now() - timedelta(minutes=5))

        listed = session_client.get(_url("operations-reminder", workspace)).json()

        assert listed["due_count"] == 1
