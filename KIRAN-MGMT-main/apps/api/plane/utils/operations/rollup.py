# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Turning time into money, and both into a summary.

Every operations feature that shows a number goes through here: the time view,
the cost view, the weekly report, and the department rollup. One implementation,
because four that agree today would be four that disagree by Christmas -- and a
finance number that two screens report differently is worse than one nobody
shows at all.

---------------------------------------------------------------------------
The rate lookup is the whole difficulty
---------------------------------------------------------------------------
`MemberRate` is effective-dated: rows say "from this date, this person costs
this much", and a change is a new row rather than an edit. So the cost of an
entry is not "the member's rate" -- it is *the rate that was in force on the day
the time was spent*.

Doing that per entry is one query per row. Doing it once, by loading each
member's rate history and walking it, is one query for the whole report; the
histories are tiny (a person gets a raise once or twice a year) and the
arithmetic is a bisect. That is what `RateBook` is.

An entry with no applicable rate contributes **zero cost and is counted
separately** -- never silently priced at zero and folded into the total. A
department whose costs look low because half its people were never given a rate
is precisely the wrong thing to hand someone making a budget decision.
"""

# Python imports
from bisect import bisect_right
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date

# Django imports
from django.db.models import Sum

# Module imports
from plane.db.models import MemberRate, ProjectDepartment, TimeEntry


@dataclass
class RateBook:
    """Every member's rate history, ready to answer "what did they cost on X".

    Built once per rollup. `_by_member` maps a member id to two parallel lists --
    the effective dates ascending, and the matching rows -- so a lookup is a
    bisect rather than a query.
    """

    _dates: dict = field(default_factory=lambda: defaultdict(list))
    _rows: dict = field(default_factory=lambda: defaultdict(list))
    currency: str = "INR"

    @classmethod
    def for_workspace(cls, workspace_id) -> "RateBook":
        book = cls()
        rates = MemberRate.objects.filter(workspace_id=workspace_id).order_by("member_id", "effective_from")
        for rate in rates:
            book._dates[rate.member_id].append(rate.effective_from)
            book._rows[rate.member_id].append(rate)
            # Last one wins. A workspace mixing currencies is a real problem, but
            # it is a data problem to surface elsewhere, not a reason for a
            # rollup to refuse to produce a number.
            book.currency = rate.currency
        return book

    def rate_minor_on(self, member_id, when: date):
        """Minor units per hour in force on `when`, or None if there was no rate."""
        dates = self._dates.get(member_id)
        if not dates:
            return None
        # The rightmost effective_from that is <= when.
        position = bisect_right(dates, when) - 1
        if position < 0:
            return None
        return self._rows[member_id][position].amount_minor

    def cost_minor(self, member_id, when: date, minutes: int):
        """Cost of `minutes` at the applicable rate, or None when unpriced.

        Integer arithmetic all the way down, rounding once at the end. Summing
        floats over a quarter of timesheets is how a total ends up a rupee off
        and nobody can say which row moved it.
        """
        hourly = self.rate_minor_on(member_id, when)
        if hourly is None:
            return None
        return round(hourly * minutes / 60)


@dataclass
class Totals:
    minutes: int = 0
    cost_minor: int = 0
    #: Minutes that had no applicable rate. Reported, never priced at zero.
    unpriced_minutes: int = 0

    def add(self, minutes: int, cost_minor):
        self.minutes += minutes
        if cost_minor is None:
            self.unpriced_minutes += minutes
        else:
            self.cost_minor += cost_minor

    def as_dict(self):
        return {
            "minutes": self.minutes,
            "hours": round(self.minutes / 60, 2),
            "cost_minor": self.cost_minor,
            "unpriced_minutes": self.unpriced_minutes,
        }


def entries_for(workspace_id, start: date, end: date, *, department_id=None, project_ids=None):
    """Time entries in a window, optionally narrowed.

    `end` is inclusive. A report for "last week" that silently excluded Sunday
    would be wrong in a way nobody catches for months.
    """
    queryset = TimeEntry.objects.filter(
        workspace_id=workspace_id, spent_on__gte=start, spent_on__lte=end
    ).select_related("project", "member")

    if department_id is not None:
        scoped = ProjectDepartment.objects.filter(department_id=department_id).values_list("project_id", flat=True)
        queryset = queryset.filter(project_id__in=scoped)

    if project_ids is not None:
        queryset = queryset.filter(project_id__in=project_ids)

    return queryset


def summarise(workspace_id, start: date, end: date, *, department_id=None):
    """The shape every operations surface renders.

    Grand total plus two breakdowns, because "where did the money go" is asked
    two ways -- by project and by person -- and computing both from one pass over
    the entries is cheaper than two queries that might disagree.
    """
    book = RateBook.for_workspace(workspace_id)

    overall = Totals()
    by_project = defaultdict(Totals)
    by_member = defaultdict(Totals)
    project_names = {}
    member_names = {}

    for entry in entries_for(workspace_id, start, end, department_id=department_id):
        cost = book.cost_minor(entry.member_id, entry.spent_on, entry.minutes)
        overall.add(entry.minutes, cost)
        by_project[entry.project_id].add(entry.minutes, cost)
        by_member[entry.member_id].add(entry.minutes, cost)
        project_names[entry.project_id] = entry.project.name
        member_names[entry.member_id] = entry.member.display_name or entry.member.email

    return {
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "currency": book.currency,
        "totals": overall.as_dict(),
        # Sorted by spend, because a report is read from the top and the top is
        # the part anybody acts on.
        "by_project": sorted(
            (
                {"project_id": str(pid), "name": project_names.get(pid, "Unknown"), **totals.as_dict()}
                for pid, totals in by_project.items()
            ),
            key=lambda row: row["cost_minor"],
            reverse=True,
        ),
        "by_member": sorted(
            (
                {"member_id": str(mid), "name": member_names.get(mid, "Unknown"), **totals.as_dict()}
                for mid, totals in by_member.items()
            ),
            key=lambda row: row["cost_minor"],
            reverse=True,
        ),
    }


def department_totals(workspace_id, start: date, end: date):
    """One row per department. The cross-department view Scope.pdf asked for.

    A project in two departments contributes its time to **both**, and the rows
    therefore sum to more than the workspace total. That is the honest answer to
    "what did engineering spend" when engineering genuinely shares a project with
    operations, and the alternative -- splitting the time by some invented ratio
    -- would be a number nobody could defend.
    """
    from plane.db.models import Department

    book = RateBook.for_workspace(workspace_id)
    memberships = ProjectDepartment.objects.filter(workspace_id=workspace_id).values_list(
        "department_id", "project_id"
    )

    projects_by_department = defaultdict(set)
    for department_id, project_id in memberships:
        projects_by_department[department_id].add(project_id)

    entries = list(entries_for(workspace_id, start, end))
    rows = []

    for department in Department.objects.filter(workspace_id=workspace_id):
        scoped = projects_by_department.get(department.id, set())
        totals = Totals()
        for entry in entries:
            if entry.project_id in scoped:
                totals.add(entry.minutes, book.cost_minor(entry.member_id, entry.spent_on, entry.minutes))
        rows.append(
            {
                "department_id": str(department.id),
                "code": department.code,
                "name": department.name,
                "project_count": len(scoped),
                **totals.as_dict(),
            }
        )

    return sorted(rows, key=lambda row: row["cost_minor"], reverse=True)


def minutes_by_member(workspace_id, start: date, end: date):
    """Just the hours, without pricing them. The timesheet view's own summary."""
    return {
        row["member_id"]: row["total"]
        for row in entries_for(workspace_id, start, end)
        .values("member_id")
        .annotate(total=Sum("minutes"))
        .order_by()
    }
