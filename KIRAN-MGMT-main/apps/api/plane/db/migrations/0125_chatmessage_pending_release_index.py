# Hand-written to match `ChatMessage.Meta.indexes`.
#
# Supports the every-minute sweep in
# `plane.bgtasks.chat_scheduled_task.release_scheduled_chat_messages`, which asks
# for rows whose send time has passed. Partial on `scheduled_for IS NOT NULL`
# because queued messages are a rounding error against the table.

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0124_chatroom_chatmessage_chatroominvite_chatroommember_and_more"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="chatmessage",
            index=models.Index(
                condition=models.Q(("scheduled_for__isnull", False)),
                fields=["scheduled_for"],
                name="chat_msg_pending_release_idx",
            ),
        ),
    ]
