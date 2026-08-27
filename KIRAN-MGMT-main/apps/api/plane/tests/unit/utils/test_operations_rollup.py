# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
The cost arithmetic, against a real database.

Every operations surface that shows money goes through `summarise`, so this is
the file that decides whether a finance number is right. Three properties carry
the weight, and none of them is obvious from reading the models:

1. **A rate is effective-dated.** An hour logged before a raise costs the old
   rate, an hour after it costs the new one, and a report re-run next year must
   still price last year at last year's rate. Storing cost on the entry would
   have made that impossible; deriving it makes it a bisect.

2. **Unpriced time is visible, never free.** Someone with no rate contributes
   hours and zero money, and the zero is *reported separately*. A department
   whose costs look low because half its people were never rated is precisely
   the wrong thing to hand someone making a budget decision.

3. **Department rows sum to more than the workspace total.** A project in two
   departments counts in both. That is the honest answer, and the test exists so
   nobody "fixes" it into an invented split later.
"""

from datetime import date, timedelta

import pytest

from plane.db.models import Department, MemberRate, Project, ProjectDepartment, TimeEntry
from plane.tests.factories import UserFactory, WorkspaceFactory
from plane.utils.operations.rollup import RateBook, department_totals, summarise

# 500.00 and 600.00 an hour, in paise.
RATE_LOW = 50_000
RATE_HIGH = 60_000

JAN = date(2026, 1, 1)
JUN = date(2026, 6, 1)


@pytest.fixture
def workspace(db):
    return WorkspaceFactory(owner=UserFactory())


def _project(workspace, name="Platform", identifier="PLT"):
    return Project.objects.create(
        workspace=workspace,
        name=name,
        identifier=identifier,
        default_assignee=workspace.owner,
        project_lead=workspace.owner,
    )


def _rate(workspace, member, amount, effective_from):
    return MemberRate.objects.create(
        workspace=workspace, member=member, amount_minor=amount, effective_from=effective_from
    )


def _log(workspace, project, member, spent_on, minutes):
    return TimeEntry.objects.create(
        workspace=workspace, project=project, member=member, spent_on=spent_on, minutes=minutes
    )


@pytest.mark.unit
@pytest.mark.django_db
class TestRateBook:
    def test_a_rate_applies_from_its_effective_date(self, workspace):
        _rate(workspace, workspace.owner, RATE_LOW, JAN)
        book = RateBook.for_workspace(workspace.id)

        assert book.rate_minor_on(workspace.owner_id, JAN - timedelta(days=1)) is None
        assert book.rate_minor_on(workspace.owner_id, JAN) == RATE_LOW
        assert book.rate_minor_on(workspace.owner_id, JAN + timedelta(days=90)) == RATE_LOW

    def test_a_raise_prices_the_two_sides_differently(self, workspace):
        _rate(workspace, workspace.owner, RATE_LOW, JAN)
        _rate(workspace, workspace.owner, RATE_HIGH, JUN)
        book = RateBook.for_workspace(workspace.id)

        assert book.rate_minor_on(workspace.owner_id, JUN - timedelta(days=1)) == RATE_LOW
        assert book.rate_minor_on(workspace.owner_id, JUN) == RATE_HIGH

    def test_a_member_with_no_rate_is_unpriced_not_free(self, workspace):
        book = RateBook.for_workspace(workspace.id)
        assert book.cost_minor(workspace.owner_id, JAN, 60) is None


@pytest.mark.unit
@pytest.mark.django_db
class TestSummarise:
    def test_an_hour_costs_the_rate(self, workspace):
        project = _project(workspace)
        _rate(workspace, workspace.owner, RATE_LOW, JAN)
        _log(workspace, project, workspace.owner, JAN + timedelta(days=10), 60)

        result = summarise(workspace.id, JAN, JAN + timedelta(days=30))

        assert result["totals"]["minutes"] == 60
        assert result["totals"]["cost_minor"] == RATE_LOW
        assert result["totals"]["unpriced_minutes"] == 0

    def test_a_backdated_raise_reprices_history(self, workspace):
        """The reason cost is never stored on the entry."""
        project = _project(workspace)
        _rate(workspace, workspace.owner, RATE_LOW, JAN)
        _log(workspace, project, workspace.owner, JAN + timedelta(days=10), 60)

        before = summarise(workspace.id, JAN, JAN + timedelta(days=30))["totals"]["cost_minor"]

        # Correcting the rate that was in force changes what that hour cost.
        MemberRate.objects.filter(workspace=workspace, effective_from=JAN).update(amount_minor=RATE_HIGH)
        after = summarise(workspace.id, JAN, JAN + timedelta(days=30))["totals"]["cost_minor"]

        assert before == RATE_LOW
        assert after == RATE_HIGH

    def test_unpriced_time_counts_as_hours_but_not_money(self, workspace):
        project = _project(workspace)
        unrated = UserFactory()
        _rate(workspace, workspace.owner, RATE_LOW, JAN)
        _log(workspace, project, workspace.owner, JAN + timedelta(days=1), 60)
        _log(workspace, project, unrated, JAN + timedelta(days=1), 120)

        totals = summarise(workspace.id, JAN, JAN + timedelta(days=30))["totals"]

        assert totals["minutes"] == 180
        assert totals["cost_minor"] == RATE_LOW
        assert totals["unpriced_minutes"] == 120

    def test_the_range_end_is_inclusive(self, workspace):
        """A weekly report that silently dropped Sunday would be wrong for
        months before anyone noticed."""
        project = _project(workspace)
        _rate(workspace, workspace.owner, RATE_LOW, JAN)
        end = JAN + timedelta(days=6)
        _log(workspace, project, workspace.owner, end, 60)

        assert summarise(workspace.id, JAN, end)["totals"]["minutes"] == 60

    def test_time_outside_the_range_is_excluded(self, workspace):
        project = _project(workspace)
        _rate(workspace, workspace.owner, RATE_LOW, JAN)
        _log(workspace, project, workspace.owner, JAN + timedelta(days=40), 60)

        assert summarise(workspace.id, JAN, JAN + timedelta(days=30))["totals"]["minutes"] == 0

    def test_breakdowns_are_sorted_by_spend(self, workspace):
        cheap = _project(workspace, name="Cheap", identifier="CHP")
        pricey = _project(workspace, name="Pricey", identifier="PRC")
        _rate(workspace, workspace.owner, RATE_LOW, JAN)
        _log(workspace, cheap, workspace.owner, JAN + timedelta(days=1), 60)
        _log(workspace, pricey, workspace.owner, JAN + timedelta(days=1), 600)

        rows = summarise(workspace.id, JAN, JAN + timedelta(days=30))["by_project"]

        assert [row["name"] for row in rows] == ["Pricey", "Cheap"]

    def test_a_department_scope_narrows_to_its_projects(self, workspace):
        inside = _project(workspace, name="Inside", identifier="INS")
        outside = _project(workspace, name="Outside", identifier="OUT")
        department = Department.objects.create(workspace=workspace, name="Engineering", code="ENG")
        ProjectDepartment.objects.create(workspace=workspace, project=inside, department=department)

        _rate(workspace, workspace.owner, RATE_LOW, JAN)
        _log(workspace, inside, workspace.owner, JAN + timedelta(days=1), 60)
        _log(workspace, outside, workspace.owner, JAN + timedelta(days=1), 60)

        scoped = summarise(workspace.id, JAN, JAN + timedelta(days=30), department_id=department.id)

        assert scoped["totals"]["minutes"] == 60


@pytest.mark.unit
@pytest.mark.django_db
class TestDepartmentTotals:
    def test_a_shared_project_counts_in_both_departments(self, workspace):
        """Deliberate, and the reason the UI says so. Splitting the time by an
        invented ratio would produce a number nobody can defend."""
        shared = _project(workspace, name="Shared", identifier="SHR")
        engineering = Department.objects.create(workspace=workspace, name="Engineering", code="ENG")
        operations = Department.objects.create(workspace=workspace, name="Operations", code="OPS")
        ProjectDepartment.objects.create(workspace=workspace, project=shared, department=engineering)
        ProjectDepartment.objects.create(workspace=workspace, project=shared, department=operations)

        _rate(workspace, workspace.owner, RATE_LOW, JAN)
        _log(workspace, shared, workspace.owner, JAN + timedelta(days=1), 60)

        rows = {row["code"]: row for row in department_totals(workspace.id, JAN, JAN + timedelta(days=30))}

        assert rows["ENG"]["minutes"] == 60
        assert rows["OPS"]["minutes"] == 60

        workspace_total = summarise(workspace.id, JAN, JAN + timedelta(days=30))["totals"]["minutes"]
        assert rows["ENG"]["minutes"] + rows["OPS"]["minutes"] > workspace_total

    def test_a_department_with_no_projects_reports_zero_not_nothing(self, workspace):
        Department.objects.create(workspace=workspace, name="Finance", code="FIN")

        rows = department_totals(workspace.id, JAN, JAN + timedelta(days=30))

        assert len(rows) == 1
        assert rows[0]["minutes"] == 0
        assert rows[0]["project_count"] == 0
