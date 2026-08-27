/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * The wire format, and the one place it is translated.
 *
 * Django speaks snake_case and UUIDs and ISO-8601. The chat components were
 * written against camelCase and epoch milliseconds, and rewriting 5000 lines of
 * component code to change that would be a rewrite pretending to be a port. So
 * the boundary is here: everything above this file sees the client types from
 * `../lib/chat-types`, everything below sees the server's.
 *
 * Two conversions are worth naming because they are where bugs hide:
 *
 * - **Timestamps.** The server sends ISO strings; the client sorts, compares and
 *   paginates on numbers. `toEpoch` is total -- a missing or unparseable date
 *   becomes 0 rather than NaN, because NaN poisons every comparison it touches
 *   and turns a bad timestamp into a scrambled message list.
 *
 * - **Reactions.** The server stores one row per person per emoji; the client
 *   wants `{emoji: [userId, ...]}`. The server already groups them, so this is a
 *   pass-through -- but it is a pass-through by agreement, not by accident, and
 *   if the API ever returns flat rows this is the function that must change.
 */

import type {
  Attachment,
  DeliveryState,
  Invite,
  LinkPreview,
  MessageMentions,
  Room,
  RoomType,
  SharedMessage,
  UserGroup,
} from "../lib/chat-types";

/* -------------------------------------------------------------------------- */
/* Server shapes                                                              */
/* -------------------------------------------------------------------------- */

export type TWireRoomMember = {
  id: string;
  member_id: string;
  display_name: string;
  email: string;
  avatar_url: string | null;
  role: number;
  notification_level: "all" | "mentions" | "none";
  is_muted: boolean;
  last_read_at: string | null;
  last_read_message: string | null;
  left_at: string | null;
};

export type TWireInvite = {
  id: string;
  code: string;
  created_at: string;
  expires_at: string | null;
  max_uses: number | null;
  uses: number;
  is_active: boolean;
};

export type TWireRoom = {
  id: string;
  type: RoomType;
  name: string | null;
  topic: string | null;
  description: string | null;
  color: string | null;
  photo: Room["photo"] | null;
  archived_at: string | null;
  created_at: string;
  created_by: string | null;
  members: TWireRoomMember[];
  invite: TWireInvite | null;
  last_message: TWireMessage | null;
  unread: { total: number; mentions: number; first_unread_id: string | null } | null;
};

export type TWireMessage = {
  id: string;
  client_id: string;
  room: string;
  sender: string | null;
  content: string;
  is_system: boolean;
  created_at: string;
  edited_at: string | null;
  tombstoned_at: string | null;
  deleted_by: string | null;
  reply_to: string | null;
  thread_root: string | null;
  pinned_by: string | null;
  pinned_at: string | null;
  scheduled_for: string | null;
  forwarded_from: { room: string; message: string; sender: string | null } | null;
  shared_profile_user: string | null;
  attachment: Attachment | null;
  mentions: MessageMentions | null;
  link_previews: LinkPreview[] | null;
  /** Already grouped server-side: emoji -> the user ids who reacted with it. */
  reactions: Record<string, string[]>;
};

export type TWirePage<T> = {
  items: T[];
  next_cursor: string | null;
  has_more: boolean;
};

export type TWireUserGroup = {
  id: string;
  handle: string;
  name: string;
  member_ids: string[];
  created_at: string;
  updated_at: string;
};

export type TWireUpdates = {
  messages: TWireMessage[];
  rooms: TWireRoom[];
  members: TWireRoomMember[];
  /**
   * Mention groups. Workspace-scoped rather than room-scoped, so unlike every
   * other collection here this one arrives even for someone in no rooms at all.
   */
  groups: TWireUserGroup[];
  /** Echo this back as `since` on the next poll. Never use the client clock. */
  server_time: string;
  /** True when the delta hit its cap; poll again immediately rather than waiting. */
  truncated: boolean;
};

/* -------------------------------------------------------------------------- */
/* Conversion                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * ISO string to epoch milliseconds, total.
 *
 * Returns 0 rather than NaN for anything unparseable. A NaN timestamp compares
 * false against everything, which does not throw -- it silently shuffles the
 * message list and breaks pagination cursors, which is far harder to notice
 * than a message dated 1970.
 */
export function toEpoch(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toIso(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return new Date(value).toISOString();
}

export function wireToInvite(wire: TWireInvite | null): Invite | null {
  if (!wire || !wire.is_active) return null;
  return {
    code: wire.code,
    createdAt: toEpoch(wire.created_at),
    expiresAt: wire.expires_at ? toEpoch(wire.expires_at) : null,
    maxUses: wire.max_uses,
    uses: wire.uses,
  };
}

/**
 * A group arrives whole -- handle, name and the entire membership on one row --
 * so a merge is a replace and never a patch. That is deliberate on the server
 * side too: `ChatUserGroupViewSet` touches the group row whenever its membership
 * moves, precisely so the client never has to reconcile two collections.
 */
export function wireToUserGroup(wire: TWireUserGroup): UserGroup {
  return {
    id: wire.id,
    handle: wire.handle,
    name: wire.name,
    memberIds: wire.member_ids ?? [],
  };
}

export function wireToRoom(wire: TWireRoom): Room {
  const active = wire.members.filter((m) => !m.left_at);

  return {
    id: wire.id,
    type: wire.type,
    ...(wire.name ? { name: wire.name } : {}),
    ...(wire.topic ? { topic: wire.topic } : {}),
    ...(wire.description ? { description: wire.description } : {}),
    ...(wire.created_by ? { createdBy: wire.created_by } : {}),
    createdAt: toEpoch(wire.created_at),
    // The client's four parallel arrays are derived here rather than stored.
    // The server's membership table is the truth; these are a view of it that
    // the existing components already know how to read.
    adminIds: active.filter((m) => m.role >= 20).map((m) => m.member_id),
    participantIds: active.map((m) => m.member_id),
    mutedUserIds: active.filter((m) => m.is_muted).map((m) => m.member_id),
    notificationLevels: Object.fromEntries(active.map((m) => [m.member_id, m.notification_level])),
    notificationsMutedBy: active.filter((m) => m.notification_level === "none").map((m) => m.member_id),
    invite: wireToInvite(wire.invite),
    ...(wire.color ? { color: wire.color } : {}),
    ...(wire.photo ? { photo: wire.photo } : {}),
    ...(wire.archived_at ? { archived: true, archivedAt: toEpoch(wire.archived_at) } : {}),
  };
}

export function wireToMessage(wire: TWireMessage): SharedMessage {
  const isTombstoned = Boolean(wire.tombstoned_at);

  return {
    id: wire.id,
    clientId: wire.client_id,
    roomId: wire.room,
    // A system message has no author. The client's type wants a string, and the
    // components already special-case `system`, so the empty sender never
    // reaches an avatar lookup.
    senderId: wire.sender ?? "",
    content: wire.content,
    timestamp: toEpoch(wire.created_at),
    ...(wire.edited_at ? { editedAt: toEpoch(wire.edited_at) } : {}),
    ...(isTombstoned ? { deletedAt: toEpoch(wire.tombstoned_at) } : {}),
    ...(wire.deleted_by ? { deletedBy: wire.deleted_by } : {}),
    ...(wire.is_system ? { system: true } : {}),
    reactions: wire.reactions ?? {},
    replyToId: wire.reply_to,
    threadRootId: wire.thread_root,
    ...(wire.shared_profile_user ? { sharedProfileUserId: wire.shared_profile_user } : {}),
    ...(wire.attachment ? { attachment: wire.attachment } : {}),
    // Anything the server has returned is, by definition, delivered. The
    // `sending` and `failed` states only exist client-side, in the outbox.
    delivery: "delivered" as DeliveryState,
    ...(wire.pinned_by ? { pinnedBy: wire.pinned_by, pinnedAt: toEpoch(wire.pinned_at) } : {}),
    ...(wire.link_previews?.length ? { linkPreviews: wire.link_previews } : {}),
    ...(wire.mentions ? { mentions: wire.mentions } : {}),
    ...(wire.forwarded_from
      ? {
          forwardedFrom: {
            roomId: wire.forwarded_from.room,
            messageId: wire.forwarded_from.message,
            senderId: wire.forwarded_from.sender ?? "",
          },
        }
      : {}),
    ...(wire.scheduled_for ? { scheduledFor: toEpoch(wire.scheduled_for) } : {}),
  };
}
