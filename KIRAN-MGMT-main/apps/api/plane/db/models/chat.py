# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Chat.

Chat shipped as a separate app whose entire state was a localStorage snapshot:
one JSON blob rewritten on every keystroke, holding rooms, messages, membership
and read markers together. That is what these tables replace.

Three decisions shape the schema, and they are the ones worth arguing about:

1. **Membership is a table, not four arrays.** The snapshot carried
   `participantIds`, `adminIds`, `mutedUserIds` and `notificationLevels` as
   parallel lists on the room, which made "is this person an admin" a scan and
   made two people joining at once a lost update. `ChatRoomMember` holds one row
   per person per room, and role, mute and notification level are columns on it.

2. **Read state lives on membership.** The snapshot's `readState` was
   `room -> user -> marker`, a map that every client rewrote wholesale. Here the
   marker is two columns on the member row, so marking a room read is a
   single-row update by the only person entitled to make it.

3. **Deletion is a tombstone.** `tombstoned_at` is set and `content` is cleared,
   but the row survives -- replies point at it, threads are rooted on it, and
   keyset cursors walk through it. Removing the row would break all three.

Everything is workspace-scoped and rides the existing workspace roles. Chat does
not grow a second permission system.
"""

# Django imports
from django.conf import settings
from django.db import models

# Module imports
from .base import BaseModel


class ChatRoom(BaseModel):
    """A conversation: a named group, a 1:1, or an ad-hoc group DM."""

    class RoomType(models.TextChoices):
        GROUP = "group", "Group"
        DIRECT = "direct", "Direct"
        GROUP_DM = "groupdm", "Group DM"

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="chat_rooms")

    type = models.CharField(max_length=20, choices=RoomType.choices, default=RoomType.GROUP)
    # Null for direct rooms, whose name is "the other people in it" and is
    # therefore a rendering concern rather than stored data.
    name = models.CharField(max_length=255, null=True, blank=True)
    # "What are we doing right now" -- shown in the header, changes often.
    topic = models.TextField(null=True, blank=True)
    # "Why this room exists" -- shown in the info panel, changes rarely.
    description = models.TextField(null=True, blank=True)
    color = models.CharField(max_length=255, null=True, blank=True)
    # Cropped group image: {url, zoom, x, y}. A JSON column rather than four
    # columns because the crop is meaningless without the image and is only ever
    # read and written together.
    photo = models.JSONField(null=True, blank=True)

    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Chat Room"
        verbose_name_plural = "Chat Rooms"
        db_table = "chat_rooms"
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["workspace", "-created_at"])]

    def __str__(self):
        return self.name or f"{self.type}:{self.id}"


class ChatRoomMember(BaseModel):
    """
    One person's membership of one room.

    Also the only place a read marker lives. `last_read_message` is the anchor
    and `last_read_at` is the fast path: unread counts compare timestamps
    without a join, and the message id is there so the client can scroll to the
    exact divider rather than approximate it from a clock.
    """

    class Role(models.IntegerChoices):
        ADMIN = 20, "Admin"
        MEMBER = 15, "Member"

    class NotificationLevel(models.TextChoices):
        ALL = "all", "All"
        MENTIONS = "mentions", "Mentions only"
        NONE = "none", "Nothing"

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="chat_room_members")
    room = models.ForeignKey(ChatRoom, on_delete=models.CASCADE, related_name="members")
    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="chat_memberships")

    role = models.IntegerField(choices=Role.choices, default=Role.MEMBER)
    notification_level = models.CharField(
        max_length=20, choices=NotificationLevel.choices, default=NotificationLevel.ALL
    )
    # Distinct from notification_level: muting silences the room for this person,
    # while the level decides what would have been worth notifying about anyway.
    is_muted = models.BooleanField(default=False)

    last_read_message = models.ForeignKey(
        "db.ChatMessage", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    last_read_at = models.DateTimeField(null=True, blank=True)

    # Left the room. The row survives so their past messages keep a resolvable
    # author and so re-joining does not silently reset their read marker.
    left_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Chat Room Member"
        verbose_name_plural = "Chat Room Members"
        db_table = "chat_room_members"
        ordering = ("created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["room", "member"],
                condition=models.Q(deleted_at__isnull=True),
                name="chat_room_member_unique_room_member_when_not_deleted",
            )
        ]
        indexes = [models.Index(fields=["member", "room"])]

    def __str__(self):
        return f"{self.member_id} in {self.room_id}"


class ChatMessage(BaseModel):
    """
    One message.

    `client_id` is the idempotency key. The client mints it before sending, so a
    retry after an ambiguous failure -- the request that may or may not have
    landed -- resolves to the same row instead of a duplicate. It is unique per
    room rather than globally so two rooms cannot collide on a client's counter.
    """

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="chat_messages")
    room = models.ForeignKey(ChatRoom, on_delete=models.CASCADE, related_name="messages")
    # Null for system messages ("X added Y"), which have no human author.
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="chat_messages"
    )

    client_id = models.CharField(max_length=255)
    content = models.TextField(blank=True, default="")
    is_system = models.BooleanField(default=False)

    # Inline quote-reply: stays in the channel, renders the quoted message above.
    reply_to = models.ForeignKey("self", on_delete=models.SET_NULL, null=True, blank=True, related_name="replies")
    # Thread membership: messages with this set are hidden from the channel and
    # only appear in the thread panel.
    thread_root = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="thread_messages"
    )

    edited_at = models.DateTimeField(null=True, blank=True)
    # Tombstone -- see the module docstring. Deliberately not BaseModel's
    # `deleted_at`: that one is filtered out by SoftDeletionManager, which is
    # exactly wrong here. A tombstoned message must keep being returned so
    # replies resolve, threads keep their root, and cursors keep walking.
    tombstoned_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    pinned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    pinned_at = models.DateTimeField(null=True, blank=True)

    # Set while queued; the message is invisible to everyone but its author
    # until the clock passes it.
    scheduled_for = models.DateTimeField(null=True, blank=True)

    forwarded_from = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="forwards"
    )
    # An internal directory contact shared into the conversation.
    shared_profile_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    # Attachment metadata: {asset_id, name, type, size}. The bytes live in
    # FileAsset under entity_type CHAT_ATTACHMENT; this column is what the
    # message list needs to render without a join.
    attachment = models.JSONField(null=True, blank=True)
    # Parsed mentions: {users: [...], groups: [...], broadcast: "channel"|"here"|null}.
    # Denormalised at write time so "did this mention me" is not a re-parse of
    # every message body on every read.
    mentions = models.JSONField(default=dict, blank=True)
    # Unfurled links. Cosmetic, refreshable, and never worth its own table.
    link_previews = models.JSONField(default=list, blank=True)

    class Meta:
        verbose_name = "Chat Message"
        verbose_name_plural = "Chat Messages"
        db_table = "chat_messages"
        ordering = ("created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["room", "client_id"],
                condition=models.Q(deleted_at__isnull=True),
                name="chat_message_unique_room_client_id_when_not_deleted",
            )
        ]
        indexes = [
            # The keyset pagination path: newest-first within a room, tie-broken
            # by id so the cursor is stable across inserts at the same instant.
            models.Index(fields=["room", "-created_at", "-id"]),
            models.Index(fields=["thread_root"]),
            # The release sweep (`plane.bgtasks.chat_scheduled_task`) runs every
            # minute and asks for rows with a send time in the past. Partial,
            # because a queued message is a rounding error against the table:
            # indexing every row to find the handful that are pending would cost
            # more on every write than it saves on the sweep.
            models.Index(
                fields=["scheduled_for"],
                condition=models.Q(scheduled_for__isnull=False),
                name="chat_msg_pending_release_idx",
            ),
        ]

    def __str__(self):
        return f"{self.room_id}:{self.id}"


class ChatMessageReaction(BaseModel):
    """One person's one emoji on one message."""

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="chat_reactions")
    message = models.ForeignKey(ChatMessage, on_delete=models.CASCADE, related_name="reactions")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="chat_reactions")
    emoji = models.CharField(max_length=255)

    class Meta:
        verbose_name = "Chat Message Reaction"
        verbose_name_plural = "Chat Message Reactions"
        db_table = "chat_message_reactions"
        ordering = ("created_at",)
        constraints = [
            # Double-tapping the same emoji is a toggle, not a second reaction.
            models.UniqueConstraint(
                fields=["message", "actor", "emoji"],
                condition=models.Q(deleted_at__isnull=True),
                name="chat_reaction_unique_message_actor_emoji_when_not_deleted",
            )
        ]
        indexes = [models.Index(fields=["message"])]

    def __str__(self):
        return f"{self.emoji} on {self.message_id}"


class ChatRoomInvite(BaseModel):
    """
    A shareable join link.

    `uses` is a counter rather than a join against a redemptions table because
    nothing in the product asks who redeemed a link -- only whether it has any
    redemptions left.
    """

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="chat_room_invites")
    room = models.ForeignKey(ChatRoom, on_delete=models.CASCADE, related_name="invites")

    code = models.CharField(max_length=255, unique=True)
    # Null means the link never expires.
    expires_at = models.DateTimeField(null=True, blank=True)
    # Null means unlimited redemptions.
    max_uses = models.PositiveIntegerField(null=True, blank=True)
    uses = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        verbose_name = "Chat Room Invite"
        verbose_name_plural = "Chat Room Invites"
        db_table = "chat_room_invites"
        ordering = ("-created_at",)

    def __str__(self):
        return self.code


class ChatSavedMessage(BaseModel):
    """
    A per-person bookmark on a message.

    Saving a message and following its thread are the same shape -- one person,
    one message, one flag -- so they share a table and differ by `kind`. Two
    tables would have been two of everything for one boolean of difference.
    """

    class Kind(models.TextChoices):
        SAVED = "saved", "Saved"
        FOLLOWED_THREAD = "followed_thread", "Followed thread"

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="chat_saved_messages")
    message = models.ForeignKey(ChatMessage, on_delete=models.CASCADE, related_name="saves")
    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="chat_saved_messages")
    kind = models.CharField(max_length=32, choices=Kind.choices, default=Kind.SAVED)

    class Meta:
        verbose_name = "Chat Saved Message"
        verbose_name_plural = "Chat Saved Messages"
        db_table = "chat_saved_messages"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["message", "member", "kind"],
                condition=models.Q(deleted_at__isnull=True),
                name="chat_saved_unique_message_member_kind_when_not_deleted",
            )
        ]

    def __str__(self):
        return f"{self.kind}:{self.message_id}"


class ChatUserGroup(BaseModel):
    """
    A named, mentionable set of people -- `@engineering`, `@on-call`.

    Workspace-scoped rather than room-scoped, and deliberately so: the point of a
    mention group is that the same handle means the same team wherever it is
    typed. A room-scoped group would be a second, weaker way of saying "everyone
    here", which `@channel` already says.

    Membership is not a permission. Being in `@engineering` means messages
    addressed to that handle notify you; it grants no access to any room. The
    notification fan-out intersects the group with the room's own members, so
    mentioning a group in a room half of them are not in reaches only the half
    that are -- see `resolveMentionTargets` in `chat/lib/mentions.ts`.
    """

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="chat_user_groups")

    # What is typed after the `@`, and what is stored in the message body as
    # `<!handle>`. Lower-cased and validated at the serializer, because the
    # mention tokeniser only recognises `[a-zA-Z0-9_-]` and a handle it cannot
    # tokenise is a group that can never be mentioned.
    handle = models.CharField(max_length=64)
    # Human-readable, and the only other thing the composer shows: the mention
    # autocomplete renders "@handle" over "Name - N people". A separate
    # description field would have nowhere to appear.
    name = models.CharField(max_length=255)

    class Meta:
        verbose_name = "Chat User Group"
        verbose_name_plural = "Chat User Groups"
        db_table = "chat_user_groups"
        ordering = ("handle",)
        constraints = [
            # One handle, one meaning, per workspace. Two groups answering to
            # `@engineering` would make every mention of it ambiguous, and the
            # client resolves a handle with `find`, which would silently pick
            # whichever came back first.
            models.UniqueConstraint(
                fields=["workspace", "handle"],
                condition=models.Q(deleted_at__isnull=True),
                name="chat_user_group_unique_workspace_handle_when_not_deleted",
            )
        ]
        indexes = [models.Index(fields=["workspace", "handle"], name="chat_user_group_ws_handle_idx")]

    def __str__(self):
        return f"@{self.handle}"


class ChatUserGroupMember(BaseModel):
    """One person's membership of one mention group."""

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="chat_user_group_members")
    group = models.ForeignKey(ChatUserGroup, on_delete=models.CASCADE, related_name="members")
    member = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="chat_user_group_memberships"
    )

    class Meta:
        verbose_name = "Chat User Group Member"
        verbose_name_plural = "Chat User Group Members"
        db_table = "chat_user_group_members"
        ordering = ("created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["group", "member"],
                condition=models.Q(deleted_at__isnull=True),
                name="chat_user_group_member_unique_group_member_when_not_deleted",
            )
        ]
        indexes = [models.Index(fields=["member", "group"], name="chat_user_group_mem_grp_idx")]

    def __str__(self):
        return f"{self.member_id} in {self.group_id}"
