# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Departments, and which projects belong to them.

The grouping dimension everything else in operations reports by. Read is any
workspace member — knowing the org chart is not privileged, and a report you
cannot see the shape of is a report you cannot check. Write is workspace ADMIN,
because a department that anyone can rename is a department no report can be
built on.

Membership is many-to-many on purpose. A project delivered by engineering and
paid for by operations belongs to both, and forcing one owner is what makes cost
reporting quietly wrong — the second department's spend simply disappears.
"""

# Django imports
from django.db import IntegrityError, transaction
from django.db.models import Count

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import DepartmentSerializer, ProjectDepartmentSerializer
from plane.app.views.base import BaseViewSet
from plane.db.models import Department, Project, ProjectDepartment, Workspace


class DepartmentViewSet(BaseViewSet):
    serializer_class = DepartmentSerializer
    model = Department

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            # Rendered on every row, so annotated rather than counted per row.
            .annotate(project_count=Count("projects", distinct=True))
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def list(self, request, slug):
        return Response(
            DepartmentSerializer(self.get_queryset(), many=True).data,
            status=status.HTTP_200_OK,
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def create(self, request, slug):
        workspace = Workspace.objects.get(slug=slug)
        serializer = DepartmentSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        try:
            department = Department.objects.create(workspace_id=workspace.id, **serializer.validated_data)
        except IntegrityError:
            # The unique (workspace, code) constraint. A field error so the form
            # can point at the code input rather than showing a toast about a
            # database.
            return Response(
                {"code": ["A department with this code already exists."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            DepartmentSerializer(self.get_queryset().get(pk=department.id)).data,
            status=status.HTTP_201_CREATED,
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def partial_update(self, request, slug, pk):
        department = self.get_queryset().get(pk=pk)
        serializer = DepartmentSerializer(department, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        try:
            serializer.save()
        except IntegrityError:
            return Response(
                {"code": ["A department with this code already exists."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            DepartmentSerializer(self.get_queryset().get(pk=pk)).data,
            status=status.HTTP_200_OK,
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def destroy(self, request, slug, pk):
        department = self.get_queryset().get(pk=pk)
        # Soft delete cascades to memberships and schedules through the usual
        # related-object sweep. Time entries are untouched: they belong to
        # projects and people, and deleting a department must not erase the
        # record of work that was done.
        department.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def projects(self, request, slug, pk):
        """Replace this department's project list in one request.

        A set rather than add/remove calls, for the same reason mention-group
        membership is: "which projects are engineering's" is one decision, and
        sending it whole is what makes it atomic.
        """
        department = self.get_queryset().get(pk=pk)
        raw = request.data.get("project_ids")
        if not isinstance(raw, list):
            return Response({"project_ids": ["Send a list."]}, status=status.HTTP_400_BAD_REQUEST)

        # Silently narrowed to projects that exist in this workspace: the only
        # way to send anything else is a stale list, and failing the whole edit
        # over one archived project loses the other nine changes with it.
        wanted = set(
            Project.objects.filter(workspace_id=department.workspace_id, id__in=raw).values_list("id", flat=True)
        )
        current = {row.project_id for row in department.projects.all()}

        with transaction.atomic():
            removed = current - wanted
            if removed:
                ProjectDepartment.objects.filter(department_id=department.id, project_id__in=removed).delete()

            added = wanted - current
            if added:
                ProjectDepartment.objects.bulk_create(
                    [
                        ProjectDepartment(
                            workspace_id=department.workspace_id,
                            department_id=department.id,
                            project_id=project_id,
                        )
                        for project_id in added
                    ]
                )

        memberships = ProjectDepartment.objects.filter(department_id=department.id).select_related(
            "project", "department"
        )
        return Response(
            ProjectDepartmentSerializer(memberships, many=True).data,
            status=status.HTTP_200_OK,
        )
