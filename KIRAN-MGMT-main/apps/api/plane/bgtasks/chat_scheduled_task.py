# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Release of queued chat messages.

A scheduled message is an ordinary row with `scheduled_for` set, hidden from
everyone but its author until the clock passes it. Both read paths already
enforce that -- `ChatMessageViewSet.get_queryset` and the polling delta -- so
nothing has to move for the message to become *visible*.

What does have to move is `updated_at`. The delta is `updated_at > since`, and a
message queued on Monday for Friday still carries Monday's `updated_at` when
Friday arrives, so it would never appear in anyone's poll: it would sit there,
technically visible, until someone reloaded the room and re-read history. That
is the entire reason this task exists.

Before this, release was a `setInterval` in the browser (`chat-store.tsx`), which
meant a scheduled message only sent while its author had a tab open -- and, since
the client never posted it in the first place, did not survive a refresh at all.
"""

# Python imports
import logging

# Django imports
from django.db.models import F
from django.db.models.functions import Greatest
from django.utils import timezone

# Third party imports
from celery import shared_task

# Module imports
from plane.db.models import ChatMessage
from plane.utils.exception_logger import log_exception

logger = logging.getLogger("plane")


@shared_task
def release_scheduled_chat_messages():
    """Publish every message whose send time has passed.

    One UPDATE, no read: there is nothing to decide per row, and a queryset walk
    would open a window between reading a row and clearing it in which the beat
    could fire again and release it twice.
    """
    try:
        now = timezone.now()
        released = ChatMessage.objects.filter(
            scheduled_for__isnull=False,
            scheduled_for__lte=now,
            # A message cancelled before it went out is deleted outright rather
            # than tombstoned -- see `ChatMessageViewSet.destroy` -- so this is
            # belt and braces against a tombstone reaching the room as a
            # "message deleted" placeholder for something nobody ever saw.
            tombstoned_at__isnull=True,
        ).update(
            # The message claims the time it was promised for, not the time the
            # beat happened to run, so a minute of scheduler lag does not show up
            # in the transcript. `Greatest` guards the other direction: a row
            # scheduled for the past must not be back-dated to before it was
            # written. Postgres evaluates every SET expression against the old
            # row, so reading `scheduled_for` here and clearing it below is safe
            # in one statement.
            created_at=Greatest(F("scheduled_for"), F("created_at")),
            scheduled_for=None,
            # `.update()` bypasses `auto_now`, and this is the field the poll
            # keys on. Forgetting it would deliver nothing.
            updated_at=now,
        )

        if released:
            logger.info("released %s scheduled chat message(s)", released)
        return released
    except Exception as e:
        # Swallowed rather than raised: this runs every minute, and a retry
        # storm from beat is a worse outcome than one missed pass -- the next
        # pass picks up exactly the same rows, because nothing was cleared.
        log_exception(e)
        return 0
