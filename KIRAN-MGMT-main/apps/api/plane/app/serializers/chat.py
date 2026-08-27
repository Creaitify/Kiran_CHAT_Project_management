# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Chat serializers.

The field names here are chosen to match the client's TypeScript domain model
(`SharedMessage`, `Room`, `Invite`) as closely as snake_case allows, so the web
adapter is a mechanical snake -> camel rename rather than a translation layer.
Every place the JSON deviates from that model carries a comment saying why.

Two conventions follow from that goal:

1. **Foreign keys are emitted as `<name>_id` where the client names them
   `<name>Id`, and as the bare field name where the client does not.** So
   `room_id`/`sender_id`/`reply_to_id` (client: `roomId`/`senderId`/`replyToId`)
   but `pinned_by`/`deleted_by` (client: `pinnedBy`/`deletedBy`, which hold a
   user id under a suffix-less name). This is why the ids are declared
   explicitly instead of leaning on ModelSerializer's default FK handling.

2. **Reads and writes are separate serializers.** `ChatMessageSerializer` is the
   read shape and is read-only apart from `content`, which is the only thing a
   PATCH may change.
"""

# Python imports
import re
from datetime import timedelta

# Django imports
from django.utils import timezone

# Third party imports
from rest_framework import serializers

# Module imports
from plane.db.models import ChatMessage, ChatRoom, ChatRoomInvite, ChatRoomMember, ChatUserGroup

from .base import BaseSerializer

# Handles a group may not claim.
#
# `channel` and `here` mirror BROADCAST_HANDLES in `chat/lib/mentions.ts`:
# `parseMentions` checks `isBroadcast` before it looks at the group list, so a
# group answering to one of them would be written into messages and then never
# resolve to anybody. `agent` is the composer's AI target -- a group by that
# name would put two identically-labelled `@agent` rows in the autocomplete.
RESERVED_HANDLES = frozenset({"channel", "here", "agent"})


class ChatRoomLiteSerializer(BaseSerializer):
    """Just enough of a room to render a reference to it."""

    class Meta:
        model = ChatRoom
        fields = ["id", "type", "name", "color", "archived_at"]
        read_only_fields = fields


class ChatRoomMemberSerializer(BaseSerializer):
    # Denormalised from the member so a room list renders every avatar and name
    # without a second request per person. The alternative -- a nested
    # UserLiteSerializer -- would have the client reach one level deeper for
    # fields it needs on every single row.
    display_name = serializers.CharField(read_only=True, source="member.display_name")
    avatar_url = serializers.CharField(read_only=True, source="member.avatar_url")
    email = serializers.EmailField(read_only=True, source="member.email")

    member_id = serializers.UUIDField(read_only=True)
    room_id = serializers.UUIDField(read_only=True)
    # The client's ReadMarker calls this `lastReadMessageId`; `last_read_at` is
    # its `lastReadTimestamp`.
    last_read_message_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = ChatRoomMember
        fields = [
            "id",
            "room_id",
            "member_id",
            "display_name",
            "avatar_url",
            "email",
            "role",
            "notification_level",
            "is_muted",
            "last_read_message_id",
            "last_read_at",
            "left_at",
            "created_at",
            "updated_at",
        ]
        # A member may change their own notification level and mute flag; only a
        # room admin may change role. That distinction is enforced in the view,
        # which knows who is asking -- the serializer only decides what is
        # writable at all.
        read_only_fields = [
            "id",
            "room_id",
            "member_id",
            "display_name",
            "avatar_url",
            "email",
            "last_read_message_id",
            "last_read_at",
            "left_at",
            "created_at",
            "updated_at",
        ]


class ChatRoomInviteSerializer(BaseSerializer):
    room_id = serializers.UUIDField(read_only=True)
    # The client has the same three-way check in `invite-rules.ts`, but as a
    # client-only rule it is a devtools edit away from being bypassed. The
    # server is the authority; this field is what the UI should render.
    state = serializers.SerializerMethodField()

    class Meta:
        model = ChatRoomInvite
        fields = [
            "id",
            "room_id",
            "code",
            "expires_at",
            "max_uses",
            "uses",
            "is_active",
            "state",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "room_id", "code", "uses", "state", "created_at", "updated_at"]

    def get_state(self, obj):
        if not obj.is_active:
            return "none"
        # Expiry is checked before exhaustion so a link that is both reads as
        # "expired", matching the client's ordering.
        if obj.expires_at and obj.expires_at <= timezone.now():
            return "expired"
        if obj.max_uses is not None and obj.uses >= obj.max_uses:
            return "exhausted"
        return "active"


class ChatMessageSerializer(BaseSerializer):
    room_id = serializers.UUIDField(read_only=True)
    sender_id = serializers.UUIDField(read_only=True)
    reply_to_id = serializers.UUIDField(read_only=True)
    thread_root_id = serializers.UUIDField(read_only=True)
    shared_profile_user_id = serializers.UUIDField(read_only=True)

    # Grouped as {emoji: [user_id, ...]} because that is the shape the client
    # renders from; a flat list of rows would make it re-group on every paint.
    # Requires prefetch_related("reactions") or this is one query per message.
    reactions = serializers.SerializerMethodField()
    # The client tests `typeof deletedAt === "number"`; giving it the boolean
    # outright keeps the tombstone check off the adapter.
    is_deleted = serializers.SerializerMethodField()
    # The client's ForwardedFrom is {roomId, messageId, senderId} -- the origin,
    # not just its id -- so the FK is expanded rather than emitted as a pk.
    forwarded_from = serializers.SerializerMethodField()

    class Meta:
        model = ChatMessage
        fields = [
            "id",
            "client_id",
            "room_id",
            "sender_id",
            "content",
            # The client calls this `timestamp`. Kept as `created_at` because
            # every other Plane serializer does, and it is one rename.
            "created_at",
            "updated_at",
            "edited_at",
            # `tombstoned_at` is the client's `deletedAt`. BaseModel's own
            # `deleted_at` is deliberately NOT emitted: it is the soft-delete
            # column that SoftDeletionManager filters on, and mapping it to
            # `deletedAt` would conflate two different deletions.
            "tombstoned_at",
            "is_deleted",
            "deleted_by",
            # The client calls this `system`; the model's boolean prefix wins
            # here because renaming it would collide with Python's own naming.
            "is_system",
            "reactions",
            "reply_to_id",
            "thread_root_id",
            "shared_profile_user_id",
            # {asset_id, name, type, size}. The client's Attachment carries a
            # `dataUrl` instead of an `asset_id` -- it inlined bytes; here the
            # bytes are a FileAsset the client resolves to a URL.
            "attachment",
            "pinned_by",
            "pinned_at",
            "link_previews",
            "mentions",
            "forwarded_from",
            "scheduled_for",
        ]
        # `content` is the only writable field: a PATCH may edit the body and
        # nothing else. Everything the client's SharedMessage carries beyond
        # this list -- `delivery`, `attempts`, `failureReason`, `sharedFromAi`
        # -- is outbox state the client owns; a row that came back from the
        # server is delivered by definition.
        read_only_fields = [field for field in fields if field != "content"]

    def get_reactions(self, obj):
        grouped = {}
        for reaction in obj.reactions.all():
            grouped.setdefault(reaction.emoji, []).append(str(reaction.actor_id))
        return grouped

    def get_is_deleted(self, obj):
        return obj.tombstoned_at is not None

    def get_forwarded_from(self, obj):
        if not obj.forwarded_from_id:
            return None
        origin = obj.forwarded_from
        return {
            "room_id": str(origin.room_id),
            "message_id": str(origin.id),
            "sender_id": str(origin.sender_id) if origin.sender_id else None,
        }


class ChatMessageCreateSerializer(BaseSerializer):
    class Meta:
        model = ChatMessage
        fields = [
            "client_id",
            "content",
            "reply_to",
            "thread_root",
            "attachment",
            "mentions",
            "scheduled_for",
            "shared_profile_user",
            "forwarded_from",
        ]

    def validate_client_id(self, value):
        # The idempotency key. Without it a retry after an ambiguous failure
        # produces a duplicate row, so it is required rather than generated
        # server-side -- only the client knows which send this is a retry of.
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("client_id is required.")
        return value

    def validate_scheduled_for(self, value):
        """A send time in the past is a bug, not an instruction.

        The release sweep publishes anything already due on its next pass, so
        accepting a past timestamp would post the message immediately -- into a
        position in the transcript above messages people have already read.
        A minute of slack absorbs clock skew between the client and the server;
        anything beyond that is the client getting it wrong.
        """
        if value and value < timezone.now() - timedelta(minutes=1):
            raise serializers.ValidationError("A message cannot be scheduled for the past.")
        return value

    def validate(self, attrs):
        if not any(
            [
                (attrs.get("content") or "").strip(),
                attrs.get("attachment"),
                attrs.get("shared_profile_user"),
                attrs.get("forwarded_from"),
            ]
        ):
            raise serializers.ValidationError({"content": "A message must carry content, an attachment or a contact."})

        # A reply or a thread reply must point inside the room it is posted to.
        # `forwarded_from` is exempt: pointing at another room is what it means.
        room = self.context.get("room")
        if room:
            for field in ("reply_to", "thread_root"):
                target = attrs.get(field)
                if target and target.room_id != room.id:
                    raise serializers.ValidationError({field: "The referenced message is in a different room."})

        return attrs


class ChatRoomSerializer(BaseSerializer):
    members = ChatRoomMemberSerializer(read_only=True, many=True)
    # The snapshot carried `adminIds`, `participantIds`, `mutedUserIds` and
    # `notificationLevels` as four parallel arrays on the room. They are all one
    # row per person now, so the client reads them off `members` instead.

    # The single active link, if there is one. Reads from prefetch_related
    # ("invites") rather than querying, so the room list stays one query.
    invite = serializers.SerializerMethodField()
    # Write-only: the read side is `archived_at`, and "archived" is just
    # "archived_at is not null". Two representations of one fact, but the
    # client's Room has both and a PATCH is clearer as a boolean.
    archived = serializers.BooleanField(required=False, write_only=True)

    # Supplied by the list view, which computes both in bulk -- per-room here
    # would be two queries per row. Absent on the detail route, where the
    # client already has the messages.
    last_message = serializers.SerializerMethodField()
    unread = serializers.SerializerMethodField()

    class Meta:
        model = ChatRoom
        fields = [
            "id",
            "type",
            "name",
            "topic",
            "description",
            "color",
            # Cropped group image: {url, zoom, x, y}.
            "photo",
            "archived",
            "archived_at",
            "members",
            "invite",
            "last_message",
            "unread",
            "created_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            # Set once at creation; a direct room cannot become a group.
            "type",
            "archived_at",
            "members",
            "invite",
            "last_message",
            "unread",
            "created_by",
            "created_at",
            "updated_at",
        ]

    def validate_photo(self, value):
        if value in (None, ""):
            return None
        if not isinstance(value, dict):
            raise serializers.ValidationError("photo must be an object of {url, zoom, x, y}.")
        return value

    def create(self, validated_data):
        # `archived` is not a column -- unwrap it before the model sees it.
        validated_data.pop("archived", None)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        archived = validated_data.pop("archived", None)
        if archived is not None:
            validated_data["archived_at"] = timezone.now() if archived else None
        return super().update(instance, validated_data)

    def get_invite(self, obj):
        invite = next((invite for invite in obj.invites.all() if invite.is_active), None)
        return ChatRoomInviteSerializer(invite).data if invite else None

    def get_last_message(self, obj):
        message = self.context.get("last_messages", {}).get(obj.id)
        return ChatMessageSerializer(message).data if message else None

    def get_unread(self, obj):
        return self.context.get("unread", {}).get(obj.id)


class ChatUserGroupSerializer(BaseSerializer):
    """A mention group and the ids in it.

    `member_ids` is the whole membership, written as a set rather than through
    per-member endpoints. A mention group is small and is edited as one thing --
    "who is on-call this week" is one decision, not five add-and-remove calls --
    and doing it in one request is also what makes it atomic. `ChatUserGroupMember`
    stays a table because the alternative is an array column that cannot answer
    "which groups is this person in" without a scan.
    """

    # Write-only, and `to_representation` puts it back. A declared field of this
    # name would otherwise have DRF look for `instance.member_ids` on the way
    # out, which does not exist -- membership is a related table, and reading it
    # off the prefetch is the whole point.
    member_ids = serializers.ListField(child=serializers.UUIDField(), required=False, write_only=True)

    class Meta:
        model = ChatUserGroup
        fields = ["id", "handle", "name", "member_ids", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_handle(self, value):
        """The handle has to survive the round trip through a message body.

        Mentions are stored as `<!handle>` and read back with
        `/<!([a-zA-Z0-9_-]+)>/` (`USER_TOKEN`/`SPECIAL_TOKEN` in
        `chat/lib/mentions.ts`). A handle with a character outside that class
        would be written into a message and then not parse out of it: the group
        would look mentionable and silently notify nobody.
        """
        value = (value or "").strip().lower()
        if not value:
            raise serializers.ValidationError("handle is required.")
        if not re.fullmatch(r"[a-z0-9_-]+", value):
            raise serializers.ValidationError(
                "A handle may only contain letters, numbers, hyphens and underscores."
            )
        if value in RESERVED_HANDLES:
            raise serializers.ValidationError(f"@{value} is reserved.")
        return value

    def validate_name(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("name is required.")
        return value

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # `members` is prefetched by the view. Reading it off the instance rather
        # than querying keeps a list of N groups at one query instead of N.
        data["member_ids"] = [str(membership.member_id) for membership in instance.members.all()]
        return data
