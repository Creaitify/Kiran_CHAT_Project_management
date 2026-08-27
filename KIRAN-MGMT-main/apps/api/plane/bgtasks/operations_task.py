# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
The three things operations does on a clock.

- **`send_scheduled_reports`** — weekly, generates each due schedule's summary.
- **`deliver_due_reminders`** — every minute, fires reminders whose time has come.
- **`suggest_project_links`** — daily, proposes cross-department project links.

All three follow the same two rules the chat sweep established, for the same
reasons:

**Idempotent by a stored marker, not by timing.** `last_run_for` on a schedule
and `state` on a reminder are what stop a double-send; beat firing twice, a
worker restarting mid-task, or a clock stepping backwards must not produce two
reports in one inbox.

**Failures are swallowed, not raised.** These run on a loop. A raised exception
becomes a retry storm against whatever is already broken, and the next pass picks
up exactly the same rows because nothing was marked done.
"""

# Python imports
import logging
from datetime import timedelta

# Django imports
from django.db.models import Q
from django.utils import timezone

# Third party imports
from celery import shared_task

# Module imports
from plane.db.models import (
    Notification,
    ProjectDepartment,
    ProjectLink,
    ProjectMember,
    Reminder,
    ReportRun,
    ReportSchedule,
)
from plane.utils.exception_logger import log_exception
from plane.utils.operations.rollup import summarise

logger = logging.getLogger("plane")


def last_complete_week(today=None):
    """The Monday–Sunday that ended before `today`.

    Duplicated deliberately from `views/operations/report.py`? No — imported
    there from here would be a view importing a task. It is four lines and the
    definition is in the docstring of both; if it ever grows, it moves to
    `utils/operations`.
    """
    today = today or timezone.now().date()
    this_monday = today - timedelta(days=today.weekday())
    start = this_monday - timedelta(days=7)
    return start, start + timedelta(days=6)


@shared_task
def send_scheduled_reports():
    """Generate every schedule due today.

    Due means: active, its `send_weekday` is today, and it has not already run
    for the week being reported. That last clause is the idempotency — a beat
    that fires twice on a Monday produces one report.
    """
    try:
        today = timezone.now().date()
        period_start, period_end = last_complete_week(today)

        schedules = ReportSchedule.objects.filter(
            is_active=True, send_weekday=today.weekday()
        ).exclude(last_run_for=period_start)

        generated = 0
        for schedule in schedules.select_related("department").prefetch_related("recipients"):
            try:
                payload = summarise(
                    schedule.workspace_id, period_start, period_end, department_id=schedule.department_id
                )

                run = ReportRun.objects.create(
                    workspace_id=schedule.workspace_id,
                    schedule_id=schedule.id,
                    period_start=period_start,
                    period_end=period_end,
                    payload=payload,
                )

                _notify_recipients(schedule, run)

                # Marked only after the run exists. A crash between the two
                # leaves the schedule un-marked, and the next pass redoes it —
                # which is the right way round: a duplicated report is a
                # nuisance, a missing one is a decision made without data.
                schedule.last_run_for = period_start
                schedule.save(update_fields=["last_run_for", "updated_at"])
                generated += 1
            except Exception as e:
                # One bad schedule must not stop the rest.
                log_exception(e)

        if generated:
            logger.info("generated %s scheduled report(s) for %s", generated, period_start)
        return generated
    except Exception as e:
        log_exception(e)
        return 0


def _notify_recipients(schedule, run):
    """Put the report in each recipient's notification feed.

    Deliberately in-product rather than email. KIRAN's email path is configured
    per-instance and frequently is not; a weekly report that silently fails to
    send is worse than one that is definitely somewhere the person already
    looks. Email is a later addition to this function, not a redesign.
    """
    totals = run.payload.get("totals", {})
    scope = schedule.department.name if schedule.department else "the workspace"

    summary = (
        f"{scope}: {totals.get('hours', 0)} hours logged "
        f"between {run.period_start} and {run.period_end}."
    )

    # `sender` is a required, un-defaulted CharField and the codebase uses it as
    # a routing key -- `in_app:<source>:<event>`. `message` is a JSONField, not
    # text; `message_stripped` is the plain-text mirror the feed renders.
    Notification.objects.bulk_create(
        [
            Notification(
                workspace_id=schedule.workspace_id,
                sender="in_app:operations:weekly_report",
                receiver_id=recipient.id,
                triggered_by_id=None,
                entity_name="report_run",
                entity_identifier=run.id,
                title=schedule.name,
                message={"text": summary},
                message_stripped=summary,
                data={"report_run_id": str(run.id), "period_start": str(run.period_start)},
            )
            for recipient in schedule.recipients.all()
        ]
    )


@shared_task
def deliver_due_reminders():
    """Fire every pending reminder whose time has passed.

    Read-then-write rather than one UPDATE, because each row produces a
    notification. The `state` transition is what makes it safe: a row already
    marked `sent` is not selected again, so a worker dying mid-loop re-delivers
    at most the one it was holding.
    """
    try:
        now = timezone.now()
        due = list(
            Reminder.objects.filter(state=Reminder.State.PENDING, remind_at__lte=now).select_related("member")[:500]
        )
        if not due:
            return 0

        Notification.objects.bulk_create(
            [
                Notification(
                    workspace_id=reminder.workspace_id,
                    sender="in_app:operations:reminder",
                    receiver_id=reminder.member_id,
                    triggered_by_id=None,
                    entity_name="reminder",
                    entity_identifier=reminder.id,
                    title=reminder.entity_label or "Reminder",
                    message={"text": reminder.note or "You asked to be reminded about this."},
                    message_stripped=reminder.note or "You asked to be reminded about this.",
                    data={
                        "reminder_id": str(reminder.id),
                        "entity_kind": reminder.entity_kind,
                        "entity_id": reminder.entity_id,
                    },
                )
                for reminder in due
            ]
        )

        Reminder.objects.filter(id__in=[reminder.id for reminder in due]).update(
            state=Reminder.State.SENT,
            sent_at=now,
            # `.update()` bypasses auto_now, and something has to move here or a
            # client polling on updated_at never learns the reminder fired.
            updated_at=now,
        )

        logger.info("delivered %s reminder(s)", len(due))
        return len(due)
    except Exception as e:
        log_exception(e)
        return 0


# How many people two projects must share before a link is worth proposing.
# Two is noise -- a manager and a designer touch everything. Three is a team.
SHARED_MEMBER_THRESHOLD = 3


@shared_task
def suggest_project_links():
    """Propose links between projects in different departments.

    This is the "automatic linking of projects across departments" ask, and the
    automatic half stops at *proposing*. A suggestion carries the sentence
    explaining it and does nothing until a person accepts — because a system that
    silently asserts how the business is organised is one nobody can correct.

    The signal is shared people. Two projects in different departments with three
    or more members in common are, in practice, one piece of work being done by
    two teams; that is exactly the relationship a cross-department report needs
    to know about and the org chart does not record.
    """
    try:
        # project -> the departments it belongs to
        departments_by_project = {}
        for project_id, department_id in ProjectDepartment.objects.values_list("project_id", "department_id"):
            departments_by_project.setdefault(project_id, set()).add(department_id)

        # member -> the projects they are on, workspace-scoped by the project
        projects_by_member = {}
        rows = ProjectMember.objects.filter(is_active=True).values_list("member_id", "project_id", "workspace_id")
        workspace_of = {}
        for member_id, project_id, workspace_id in rows:
            projects_by_member.setdefault(member_id, set()).add(project_id)
            workspace_of[project_id] = workspace_id

        # Count shared members per unordered project pair. Only pairs that are
        # already in *different* departments are interesting: two projects in one
        # department sharing people is just a department.
        shared = {}
        for project_ids in projects_by_member.values():
            ordered = sorted(project_ids, key=str)
            for index, first in enumerate(ordered):
                for second in ordered[index + 1 :]:
                    first_departments = departments_by_project.get(first)
                    second_departments = departments_by_project.get(second)
                    if not first_departments or not second_departments:
                        continue
                    if first_departments & second_departments:
                        continue
                    shared[(first, second)] = shared.get((first, second), 0) + 1

        proposed = 0
        for (first, second), count in shared.items():
            if count < SHARED_MEMBER_THRESHOLD:
                continue
            workspace_id = workspace_of.get(first)
            if not workspace_id or workspace_id != workspace_of.get(second):
                continue

            # Either direction already existing is an answer: a person made a
            # link, or accepted one, or the sweep proposed it last time.
            if ProjectLink.objects.filter(
                Q(source_id=first, target_id=second) | Q(source_id=second, target_id=first)
            ).exists():
                continue

            ProjectLink.objects.create(
                workspace_id=workspace_id,
                source_id=first,
                target_id=second,
                kind=ProjectLink.Kind.RELATED,
                origin=ProjectLink.Origin.SUGGESTED,
                # Written for a person, and rendered verbatim.
                rationale=f"{count} people work on both projects, across different departments.",
            )
            proposed += 1

        if proposed:
            logger.info("proposed %s cross-department project link(s)", proposed)
        return proposed
    except Exception as e:
        log_exception(e)
        return 0
