# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Operations -- departments, time, cost, reports and reminders.

The five project-management asks from Scope.pdf, and they are one domain rather
than five features: a department is the unit work is grouped by, time is what
people spend on it, cost is time priced, a weekly report is those three
summarised, and a reminder is the nudge that keeps any of it moving.

Four decisions shape the schema.

1. **Departments are a grouping, not a permission.** Putting a project in a
   department changes what a report totals and how the org chart reads. It grants
   nobody access to anything. KIRAN already has one permission system -- workspace
   and project roles -- and a second one that looked like org structure would be
   the kind of thing that is wrong for years before anyone notices.

2. **Time is stored in minutes, as an integer.** Hours as a float accumulates
   error over a quarter of summing, and "7.4 hours" is a worse thing to render
   than "7h 24m". Every rollup is integer arithmetic until the last division.

3. **Cost is derived, never stored on the entry.** A `TimeEntry` records minutes;
   money comes from multiplying by whichever `MemberRate` was in force on that
   date. Storing a cost column would freeze it at write time, and the first
   backdated rate change would silently disagree with every report already sent.
   Rates are therefore effective-dated and never edited in place.

4. **A reminder points at a work item the way any cross-app reference does.**
   `entity_kind` + `entity_id`, matching `core/apps/links.ts` -- so a reminder can
   later hang off something that is not a work item without a migration, and the
   work item's own screen finds it through the backlink contract rather than
   through an import.
"""

# Django imports
from django.conf import settings
from django.db import models

# Module imports
from .base import BaseModel


class Department(BaseModel):
    """A team or business unit. The dimension reports slice by."""

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="departments")

    name = models.CharField(max_length=255)
    # Short form for dense UI -- "ENG", "OPS". Uppercased at the serializer.
    code = models.CharField(max_length=12)
    description = models.TextField(blank=True, default="")
    # Not an owner and not a permission: the person a report is addressed to.
    lead = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="led_departments"
    )

    class Meta:
        verbose_name = "Department"
        verbose_name_plural = "Departments"
        db_table = "departments"
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "code"],
                condition=models.Q(deleted_at__isnull=True),
                name="department_unique_workspace_code_when_not_deleted",
            )
        ]
        indexes = [models.Index(fields=["workspace", "code"], name="department_ws_code_idx")]

    def __str__(self):
        return f"{self.code} — {self.name}"


class ProjectDepartment(BaseModel):
    """Which departments a project belongs to.

    Many-to-many on purpose. A project delivered by engineering and paid for by
    operations belongs to both, and forcing a single owner is what makes cost
    reporting quietly wrong -- the second department's spend disappears.
    """

    class Role(models.TextChoices):
        OWNER = "owner", "Owner"
        CONTRIBUTOR = "contributor", "Contributor"

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="project_departments")
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="departments")
    department = models.ForeignKey(Department, on_delete=models.CASCADE, related_name="projects")
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.CONTRIBUTOR)

    class Meta:
        verbose_name = "Project Department"
        verbose_name_plural = "Project Departments"
        db_table = "project_departments"
        ordering = ("created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["project", "department"],
                condition=models.Q(deleted_at__isnull=True),
                name="project_department_unique_when_not_deleted",
            )
        ]
        indexes = [models.Index(fields=["department", "project"], name="project_dept_dept_proj_idx")]

    def __str__(self):
        return f"{self.project_id}:{self.department_id}"


class ProjectLink(BaseModel):
    """A typed relationship between two projects.

    This is the "automatic linking of projects across departments" ask, and the
    automatic half is `plane.bgtasks.operations_link_task`: a link is *proposed*
    when two projects in different departments share people or reference each
    other's work, and a person confirms it. Proposed links are visible and
    dismissible; nothing is silently asserted about how the business works.
    """

    class Kind(models.TextChoices):
        RELATED = "related", "Related"
        DEPENDS_ON = "depends_on", "Depends on"
        BLOCKS = "blocks", "Blocks"

    class Origin(models.TextChoices):
        MANUAL = "manual", "Created by a person"
        SUGGESTED = "suggested", "Proposed automatically"

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="project_links")
    source = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="outgoing_links")
    target = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="incoming_links")

    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.RELATED)
    origin = models.CharField(max_length=20, choices=Origin.choices, default=Origin.MANUAL)
    # Why the sweep proposed this. Rendered verbatim, so it is written for a
    # person: "7 people work on both".
    rationale = models.TextField(blank=True, default="")
    # Null while a suggestion is pending. Set on accept; a rejected suggestion is
    # deleted, because keeping it means re-explaining the same "no" every week.
    confirmed_at = models.DateTimeField(null=True, blank=True)
    confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        verbose_name = "Project Link"
        verbose_name_plural = "Project Links"
        db_table = "project_links"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["source", "target", "kind"],
                condition=models.Q(deleted_at__isnull=True),
                name="project_link_unique_source_target_kind_when_not_deleted",
            )
        ]
        indexes = [models.Index(fields=["workspace", "confirmed_at"], name="project_link_ws_confirmed_idx")]

    def __str__(self):
        return f"{self.source_id} {self.kind} {self.target_id}"


class MemberRate(BaseModel):
    """What one person's time costs, from a date onwards.

    Effective-dated and never edited in place. A rate change is a new row, so a
    report run today over last quarter still prices last quarter's hours at last
    quarter's rate -- which is the only behaviour that lets a finance number be
    re-derived rather than merely remembered.
    """

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="member_rates")
    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="rates")

    # Minor units -- paise, cents. Money in a float is a bug waiting for a
    # quarterly total, and DecimalField would still need a currency beside it.
    amount_minor = models.BigIntegerField()
    currency = models.CharField(max_length=3, default="INR")
    effective_from = models.DateField()

    class Meta:
        verbose_name = "Member Rate"
        verbose_name_plural = "Member Rates"
        db_table = "member_rates"
        ordering = ("-effective_from",)
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "member", "effective_from"],
                condition=models.Q(deleted_at__isnull=True),
                name="member_rate_unique_member_effective_when_not_deleted",
            )
        ]
        indexes = [models.Index(fields=["member", "-effective_from"], name="member_rate_member_eff_idx")]

    def __str__(self):
        return f"{self.member_id}@{self.effective_from}"


class TimeEntry(BaseModel):
    """Minutes one person spent on one project on one day."""

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="time_entries")
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="time_entries")
    # Optional: time is often spent on a project without a work item to hang it
    # on -- a planning session, a review. Forcing one produces fictional tickets.
    work_item = models.ForeignKey(
        "db.Issue", on_delete=models.SET_NULL, null=True, blank=True, related_name="time_entries"
    )
    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="time_entries")

    spent_on = models.DateField()
    # Integer minutes. See the module docstring: hours as a float accumulates
    # error over a quarter of summing.
    minutes = models.PositiveIntegerField()
    note = models.TextField(blank=True, default="")

    class Meta:
        verbose_name = "Time Entry"
        verbose_name_plural = "Time Entries"
        db_table = "time_entries"
        ordering = ("-spent_on", "-created_at")
        indexes = [
            # The rollup path: everything is "sum minutes for a workspace over a
            # date range", then grouped.
            models.Index(fields=["workspace", "-spent_on"], name="time_entry_ws_spent_idx"),
            models.Index(fields=["member", "-spent_on"], name="time_entry_member_spent_idx"),
            models.Index(fields=["project", "-spent_on"], name="time_entry_project_spent_idx"),
        ]

    def __str__(self):
        return f"{self.member_id} {self.minutes}m on {self.spent_on}"


class ReportSchedule(BaseModel):
    """A recurring summary, and where it goes.

    Scope is deliberately one nullable department rather than a list: "the
    engineering weekly" and "the whole-workspace weekly" are different reports
    with different audiences, and one row each is clearer than one row with a
    filter nobody can read at a glance.
    """

    class Cadence(models.TextChoices):
        WEEKLY = "weekly", "Weekly"

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="report_schedules")
    department = models.ForeignKey(
        Department, on_delete=models.CASCADE, null=True, blank=True, related_name="report_schedules"
    )

    name = models.CharField(max_length=255)
    cadence = models.CharField(max_length=20, choices=Cadence.choices, default=Cadence.WEEKLY)
    # 0 = Monday, matching Python's `weekday()`, so the beat task compares
    # directly rather than translating a convention at every call site.
    send_weekday = models.PositiveSmallIntegerField(default=0)
    recipients = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name="report_schedules")
    is_active = models.BooleanField(default=True)
    # The sweep's idempotency key: a schedule already run for a period is not
    # run again, whatever the beat does.
    last_run_for = models.DateField(null=True, blank=True)

    class Meta:
        verbose_name = "Report Schedule"
        verbose_name_plural = "Report Schedules"
        db_table = "report_schedules"
        ordering = ("name",)
        indexes = [models.Index(fields=["workspace", "is_active"], name="report_sched_ws_active_idx")]

    def __str__(self):
        return self.name


class ReportRun(BaseModel):
    """One generated report. Kept, so a number can be looked up rather than recomputed."""

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="report_runs")
    schedule = models.ForeignKey(
        ReportSchedule, on_delete=models.SET_NULL, null=True, blank=True, related_name="runs"
    )

    period_start = models.DateField()
    period_end = models.DateField()
    # The computed summary: totals, per-project and per-member breakdowns. A JSON
    # column because the shape is a rendering concern that will change, and
    # normalising a snapshot would mean migrating history every time it does.
    payload = models.JSONField(default=dict)

    class Meta:
        verbose_name = "Report Run"
        verbose_name_plural = "Report Runs"
        db_table = "report_runs"
        ordering = ("-period_end", "-created_at")
        indexes = [models.Index(fields=["workspace", "-period_end"], name="report_run_ws_period_idx")]

    def __str__(self):
        return f"{self.period_start}..{self.period_end}"


class Reminder(BaseModel):
    """A nudge, pointed at something.

    `entity_kind` / `entity_id` mirror `TEntityRef` in `core/apps/links.ts`, so a
    reminder on a work item is the same row shape as a reminder on whatever the
    fourth app turns out to hold. The work item's own screen finds these through
    the backlink contract rather than by importing anything.
    """

    class State(models.TextChoices):
        PENDING = "pending", "Pending"
        SENT = "sent", "Sent"
        DISMISSED = "dismissed", "Dismissed"

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="reminders")
    # Who gets nudged. Null is not allowed: a reminder nobody owns is a note.
    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reminders")

    entity_kind = models.CharField(max_length=64)
    entity_id = models.CharField(max_length=255)
    # Denormalised at write time so a list of reminders renders without resolving
    # every target, and so a reminder still reads sensibly after its target moves.
    entity_label = models.CharField(max_length=255, blank=True, default="")

    note = models.TextField(blank=True, default="")
    remind_at = models.DateTimeField()
    state = models.CharField(max_length=20, choices=State.choices, default=State.PENDING)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Reminder"
        verbose_name_plural = "Reminders"
        db_table = "reminders"
        ordering = ("remind_at",)
        indexes = [
            models.Index(fields=["member", "state", "remind_at"], name="reminder_member_state_idx"),
            # The delivery sweep: pending rows whose time has come. Partial,
            # because a fired reminder is dead weight in this index forever.
            models.Index(
                fields=["remind_at"],
                condition=models.Q(state="pending"),
                name="reminder_pending_due_idx",
            ),
            models.Index(fields=["entity_kind", "entity_id"], name="reminder_entity_idx"),
        ]

    def __str__(self):
        return f"{self.entity_kind}:{self.entity_id} @ {self.remind_at}"
