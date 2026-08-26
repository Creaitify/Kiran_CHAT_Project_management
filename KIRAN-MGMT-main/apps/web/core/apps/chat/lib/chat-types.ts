/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Domain model for the chat app.
 *
 * These shapes are deliberately written as if a server owned them: every entity
 * has a stable id, mutations carry an idempotency key, and read state is stored
 * per-user rather than as a single client-side counter. That is what lets the
 * storage layer be swapped without touching the UI.
 */

export type UserId = string;
export type RoomId = string;
export type MessageId = string;
export type GroupHandle = string;

/* -------------------------------------------------------------------------- */
/* Users & groups                                                             */
/* -------------------------------------------------------------------------- */

export interface User {
  id: UserId;
  name: string;
  role: string;
  online: boolean;
  color: string;
  /** IANA zone, used to render "their local time" and to format timestamps. */
  timeZone: string;
}

/** A mentionable set of users, e.g. `@engineering`. */
export interface UserGroup {
  id: string;
  handle: GroupHandle;
  name: string;
  memberIds: UserId[];
}

/* -------------------------------------------------------------------------- */
/* Rooms                                                                       */
/* -------------------------------------------------------------------------- */

export type RoomType = "group" | "direct" | "groupdm";

export interface Invite {
  code: string;
  createdAt: number;
  /** Epoch ms; null means the link never expires. */
  expiresAt: number | null;
  /** null means unlimited redemptions. */
  maxUses: number | null;
  uses: number;
}

export interface Room {
  id: RoomId;
  type: RoomType;
  name?: string;
  /** Short "what are we doing right now" line, shown in the header. */
  topic?: string;
  /** Long-lived "why this room exists" text, shown in the info panel. */
  description?: string;
  createdBy?: UserId;
  createdAt: number;
  adminIds: UserId[];
  participantIds: UserId[];
  groupMuted?: boolean;
  mutedUserIds: UserId[];
  invite?: Invite | null | undefined;
  color?: string;
  /** Cropped group image selected by any current member. */
  photo?:
    | {
        dataUrl: string;
        zoom: number;
        x: number;
        y: number;
      }
    | undefined;
  notificationsMutedBy?: UserId[];
  /** Per-user notification level; absent entries fall back to "all". */
  notificationLevels?: Record<UserId, NotificationLevel>;
  archived?: boolean | undefined;
  archivedAt?: number | undefined;
}

export type NotificationLevel = "all" | "mentions" | "none";

/* -------------------------------------------------------------------------- */
/* Messages                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Lifecycle of an outbound message. `sending` and `failed` messages live in the
 * outbox and are retried; everything else has been acknowledged by the transport.
 */
export type DeliveryState = "sending" | "sent" | "delivered" | "read" | "failed";

export interface LinkPreview {
  url: string;
  title: string;
  description?: string;
  siteName?: string;
  image?: string;
}

export interface MessageMentions {
  users: UserId[];
  groups: GroupHandle[];
  /** `@channel` notifies every member, `@here` only those currently online. */
  broadcast: "channel" | "here" | null;
}

export interface Attachment {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}

export interface ForwardedFrom {
  roomId: RoomId;
  messageId: MessageId;
  senderId: UserId;
}

export interface SharedMessage {
  id: MessageId;
  /**
   * Client-generated idempotency key. The transport dedupes on this, so a retry
   * after an ambiguous failure can never produce a duplicate message.
   */
  clientId: string;
  roomId: RoomId;
  senderId: UserId;
  content: string;
  timestamp: number;

  /** Set when the author edits; the UI renders an "edited" marker. */
  editedAt?: number | undefined;
  /**
   * Tombstone. The row survives deletion so replies, thread roots and
   * pagination cursors stay valid; `content` is cleared at the same time.
   */
  deletedAt?: number;
  deletedBy?: UserId;

  system?: boolean;
  reactions?: Record<string, UserId[]> | undefined;
  /** Inline quote-reply within the main channel view. */
  replyToId?: MessageId | null;
  /** Root of a real thread. Messages with this set are hidden from the channel. */
  threadRootId?: MessageId | null;
  sharedFromAi?: boolean;
  /** An internal directory contact shared into a conversation. */
  sharedProfileUserId?: UserId;
  attachment?: Attachment | undefined;
  delivery: DeliveryState;
  pinnedBy?: UserId | undefined;
  pinnedAt?: number | undefined;
  linkPreviews?: LinkPreview[] | undefined;
  mentions?: MessageMentions;
  forwardedFrom?: ForwardedFrom;
  /** Set while a message waits in the scheduled queue. */
  scheduledFor?: number | undefined;
  /** Incremented every time the transport retries this message. */
  attempts?: number;
  failureReason?: string | undefined;
}

export interface PrivateAIMessage {
  id: string;
  roomId: RoomId;
  ownerUserId: UserId;
  prompt: string;
  response: string;
  timestamp: number;
  pending?: boolean;
  /** True while tokens are still arriving from the stream. */
  streaming?: boolean;
  error?: boolean;
  /** Groups a multi-turn exchange with the assistant. */
  conversationId: string;
  /** Rough token accounting, used for the per-user budget. */
  tokensUsed?: number;
  kind?: "chat" | "summary";
}

/* -------------------------------------------------------------------------- */
/* Per-user state                                                              */
/* -------------------------------------------------------------------------- */

export interface Draft {
  text: string;
  replyToId?: MessageId | null;
  threadRootId?: MessageId | null;
  updatedAt: number;
}

export interface ReadMarker {
  lastReadTimestamp: number;
  lastReadMessageId: MessageId | null;
  updatedAt: number;
}

/** roomId -> userId -> marker. Server-shaped so receipts work for every member. */
export type ReadState = Record<RoomId, Record<UserId, ReadMarker>>;

export interface UnreadSummary {
  total: number;
  mentions: number;
  firstUnreadId: MessageId | null;
}

export interface Notification {
  id: string;
  text: string;
  timestamp: number;
  roomId?: RoomId;
  messageId?: MessageId;
  kind: "mention" | "system" | "message";
  read?: boolean;
  /** When present, only this account may see the notification. */
  ownerUserId?: UserId;
}

/* -------------------------------------------------------------------------- */
/* Pagination                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Opaque cursor. Encoded as `${timestamp}:${id}` so it stays stable across
 * inserts and survives deleted rows — the same scheme a keyset-paginated SQL
 * endpoint would use.
 */
export type Cursor = string;

export interface Page<T> {
  items: T[];
  nextCursor: Cursor | null;
  hasMore: boolean;
}

export function encodeCursor(message: Pick<SharedMessage, "timestamp" | "id">): Cursor {
  return `${message.timestamp}:${message.id}`;
}

export function decodeCursor(cursor: Cursor): { timestamp: number; id: string } | null {
  // Split on the FIRST colon only: ids are UUIDs here and may not contain one,
  // but the encoding must stay tolerant of ids that do.
  const index = cursor.indexOf(":");
  if (index === -1) return null;
  const timestamp = Number(cursor.slice(0, index));
  if (!Number.isFinite(timestamp)) return null;
  return { timestamp, id: cursor.slice(index + 1) };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

export function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function isVisibleInChannel(message: SharedMessage) {
  return !message.threadRootId;
}

export function isTombstoned(message: SharedMessage) {
  return typeof message.deletedAt === "number";
}

/** Text to show in previews and search results for any message state. */
export function previewText(message: SharedMessage): string {
  if (isTombstoned(message)) return "This message was deleted";
  if (message.sharedProfileUserId) return "Shared a contact";
  if (message.attachment && !message.content) return `📎 ${message.attachment.name}`;
  return message.content;
}
