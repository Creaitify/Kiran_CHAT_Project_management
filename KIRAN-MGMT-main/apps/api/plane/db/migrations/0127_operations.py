# Hand-written to match `plane/db/models/operations.py`.
#
# Departments, project links, member rates, time entries, report schedules and
# runs, reminders — the five Scope.pdf project-management asks, which are one
# domain rather than five features.
#
# Field order and the audit columns follow 0124, which was machine-generated, so
# a later `makemigrations` sees no drift.

import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def audit_fields():
    """The four columns every `BaseModel` carries, in the order Django emits them."""
    return [
        ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
        ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
        ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
        (
            "id",
            models.UUIDField(
                db_index=True,
                default=uuid.uuid4,
                editable=False,
                primary_key=True,
                serialize=False,
                unique=True,
            ),
        ),
    ]


def audit_relations():
    return [
        (
            "created_by",
            models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="%(class)s_created_by",
                to=settings.AUTH_USER_MODEL,
                verbose_name="Created By",
            ),
        ),
        (
            "updated_by",
            models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="%(class)s_updated_by",
                to=settings.AUTH_USER_MODEL,
                verbose_name="Last Modified By",
            ),
        ),
    ]


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("db", "0126_chatusergroup_chatusergroupmember"),
    ]

    operations = [
        migrations.CreateModel(
            name="Department",
            fields=audit_fields()
            + [
                ("name", models.CharField(max_length=255)),
                ("code", models.CharField(max_length=12)),
                ("description", models.TextField(blank=True, default="")),
            ]
            + audit_relations()
            + [
                (
                    "lead",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="led_departments",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "workspace",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="departments",
                        to="db.workspace",
                    ),
                ),
            ],
            options={
                "verbose_name": "Department",
                "verbose_name_plural": "Departments",
                "db_table": "departments",
                "ordering": ("name",),
            },
        ),
        migrations.CreateModel(
            name="ProjectDepartment",
            fields=audit_fields()
            + [
                (
                    "role",
                    models.CharField(
                        choices=[("owner", "Owner"), ("contributor", "Contributor")],
                        default="contributor",
                        max_length=20,
                    ),
                ),
            ]
            + audit_relations()
            + [
                (
                    "department",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="projects",
                        to="db.department",
                    ),
                ),
                (
                    "project",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="departments",
                        to="db.project",
                    ),
                ),
                (
                    "workspace",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="project_departments",
                        to="db.workspace",
                    ),
                ),
            ],
            options={
                "verbose_name": "Project Department",
                "verbose_name_plural": "Project Departments",
                "db_table": "project_departments",
                "ordering": ("created_at",),
            },
        ),
        migrations.CreateModel(
            name="ProjectLink",
            fields=audit_fields()
            + [
                (
                    "kind",
                    models.CharField(
                        choices=[("related", "Related"), ("depends_on", "Depends on"), ("blocks", "Blocks")],
                        default="related",
                        max_length=20,
                    ),
                ),
                (
                    "origin",
                    models.CharField(
                        choices=[("manual", "Created by a person"), ("suggested", "Proposed automatically")],
                        default="manual",
                        max_length=20,
                    ),
                ),
                ("rationale", models.TextField(blank=True, default="")),
                ("confirmed_at", models.DateTimeField(blank=True, null=True)),
            ]
            + audit_relations()
            + [
                (
                    "confirmed_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "source",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="outgoing_links",
                        to="db.project",
                    ),
                ),
                (
                    "target",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="incoming_links",
                        to="db.project",
                    ),
                ),
                (
                    "workspace",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="project_links",
                        to="db.workspace",
                    ),
                ),
            ],
            options={
                "verbose_name": "Project Link",
                "verbose_name_plural": "Project Links",
                "db_table": "project_links",
                "ordering": ("-created_at",),
            },
        ),
        migrations.CreateModel(
            name="MemberRate",
            fields=audit_fields()
            + [
                ("amount_minor", models.BigIntegerField()),
                ("currency", models.CharField(default="INR", max_length=3)),
                ("effective_from", models.DateField()),
            ]
            + audit_relations()
            + [
                (
                    "member",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="rates",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "workspace",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="member_rates",
                        to="db.workspace",
                    ),
                ),
            ],
            options={
                "verbose_name": "Member Rate",
                "verbose_name_plural": "Member Rates",
                "db_table": "member_rates",
                "ordering": ("-effective_from",),
            },
        ),
        migrations.CreateModel(
            name="TimeEntry",
            fields=audit_fields()
            + [
                ("spent_on", models.DateField()),
                ("minutes", models.PositiveIntegerField()),
                ("note", models.TextField(blank=True, default="")),
            ]
            + audit_relations()
            + [
                (
                    "member",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="time_entries",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "project",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="time_entries",
                        to="db.project",
                    ),
                ),
                (
                    "work_item",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="time_entries",
                        to="db.issue",
                    ),
                ),
                (
                    "workspace",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="time_entries",
                        to="db.workspace",
                    ),
                ),
            ],
            options={
                "verbose_name": "Time Entry",
                "verbose_name_plural": "Time Entries",
                "db_table": "time_entries",
                "ordering": ("-spent_on", "-created_at"),
            },
        ),
        migrations.CreateModel(
            name="ReportSchedule",
            fields=audit_fields()
            + [
                ("name", models.CharField(max_length=255)),
                ("cadence", models.CharField(choices=[("weekly", "Weekly")], default="weekly", max_length=20)),
                ("send_weekday", models.PositiveSmallIntegerField(default=0)),
                ("is_active", models.BooleanField(default=True)),
                ("last_run_for", models.DateField(blank=True, null=True)),
            ]
            + audit_relations()
            + [
                (
                    "department",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="report_schedules",
                        to="db.department",
                    ),
                ),
                (
                    "recipients",
                    models.ManyToManyField(
                        blank=True, related_name="report_schedules", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "workspace",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="report_schedules",
                        to="db.workspace",
                    ),
                ),
            ],
            options={
                "verbose_name": "Report Schedule",
                "verbose_name_plural": "Report Schedules",
                "db_table": "report_schedules",
                "ordering": ("name",),
            },
        ),
        migrations.CreateModel(
            name="ReportRun",
            fields=audit_fields()
            + [
                ("period_start", models.DateField()),
                ("period_end", models.DateField()),
                ("payload", models.JSONField(default=dict)),
            ]
            + audit_relations()
            + [
                (
                    "schedule",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="runs",
                        to="db.reportschedule",
                    ),
                ),
                (
                    "workspace",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="report_runs",
                        to="db.workspace",
                    ),
                ),
            ],
            options={
                "verbose_name": "Report Run",
                "verbose_name_plural": "Report Runs",
                "db_table": "report_runs",
                "ordering": ("-period_end", "-created_at"),
            },
        ),
        migrations.CreateModel(
            name="Reminder",
            fields=audit_fields()
            + [
                ("entity_kind", models.CharField(max_length=64)),
                ("entity_id", models.CharField(max_length=255)),
                ("entity_label", models.CharField(blank=True, default="", max_length=255)),
                ("note", models.TextField(blank=True, default="")),
                ("remind_at", models.DateTimeField()),
                (
                    "state",
                    models.CharField(
                        choices=[("pending", "Pending"), ("sent", "Sent"), ("dismissed", "Dismissed")],
                        default="pending",
                        max_length=20,
                    ),
                ),
                ("sent_at", models.DateTimeField(blank=True, null=True)),
            ]
            + audit_relations()
            + [
                (
                    "member",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="reminders",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "workspace",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="reminders",
                        to="db.workspace",
                    ),
                ),
            ],
            options={
                "verbose_name": "Reminder",
                "verbose_name_plural": "Reminders",
                "db_table": "reminders",
                "ordering": ("remind_at",),
            },
        ),
        # ------------------------------------------------------------ indexes
        migrations.AddIndex(
            model_name="department",
            index=models.Index(fields=["workspace", "code"], name="department_ws_code_idx"),
        ),
        migrations.AddIndex(
            model_name="projectdepartment",
            index=models.Index(fields=["department", "project"], name="project_dept_dept_proj_idx"),
        ),
        migrations.AddIndex(
            model_name="projectlink",
            index=models.Index(fields=["workspace", "confirmed_at"], name="project_link_ws_confirmed_idx"),
        ),
        migrations.AddIndex(
            model_name="memberrate",
            index=models.Index(fields=["member", "-effective_from"], name="member_rate_member_eff_idx"),
        ),
        migrations.AddIndex(
            model_name="timeentry",
            index=models.Index(fields=["workspace", "-spent_on"], name="time_entry_ws_spent_idx"),
        ),
        migrations.AddIndex(
            model_name="timeentry",
            index=models.Index(fields=["member", "-spent_on"], name="time_entry_member_spent_idx"),
        ),
        migrations.AddIndex(
            model_name="timeentry",
            index=models.Index(fields=["project", "-spent_on"], name="time_entry_project_spent_idx"),
        ),
        migrations.AddIndex(
            model_name="reportschedule",
            index=models.Index(fields=["workspace", "is_active"], name="report_sched_ws_active_idx"),
        ),
        migrations.AddIndex(
            model_name="reportrun",
            index=models.Index(fields=["workspace", "-period_end"], name="report_run_ws_period_idx"),
        ),
        migrations.AddIndex(
            model_name="reminder",
            index=models.Index(fields=["member", "state", "remind_at"], name="reminder_member_state_idx"),
        ),
        migrations.AddIndex(
            model_name="reminder",
            index=models.Index(
                condition=models.Q(("state", "pending")),
                fields=["remind_at"],
                name="reminder_pending_due_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="reminder",
            index=models.Index(fields=["entity_kind", "entity_id"], name="reminder_entity_idx"),
        ),
        # -------------------------------------------------------- constraints
        migrations.AddConstraint(
            model_name="department",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("workspace", "code"),
                name="department_unique_workspace_code_when_not_deleted",
            ),
        ),
        migrations.AddConstraint(
            model_name="projectdepartment",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("project", "department"),
                name="project_department_unique_when_not_deleted",
            ),
        ),
        migrations.AddConstraint(
            model_name="projectlink",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("source", "target", "kind"),
                name="project_link_unique_source_target_kind_when_not_deleted",
            ),
        ),
        migrations.AddConstraint(
            model_name="memberrate",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("workspace", "member", "effective_from"),
                name="member_rate_unique_member_effective_when_not_deleted",
            ),
        ),
    ]
