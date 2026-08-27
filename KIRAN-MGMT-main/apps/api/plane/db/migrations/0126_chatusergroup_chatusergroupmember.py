# Hand-written to match `ChatUserGroup` / `ChatUserGroupMember` in
# `plane/db/models/chat.py`. Mention groups: `@engineering` and friends.
#
# Field order and the audit columns follow 0124, which was machine-generated, so
# a later `makemigrations` sees no drift.

import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("db", "0125_chatmessage_pending_release_index"),
    ]

    operations = [
        migrations.CreateModel(
            name="ChatUserGroup",
            fields=[
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
                ("handle", models.CharField(max_length=64)),
                ("name", models.CharField(max_length=255)),
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
                (
                    "workspace",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="chat_user_groups",
                        to="db.workspace",
                    ),
                ),
            ],
            options={
                "verbose_name": "Chat User Group",
                "verbose_name_plural": "Chat User Groups",
                "db_table": "chat_user_groups",
                "ordering": ("handle",),
            },
        ),
        migrations.CreateModel(
            name="ChatUserGroupMember",
            fields=[
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
                    "group",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="members",
                        to="db.chatusergroup",
                    ),
                ),
                (
                    "member",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="chat_user_group_memberships",
                        to=settings.AUTH_USER_MODEL,
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
                (
                    "workspace",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="chat_user_group_members",
                        to="db.workspace",
                    ),
                ),
            ],
            options={
                "verbose_name": "Chat User Group Member",
                "verbose_name_plural": "Chat User Group Members",
                "db_table": "chat_user_group_members",
                "ordering": ("created_at",),
            },
        ),
        migrations.AddIndex(
            model_name="chatusergroup",
            index=models.Index(fields=["workspace", "handle"], name="chat_user_group_ws_handle_idx"),
        ),
        migrations.AddConstraint(
            model_name="chatusergroup",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("workspace", "handle"),
                name="chat_user_group_unique_workspace_handle_when_not_deleted",
            ),
        ),
        migrations.AddIndex(
            model_name="chatusergroupmember",
            index=models.Index(fields=["member", "group"], name="chat_user_group_mem_grp_idx"),
        ),
        migrations.AddConstraint(
            model_name="chatusergroupmember",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("group", "member"),
                name="chat_user_group_member_unique_group_member_when_not_deleted",
            ),
        ),
    ]
