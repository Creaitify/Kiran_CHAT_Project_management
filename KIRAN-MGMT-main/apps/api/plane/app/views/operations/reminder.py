# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Reminders, and project links.

Two small surfaces that share a file because neither justifies its own.

---------------------------------------------------------------------------
A reminder belongs to exactly one person
---------------------------------------------------------------------------
You set reminders for yourself. There is no "remind Priya about this" here, and
that is a decision rather than an omission: a nudge you did not ask for, arriving
from a colleague, is a task assignment wearing a notification's clothes — and
KIRAN already has task assignment.

The target is `entity_kind` + `entity_id`, mirroring `TEntityRef` in
`core/apps/links.ts`. Nothing in this file knows what a work item is, so a
reminder on whatever the fourth app holds needs no migration and no change here.

---------------------------------------------------------------------------
Suggested project links are proposals, not assertions
---------------------------------------------------------------------------
`plane.bgtasks.operations_link_task` proposes a link when two projects in
different departments share enough people to look related. A proposal is visible,
carries the sentence explaining it, and does nothing until someone accepts it.
Rejecting deletes the row rather than flagging it, because a suggestion that
keeps coming back every week after being declined is worse than no suggestion.
"""

# Django imports
from django.db import IntegrityError
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import ProjectLinkSerializer, ReminderSerializer
from plane.app.views.base import BaseViewSet
from plane.db.models import Project, ProjectLink, Reminder, Workspace


class ReminderViewSet(BaseViewSet):
    serializer_class = ReminderSerializer
    model = Reminder

    def get_queryset(self):
        # Scoped to the caller, always. Ownership is the whole permission model
        # here, and applying it in the queryset means every action below inherits
        # it whether or not it remembers to ask.
        return (
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"), member_id=self.request.user.id)
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def list(self, request, slug):
        reminders = self.get_queryset()

        state = request.query_params.get("state")
        if state in Reminder.State.values:
            reminders = reminders.filter(state=state)

        # `?entity_kind=&entity_id=` is how another app's screen asks "are there
        # reminders on this?" -- the backlink path.
        kind = request.query_params.get("entity_kind")
        entity_id = request.query_params.get("entity_id")
        if kind and entity_id:
            reminders = reminders.filter(entity_kind=kind, entity_id=entity_id)

        return Response(
            {
                "items": ReminderSerializer(reminders[:200], many=True).data,
                "due_count": self.get_queryset()
                .filter(state=Reminder.State.PENDING, remind_at__lte=timezone.now())
                .count(),
            },
            status=status.HTTP_200_OK,
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def create(self, request, slug):
        workspace = Workspace.objects.get(slug=slug)

        serializer = ReminderSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        reminder = Reminder.objects.create(
            workspace_id=workspace.id,
            member_id=request.user.id,
            **serializer.validated_data,
        )
        return Response(ReminderSerializer(reminder).data, status=status.HTTP_201_CREATED)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def partial_update(self, request, slug, pk):
        reminder = self.get_queryset().get(pk=pk)
        serializer = ReminderSerializer(reminder, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        serializer.save()
        # Rescheduling revives a fired reminder: "remind me again tomorrow" is
        # the most common thing anyone does with one of these.
        if "remind_at" in serializer.validated_data:
            reminder.state = Reminder.State.PENDING
            reminder.sent_at = None
            reminder.save()

        return Response(ReminderSerializer(self.get_queryset().get(pk=pk)).data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def dismiss(self, request, slug, pk):
        reminder = self.get_queryset().get(pk=pk)
        reminder.state = Reminder.State.DISMISSED
        reminder.save()
        return Response(ReminderSerializer(reminder).data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def destroy(self, request, slug, pk):
        self.get_queryset().get(pk=pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectLinkViewSet(BaseViewSet):
    serializer_class = ProjectLinkSerializer
    model = ProjectLink

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .select_related("source", "target")
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def list(self, request, slug):
        links = self.get_queryset()

        project = request.query_params.get("project")
        if project:
            from django.db.models import Q

            links = links.filter(Q(source_id=project) | Q(target_id=project))

        # `?pending=1` is the review queue: what the sweep has proposed and
        # nobody has ruled on yet.
        if request.query_params.get("pending"):
            links = links.filter(confirmed_at__isnull=True)

        return Response(ProjectLinkSerializer(links, many=True).data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def create(self, request, slug):
        workspace = Workspace.objects.get(slug=slug)

        source_id = request.data.get("source")
        target_id = request.data.get("target")
        if not source_id or not target_id or source_id == target_id:
            return Response(
                {"error": "Pick two different projects."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        found = set(
            Project.objects.filter(workspace_id=workspace.id, id__in=[source_id, target_id]).values_list(
                "id", flat=True
            )
        )
        if len(found) != 2:
            return Response(
                {"error": "Both projects must be in this workspace."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        kind = request.data.get("kind") or ProjectLink.Kind.RELATED
        if kind not in ProjectLink.Kind.values:
            return Response({"kind": ["Unknown link type."]}, status=status.HTTP_400_BAD_REQUEST)

        try:
            link = ProjectLink.objects.create(
                workspace_id=workspace.id,
                source_id=source_id,
                target_id=target_id,
                kind=kind,
                origin=ProjectLink.Origin.MANUAL,
                # A link a person made is confirmed by definition; they are the
                # confirmation.
                confirmed_at=timezone.now(),
                confirmed_by_id=request.user.id,
            )
        except IntegrityError:
            return Response(
                {"error": "These projects are already linked that way."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            ProjectLinkSerializer(self.get_queryset().get(pk=link.id)).data,
            status=status.HTTP_201_CREATED,
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def confirm(self, request, slug, pk):
        """Accept a proposed link.

        Idempotent: confirming an already-confirmed link returns it unchanged,
        because the client cannot tell whether its first request landed.
        """
        link = self.get_queryset().get(pk=pk)
        if link.confirmed_at is None:
            link.confirmed_at = timezone.now()
            link.confirmed_by_id = request.user.id
            link.save()
        return Response(ProjectLinkSerializer(link).data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def destroy(self, request, slug, pk):
        # Rejecting and unlinking are the same operation. A declined suggestion
        # that stayed as a tombstone would be re-explained every week.
        self.get_queryset().get(pk=pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
