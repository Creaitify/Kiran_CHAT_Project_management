# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Weekly reports: the schedules, and the runs they produce.

A schedule says "every Monday, summarise engineering, send it to these people".
The beat task in `plane.bgtasks.operations_report_task` does the sending; this is
where they are configured and where past runs are read back.

Runs are kept rather than recomputed. A number that was in someone's inbox on the
3rd should still say the same thing on the 20th, even after a backdated timesheet
correction — otherwise "the report said X" becomes unfalsifiable, which is the
one thing a finance summary must not be.

`preview` runs the same summariser the beat does, without saving. It exists so
nobody has to wait a week to find out whether a schedule is pointed at the right
department.
"""

# Python imports
from datetime import timedelta

# Django imports
from django.db import transaction
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import ReportRunSerializer, ReportScheduleSerializer
from plane.app.views.base import BaseViewSet
from plane.db.models import Department, ReportRun, ReportSchedule, Workspace, WorkspaceMember
from plane.utils.operations.rollup import summarise


def last_complete_week(today=None):
    """The Monday–Sunday that ended before today.

    A "weekly report" that included the current, partial week would show a number
    that is always lower than the real one and always changing, and would train
    people to distrust it. So it reports the last week that actually finished.
    """
    today = today or timezone.now().date()
    # weekday(): Monday is 0. Back up to this week's Monday, then one more week.
    this_monday = today - timedelta(days=today.weekday())
    start = this_monday - timedelta(days=7)
    return start, start + timedelta(days=6)


class ReportScheduleViewSet(BaseViewSet):
    serializer_class = ReportScheduleSerializer
    model = ReportSchedule

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .select_related("department")
            .prefetch_related("recipients")
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def list(self, request, slug):
        return Response(
            ReportScheduleSerializer(self.get_queryset(), many=True).data,
            status=status.HTTP_200_OK,
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def create(self, request, slug):
        workspace = Workspace.objects.get(slug=slug)

        serializer = ReportScheduleSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        recipient_ids = serializer.validated_data.pop("recipient_ids", [])

        department = None
        raw_department = request.data.get("department")
        if raw_department:
            department = Department.objects.filter(workspace_id=workspace.id, id=raw_department).first()
            if not department:
                return Response(
                    {"department": ["No such department in this workspace."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        with transaction.atomic():
            schedule = ReportSchedule.objects.create(
                workspace_id=workspace.id,
                department_id=department.id if department else None,
                **serializer.validated_data,
            )
            self._set_recipients(schedule, recipient_ids)

        return Response(
            ReportScheduleSerializer(self.get_queryset().get(pk=schedule.id)).data,
            status=status.HTTP_201_CREATED,
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def partial_update(self, request, slug, pk):
        schedule = self.get_queryset().get(pk=pk)

        serializer = ReportScheduleSerializer(schedule, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        # Absent means "leave the recipients alone"; `[]` means "send it to
        # nobody". Different requests, and `.pop` with a sentinel is what keeps
        # them different.
        recipient_ids = serializer.validated_data.pop("recipient_ids", None)

        with transaction.atomic():
            if serializer.validated_data:
                serializer.save()
            if recipient_ids is not None:
                self._set_recipients(schedule, recipient_ids)

        return Response(
            ReportScheduleSerializer(self.get_queryset().get(pk=pk)).data,
            status=status.HTTP_200_OK,
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def destroy(self, request, slug, pk):
        # Past runs survive: `ReportRun.schedule` is SET_NULL, so deleting a
        # schedule stops future sends without erasing what was already reported.
        self.get_queryset().get(pk=pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def preview(self, request, slug, pk):
        """What this schedule would send, for the last complete week.

        Computed, not saved. Previewing a report must not mark it as run, or the
        real one never goes out.
        """
        schedule = self.get_queryset().get(pk=pk)
        start, end = last_complete_week()

        return Response(
            {
                "period_start": start,
                "period_end": end,
                "payload": summarise(schedule.workspace_id, start, end, department_id=schedule.department_id),
            },
            status=status.HTTP_200_OK,
        )

    @staticmethod
    def _set_recipients(schedule, recipient_ids):
        """Narrowed to live workspace members, silently.

        The only way to send anything else is a stale directory, and failing the
        whole edit because one person left last week loses the other nine
        changes in the same request.
        """
        members = WorkspaceMember.objects.filter(
            workspace_id=schedule.workspace_id, member_id__in=recipient_ids, is_active=True
        ).values_list("member_id", flat=True)
        schedule.recipients.set(list(members))


class ReportRunViewSet(BaseViewSet):
    serializer_class = ReportRunSerializer
    model = ReportRun

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .select_related("schedule")
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def list(self, request, slug):
        runs = self.get_queryset()
        schedule = request.query_params.get("schedule")
        if schedule:
            runs = runs.filter(schedule_id=schedule)
        # A history, not an archive. Older runs are still in the table; the
        # screen that would need them does not exist yet.
        return Response(ReportRunSerializer(runs[:52], many=True).data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def retrieve(self, request, slug, pk):
        return Response(
            ReportRunSerializer(self.get_queryset().get(pk=pk)).data,
            status=status.HTTP_200_OK,
        )
