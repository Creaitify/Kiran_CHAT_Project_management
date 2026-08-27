# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Mention groups -- `@engineering`, `@on-call`.

The client half of this has been there since the port: `parseMentions` reads
`<!handle>` out of a message body, `resolveMentionTargets` fans it out,
`mentionCandidates` offers it in the composer's autocomplete and
`MarkdownContent` renders it. All of them were being handed an empty array,
because there was nothing to fill it from. This is that.

---------------------------------------------------------------------------
Who may edit one
---------------------------------------------------------------------------
Reading is every workspace member; writing is workspace ADMIN only. A mention
group is closer to directory data than to a room: the handle is global, it means
the same thing wherever it is typed, and its whole value is that `@engineering`
addresses engineering rather than whoever last edited it. Anyone being able to
add themselves to `@on-call` would make the handle worth less than typing the
names out.

Membership here is not access. Being in a group means messages addressed to its
handle notify you; it grants nothing. The fan-out intersects the group with the
room's own members, so mentioning `@engineering` in a room half of them are not
in reaches only the half that are.
"""

# Django imports
from django.db import IntegrityError, transaction

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import ChatUserGroupSerializer
from plane.app.views.base import BaseViewSet
from plane.db.models import ChatUserGroup, ChatUserGroupMember, Workspace, WorkspaceMember


class ChatUserGroupViewSet(BaseViewSet):
    serializer_class = ChatUserGroupSerializer
    model = ChatUserGroup

    def get_queryset(self):
        # `members` is prefetched because the serializer reads `member_ids` off
        # it. Without this a list of N groups is N+1 queries.
        return (
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .prefetch_related("members")
        )

    def _workspace(self):
        return Workspace.objects.get(slug=self.kwargs.get("slug"))

    @staticmethod
    def _members_in_workspace(workspace_id, candidate_ids):
        """The subset of `candidate_ids` that are live members of the workspace.

        Silently dropping the rest rather than erroring: the only way to send an
        id that is not a member is to have been looking at a stale directory,
        and failing the whole edit over one person who left last week loses the
        other nine changes in the same request.
        """
        if not candidate_ids:
            return []
        return list(
            WorkspaceMember.objects.filter(
                workspace_id=workspace_id,
                member_id__in=candidate_ids,
                is_active=True,
            ).values_list("member_id", flat=True)
        )

    def _set_members(self, group, member_ids):
        """Replace the membership with exactly `member_ids`.

        A diff rather than a delete-and-recreate: the rows carry `created_at`,
        which is the only record of when someone joined a group, and rewriting
        every row on every edit would reset all of it because one person was
        added.

        Touches the group row afterwards, and that is load-bearing. Membership is
        its own table, so nothing about `ChatUserGroup.updated_at` changes when
        someone is added -- and a *removal* is a soft delete, which
        `SoftDeletionQuerySet.delete` performs with `.update()`, which bypasses
        `auto_now` and so does not move the membership row's `updated_at` either.
        A poll keyed on either table would therefore miss removals entirely.
        Making the group row the single signal is one write and leaves the delta
        with nothing to join.
        """
        wanted = set(self._members_in_workspace(group.workspace_id, member_ids))
        current = {membership.member_id for membership in group.members.all()}

        removed = current - wanted
        if removed:
            ChatUserGroupMember.objects.filter(group_id=group.id, member_id__in=removed).delete()

        added = wanted - current
        if added:
            ChatUserGroupMember.objects.bulk_create(
                [
                    ChatUserGroupMember(
                        workspace_id=group.workspace_id, group_id=group.id, member_id=member_id
                    )
                    for member_id in added
                ]
            )

        if removed or added:
            group.save()

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def list(self, request, slug):
        groups = self.get_queryset()
        return Response(ChatUserGroupSerializer(groups, many=True).data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def create(self, request, slug):
        workspace = self._workspace()

        serializer = ChatUserGroupSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        member_ids = serializer.validated_data.pop("member_ids", [])

        try:
            with transaction.atomic():
                group = ChatUserGroup.objects.create(
                    workspace_id=workspace.id, **serializer.validated_data
                )
                self._set_members(group, member_ids)
        except IntegrityError:
            # The unique (workspace, handle) constraint. Reported as a field
            # error so the form can point at the handle input rather than
            # showing a toast about a database.
            return Response(
                {"handle": ["A group with this handle already exists."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        group = self.get_queryset().get(pk=group.id)
        return Response(ChatUserGroupSerializer(group).data, status=status.HTTP_201_CREATED)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def partial_update(self, request, slug, pk):
        group = self.get_queryset().get(pk=pk)

        serializer = ChatUserGroupSerializer(group, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        # Absent means "leave the membership alone"; an empty list means "empty
        # it". Those are different requests and `.pop` with a sentinel is what
        # keeps them different.
        member_ids = serializer.validated_data.pop("member_ids", None)

        try:
            with transaction.atomic():
                # Only when something is actually being set. `member_ids` has
                # already been popped, so a request that only moves the
                # membership leaves `validated_data` empty -- and saving anyway
                # would move `updated_at`, which is the poll's signal, and hand
                # every connected client a delta row describing no change.
                if serializer.validated_data:
                    serializer.save()
                if member_ids is not None:
                    self._set_members(group, member_ids)
        except IntegrityError:
            return Response(
                {"handle": ["A group with this handle already exists."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        group = self.get_queryset().get(pk=pk)
        return Response(ChatUserGroupSerializer(group).data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def destroy(self, request, slug, pk):
        group = self.get_queryset().get(pk=pk)

        # No tombstone. Unlike a message, a deleted group leaves nothing dangling
        # -- past messages keep the literal `<!handle>` they were written with,
        # and an unresolvable handle already renders as plain text. Recreating
        # the handle later revives those mentions, which is the behaviour people
        # expect from a handle rather than a surprise.
        group.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
