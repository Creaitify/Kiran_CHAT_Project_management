# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
The scheduled-message release sweep.

The property that matters most is the one that is easiest to lose: a released
message has to come back with a *current* `updated_at`. Chat's only real-time
transport is a poll keyed on `updated_at > since`, so a message queued on Monday
for Friday still carrying Monday's `updated_at` on Friday is invisible to every
connected client until somebody reloads the room.
"""

from datetime import timedelta
from unittest.mock import Mock, patch

import pytest
from django.db import DatabaseError
from django.utils import timezone

from plane.bgtasks.chat_scheduled_task import release_scheduled_chat_messages
from plane.db.models import ChatMessage, ChatRoom
from plane.tests.factories import UserFactory, WorkspaceFactory

TASK = "plane.bgtasks.chat_scheduled_task"


@pytest.fixture
def room(db):
    workspace = WorkspaceFactory(owner=UserFactory())
    return ChatRoom.objects.create(
        workspace=workspace,
        type=ChatRoom.RoomType.GROUP,
        name="Release Test Room",
        created_by=workspace.owner,
    )


def _queue(room, *, scheduled_for, client_id, content="queued"):
    message = ChatMessage.objects.create(
        workspace_id=room.workspace_id,
        room=room,
        sender=room.workspace.owner,
        client_id=client_id,
        content=content,
        scheduled_for=scheduled_for,
    )
    # `updated_at` is auto_now, so make it unambiguously stale: without the
    # sweep touching it, the poll would never surface this row.
    ChatMessage.all_objects.filter(pk=message.pk).update(
        created_at=timezone.now() - timedelta(days=4),
        updated_at=timezone.now() - timedelta(days=4),
    )
    message.refresh_from_db()
    return message


@pytest.mark.unit
@pytest.mark.django_db
class TestReleaseScheduledChatMessages:
    def test_a_due_message_is_released(self, room):
        due_at = timezone.now() - timedelta(minutes=2)
        message = _queue(room, scheduled_for=due_at, client_id="due")

        assert release_scheduled_chat_messages() == 1

        message.refresh_from_db()
        assert message.scheduled_for is None

    def test_release_bumps_updated_at_so_the_poll_can_see_it(self, room):
        """The whole reason this task exists."""
        stale = timezone.now() - timedelta(days=1)
        message = _queue(room, scheduled_for=timezone.now() - timedelta(minutes=2), client_id="due")

        release_scheduled_chat_messages()

        message.refresh_from_db()
        assert message.updated_at > stale

    def test_a_released_message_claims_the_time_it_was_promised(self, room):
        """Not the time the beat happened to run -- a minute of scheduler lag
        must not show up in the transcript."""
        promised = timezone.now() - timedelta(minutes=3)
        message = _queue(room, scheduled_for=promised, client_id="due")

        release_scheduled_chat_messages()

        message.refresh_from_db()
        assert abs((message.created_at - promised).total_seconds()) < 1

    def test_a_message_scheduled_for_the_past_is_not_back_dated(self, room):
        """`Greatest` guards this: a row must never claim a send time from
        before it was written, or it lands above messages already read."""
        message = _queue(room, scheduled_for=timezone.now() - timedelta(minutes=2), client_id="due")
        written_at = timezone.now()
        ChatMessage.all_objects.filter(pk=message.pk).update(created_at=written_at)

        release_scheduled_chat_messages()

        message.refresh_from_db()
        assert abs((message.created_at - written_at).total_seconds()) < 1

    def test_a_future_message_is_left_alone(self, room):
        message = _queue(room, scheduled_for=timezone.now() + timedelta(hours=3), client_id="later")

        assert release_scheduled_chat_messages() == 0

        message.refresh_from_db()
        assert message.scheduled_for is not None

    def test_an_ordinary_message_is_untouched(self, room):
        message = ChatMessage.objects.create(
            workspace_id=room.workspace_id,
            room=room,
            sender=room.workspace.owner,
            client_id="plain",
            content="sent normally",
        )
        before = message.updated_at

        release_scheduled_chat_messages()

        message.refresh_from_db()
        assert message.updated_at == before

    def test_a_tombstoned_queued_message_is_not_published(self, room):
        """Cancelling deletes rather than tombstones, so this should not happen
        -- but a tombstone reaching a room as a 'message deleted' placeholder for
        something nobody ever saw is bad enough to guard twice."""
        message = _queue(room, scheduled_for=timezone.now() - timedelta(minutes=2), client_id="gone")
        ChatMessage.all_objects.filter(pk=message.pk).update(tombstoned_at=timezone.now())

        assert release_scheduled_chat_messages() == 0

        message.refresh_from_db()
        assert message.scheduled_for is not None

    def test_the_sweep_is_idempotent(self, room):
        _queue(room, scheduled_for=timezone.now() - timedelta(minutes=2), client_id="due")

        assert release_scheduled_chat_messages() == 1
        assert release_scheduled_chat_messages() == 0

    def test_a_failure_does_not_raise_into_beat(self, room):
        """Raising would have beat retry every minute against whatever is
        broken; the next pass picks up the same rows regardless, because a
        failed pass clears nothing."""
        message = _queue(room, scheduled_for=timezone.now() - timedelta(minutes=2), client_id="due")

        broken = Mock()
        broken.objects.filter.side_effect = DatabaseError("connection lost")

        with patch(f"{TASK}.ChatMessage", broken):
            assert release_scheduled_chat_messages() == 0

        message.refresh_from_db()
        assert message.scheduled_for is not None, "a failed pass must leave the row releasable"
        assert release_scheduled_chat_messages() == 1
