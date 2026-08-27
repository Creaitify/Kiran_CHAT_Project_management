# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Time entries, member rates, and the cost views built on both.

---------------------------------------------------------------------------
Who may see whose hours
---------------------------------------------------------------------------
Your own time is yours to log and edit. Everyone else's is visible to workspace
ADMINs only, and that split is deliberate: a timesheet is a record of how a
person spent their week, and making it readable by every colleague changes what
people write in it — which makes it worse data, not just less private.

Rates are stricter still: ADMIN for both read and write. A rate is what a
colleague costs, and there is no version of a team where everyone knowing that
is a neutral fact.

---------------------------------------------------------------------------
Cost is never stored
---------------------------------------------------------------------------
Nothing here writes a money column. Cost is computed from minutes and the rate
in force on the day, every time it is asked for — see
`plane.utils.operations.rollup`. That is what lets a backdated rate correction
fix history instead of leaving every past report disagreeing with the present.
"""

# Python imports
from datetime import timedelta

# Django imports
from django.db.models import Sum
from django.utils import timezone
from django.utils.dateparse import parse_date

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import MemberRateSerializer, TimeEntrySerializer
from plane.app.views.base import BaseViewSet
from plane.db.models import Issue, MemberRate, Project, TimeEntry, Workspace, WorkspaceMember
from plane.utils.operations.rollup import department_totals, summarise

# A window nobody needs in one request, and past which the rollup stops being
# cheap. Longer ranges are a report, and reports are their own endpoint.
MAX_RANGE_DAYS = 400


def _range(request):
    """`?start=&end=`, defaulting to the last 30 days inclusive.

    Returns `(start, end, error)`. Dates rather than datetimes throughout: time
    is logged against a day, and a timezone-aware boundary would make "Monday"
    mean different things to two people in the same standup.
    """
    today = timezone.now().date()
    start = parse_date(request.query_params.get("start") or "") or today - timedelta(days=29)
    end = parse_date(request.query_params.get("end") or "") or today

    if end < start:
        return None, None, "The end of the range is before its start."
    if (end - start).days > MAX_RANGE_DAYS:
        return None, None, f"Ask for at most {MAX_RANGE_DAYS} days at a time."
    return start, end, None


def _is_workspace_admin(slug, user_id):
    return WorkspaceMember.objects.filter(
        workspace__slug=slug, member_id=user_id, role=ROLE.ADMIN.value, is_active=True
    ).exists()


class TimeEntryViewSet(BaseViewSet):
    serializer_class = TimeEntrySerializer
    model = TimeEntry

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .select_related("project", "member")
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def list(self, request, slug):
        start, end, error = _range(request)
        if error:
            return Response({"error": error}, status=status.HTTP_400_BAD_REQUEST)

        entries = self.get_queryset().filter(spent_on__gte=start, spent_on__lte=end)

        # Scope is the permission, applied before anything else can widen it.
        member = request.query_params.get("member")
        if _is_workspace_admin(slug, request.user.id):
            if member:
                entries = entries.filter(member_id=member)
        else:
            entries = entries.filter(member_id=request.user.id)

        project = request.query_params.get("project")
        if project:
            entries = entries.filter(project_id=project)

        total = entries.aggregate(minutes=Sum("minutes"))["minutes"] or 0

        return Response(
            {
                "items": TimeEntrySerializer(entries, many=True).data,
                "total_minutes": total,
                "start": start,
                "end": end,
            },
            status=status.HTTP_200_OK,
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def create(self, request, slug):
        workspace = Workspace.objects.get(slug=slug)

        serializer = TimeEntrySerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        project = Project.objects.filter(workspace_id=workspace.id, id=request.data.get("project")).first()
        if not project:
            return Response({"project": ["Pick a project in this workspace."]}, status=status.HTTP_400_BAD_REQUEST)

        # Optional, and validated against the project rather than the workspace:
        # logging time to project A against a work item in project B would make
        # every per-project total wrong in two directions at once.
        work_item = None
        raw_work_item = request.data.get("work_item")
        if raw_work_item:
            work_item = Issue.objects.filter(project_id=project.id, id=raw_work_item).first()
            if not work_item:
                return Response(
                    {"work_item": ["That work item is not in this project."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        entry = TimeEntry.objects.create(
            workspace_id=workspace.id,
            project_id=project.id,
            work_item_id=work_item.id if work_item else None,
            # Always the caller. Logging time on someone else's behalf is a
            # different feature with a different audit story.
            member_id=request.user.id,
            **serializer.validated_data,
        )

        return Response(
            TimeEntrySerializer(self.get_queryset().get(pk=entry.id)).data,
            status=status.HTTP_201_CREATED,
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def partial_update(self, request, slug, pk):
        entry = self.get_queryset().get(pk=pk)
        if entry.member_id != request.user.id:
            return Response(
                {"error": "You can only edit your own time."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = TimeEntrySerializer(entry, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        serializer.save()
        return Response(
            TimeEntrySerializer(self.get_queryset().get(pk=pk)).data,
            status=status.HTTP_200_OK,
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def destroy(self, request, slug, pk):
        entry = self.get_queryset().get(pk=pk)
        # An admin may delete anyone's entry -- correcting a duplicate is a real
        # need -- but may not edit it, because rewriting someone else's record of
        # their own week is a different thing entirely.
        if entry.member_id != request.user.id and not _is_workspace_admin(slug, request.user.id):
            return Response(
                {"error": "You can only delete your own time."},
                status=status.HTTP_403_FORBIDDEN,
            )
        entry.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MemberRateViewSet(BaseViewSet):
    serializer_class = MemberRateSerializer
    model = MemberRate

    def get_queryset(self):
        return (
            super().get_queryset().filter(workspace__slug=self.kwargs.get("slug")).select_related("member")
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def list(self, request, slug):
        rates = self.get_queryset()
        member = request.query_params.get("member")
        if member:
            rates = rates.filter(member_id=member)
        return Response(MemberRateSerializer(rates, many=True).data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def create(self, request, slug):
        workspace = Workspace.objects.get(slug=slug)

        serializer = MemberRateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        member_id = request.data.get("member")
        if not WorkspaceMember.objects.filter(
            workspace_id=workspace.id, member_id=member_id, is_active=True
        ).exists():
            return Response({"member": ["Not a member of this workspace."]}, status=status.HTTP_400_BAD_REQUEST)

        # `update_or_create` rather than create: setting a rate twice for the
        # same effective date is a correction, not a conflict, and rejecting it
        # would leave the admin unable to fix a typo without a delete first.
        rate, _created = MemberRate.objects.update_or_create(
            workspace_id=workspace.id,
            member_id=member_id,
            effective_from=serializer.validated_data["effective_from"],
            defaults={
                "amount_minor": serializer.validated_data["amount_minor"],
                "currency": serializer.validated_data.get("currency", "INR"),
            },
        )

        return Response(MemberRateSerializer(rate).data, status=status.HTTP_201_CREATED)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def destroy(self, request, slug, pk):
        self.get_queryset().get(pk=pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class CostReportViewSet(BaseViewSet):
    """Cost, sliced the three ways anyone asks for it.

    ADMIN only, and not because the totals are secret -- because per-member cost
    is a per-member rate with extra steps, and the rate is the thing that is not
    everyone's business.
    """

    model = TimeEntry

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def list(self, request, slug):
        start, end, error = _range(request)
        if error:
            return Response({"error": error}, status=status.HTTP_400_BAD_REQUEST)

        workspace = Workspace.objects.get(slug=slug)
        department = request.query_params.get("department")

        return Response(
            {
                **summarise(workspace.id, start, end, department_id=department or None),
                "by_department": department_totals(workspace.id, start, end),
            },
            status=status.HTTP_200_OK,
        )
