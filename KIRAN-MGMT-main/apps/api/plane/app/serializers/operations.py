# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Operations serializers.

Same convention the chat serializers established: field names match the client's
TypeScript model as closely as snake_case allows, and every deviation carries a
comment saying why.

One rule runs through all of them: **money is never a float on the wire.**
Amounts travel as integer minor units with the currency beside them, and the
client formats. A JSON number that has been through a float is a number that can
come back as 1234.9999999999998, and a finance screen is the last place that
should happen.
"""

# Python imports
import re
from datetime import timedelta

# Django imports
from django.utils import timezone

# Third party imports
from rest_framework import serializers

# Module imports
from plane.db.models import (
    Department,
    MemberRate,
    ProjectDepartment,
    ProjectLink,
    Reminder,
    ReportRun,
    ReportSchedule,
    TimeEntry,
)

from .base import BaseSerializer

# A day nobody works more than. Not a policy -- a typo guard: 14 hours logged
# against one project on one day is almost always a minutes/hours mix-up, and
# catching it at write time is far cheaper than finding it in a quarterly total.
MAX_MINUTES_PER_ENTRY = 14 * 60

# How far back time may be logged. Reopening a closed period silently changes a
# report that has already been sent.
MAX_BACKDATE_DAYS = 90


class DepartmentSerializer(BaseSerializer):
    project_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Department
        fields = ["id", "name", "code", "description", "lead", "project_count", "created_at", "updated_at"]
        read_only_fields = ["id", "project_count", "created_at", "updated_at"]

    def validate_code(self, value):
        """Short, uppercase, and safe to render in a dense table.

        Uppercased rather than rejected: "eng" and "ENG" are the same department
        to everyone except a unique constraint, and asking a person to retype it
        teaches them nothing.
        """
        value = (value or "").strip().upper()
        if not value:
            raise serializers.ValidationError("A code is required.")
        if not re.fullmatch(r"[A-Z0-9-]{1,12}", value):
            raise serializers.ValidationError("Use 1-12 letters, numbers or hyphens.")
        return value

    def validate_name(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("A name is required.")
        return value


class ProjectDepartmentSerializer(BaseSerializer):
    project_id = serializers.UUIDField(read_only=True)
    department_id = serializers.UUIDField(read_only=True)
    project_name = serializers.CharField(read_only=True, source="project.name")
    department_code = serializers.CharField(read_only=True, source="department.code")

    class Meta:
        model = ProjectDepartment
        fields = ["id", "project_id", "department_id", "project_name", "department_code", "role", "created_at"]
        read_only_fields = fields


class ProjectLinkSerializer(BaseSerializer):
    source_id = serializers.UUIDField(read_only=True)
    target_id = serializers.UUIDField(read_only=True)
    source_name = serializers.CharField(read_only=True, source="source.name")
    target_name = serializers.CharField(read_only=True, source="target.name")
    is_confirmed = serializers.SerializerMethodField()

    class Meta:
        model = ProjectLink
        fields = [
            "id",
            "source_id",
            "target_id",
            "source_name",
            "target_name",
            "kind",
            "origin",
            "rationale",
            "is_confirmed",
            "confirmed_at",
            "confirmed_by",
            "created_at",
        ]
        read_only_fields = [f for f in fields if f not in ("kind",)]

    def get_is_confirmed(self, obj):
        return obj.confirmed_at is not None


class MemberRateSerializer(BaseSerializer):
    member_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = MemberRate
        fields = ["id", "member_id", "amount_minor", "currency", "effective_from", "created_at"]
        read_only_fields = ["id", "member_id", "created_at"]

    def validate_amount_minor(self, value):
        if value is None or value < 0:
            raise serializers.ValidationError("A rate cannot be negative.")
        return value

    def validate_currency(self, value):
        value = (value or "").strip().upper()
        if not re.fullmatch(r"[A-Z]{3}", value):
            raise serializers.ValidationError("Use a three-letter currency code.")
        return value


class TimeEntrySerializer(BaseSerializer):
    member_id = serializers.UUIDField(read_only=True)
    project_id = serializers.UUIDField(read_only=True)
    work_item_id = serializers.UUIDField(read_only=True, allow_null=True)
    member_name = serializers.CharField(read_only=True, source="member.display_name")
    project_name = serializers.CharField(read_only=True, source="project.name")

    class Meta:
        model = TimeEntry
        fields = [
            "id",
            "member_id",
            "project_id",
            "work_item_id",
            "member_name",
            "project_name",
            "spent_on",
            "minutes",
            "note",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "member_id", "project_id", "work_item_id", "member_name", "project_name", "created_at", "updated_at"]

    def validate_minutes(self, value):
        if not value or value <= 0:
            raise serializers.ValidationError("Log at least a minute.")
        if value > MAX_MINUTES_PER_ENTRY:
            raise serializers.ValidationError(
                f"That is more than {MAX_MINUTES_PER_ENTRY // 60} hours in one entry — did you mean minutes?"
            )
        return value

    def validate_spent_on(self, value):
        today = timezone.now().date()
        if value > today:
            raise serializers.ValidationError("Time cannot be logged against a future date.")
        if value < today - timedelta(days=MAX_BACKDATE_DAYS):
            raise serializers.ValidationError(
                f"That is more than {MAX_BACKDATE_DAYS} days ago; reopening a closed period changes reports "
                "that have already been sent."
            )
        return value


class TimeEntryCreateSerializer(TimeEntrySerializer):
    """Create takes the ids the read shape exposes as read-only.

    A separate class rather than conditional `read_only`: the two shapes really
    are different, and the alternative is a serializer whose behaviour depends on
    which view happens to be using it.
    """

    project = serializers.UUIDField(write_only=True)
    work_item = serializers.UUIDField(write_only=True, required=False, allow_null=True)

    class Meta(TimeEntrySerializer.Meta):
        fields = TimeEntrySerializer.Meta.fields + ["project", "work_item"]


class ReportScheduleSerializer(BaseSerializer):
    department_id = serializers.UUIDField(read_only=True, allow_null=True)
    recipient_ids = serializers.ListField(child=serializers.UUIDField(), required=False, write_only=True)

    class Meta:
        model = ReportSchedule
        fields = [
            "id",
            "name",
            "cadence",
            "send_weekday",
            "is_active",
            "department_id",
            "recipient_ids",
            "last_run_for",
            "created_at",
        ]
        read_only_fields = ["id", "department_id", "last_run_for", "created_at"]

    def validate_send_weekday(self, value):
        # 0 = Monday, matching Python's `weekday()`, so the beat task compares
        # directly instead of translating a convention at every call site.
        if value is None or not 0 <= value <= 6:
            raise serializers.ValidationError("Pick a day from Monday (0) to Sunday (6).")
        return value

    def validate_name(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("A name is required.")
        return value

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # Prefetched by the view; reading it off the instance keeps a list of N
        # schedules at one query rather than N.
        data["recipient_ids"] = [str(user.id) for user in instance.recipients.all()]
        return data


class ReportRunSerializer(BaseSerializer):
    schedule_id = serializers.UUIDField(read_only=True, allow_null=True)
    schedule_name = serializers.CharField(read_only=True, source="schedule.name", default=None)

    class Meta:
        model = ReportRun
        fields = ["id", "schedule_id", "schedule_name", "period_start", "period_end", "payload", "created_at"]
        read_only_fields = fields


class ReminderSerializer(BaseSerializer):
    member_id = serializers.UUIDField(read_only=True)
    is_due = serializers.SerializerMethodField()

    class Meta:
        model = Reminder
        fields = [
            "id",
            "member_id",
            "entity_kind",
            "entity_id",
            "entity_label",
            "note",
            "remind_at",
            "state",
            "sent_at",
            "is_due",
            "created_at",
        ]
        read_only_fields = ["id", "member_id", "state", "sent_at", "is_due", "created_at"]

    def get_is_due(self, obj):
        return obj.state == Reminder.State.PENDING and obj.remind_at <= timezone.now()

    def validate_entity_kind(self, value):
        """Opaque, and deliberately not validated against a list.

        `entity_kind` mirrors `TEntityRef` in `core/apps/links.ts`. The moment
        this file enumerates the kinds that exist, adding an app means editing
        operations — which is the coupling the app contract exists to prevent.
        """
        value = (value or "").strip()
        if not re.fullmatch(r"[a-z0-9-]{1,64}", value):
            raise serializers.ValidationError("Not a valid entity kind.")
        return value

    def validate_entity_id(self, value):
        value = (value or "").strip()
        if not value or len(value) > 255:
            raise serializers.ValidationError("An entity id is required.")
        return value

    def validate_remind_at(self, value):
        if value <= timezone.now():
            raise serializers.ValidationError("Pick a time in the future.")
        return value
