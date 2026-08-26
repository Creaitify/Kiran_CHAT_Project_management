/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Composite key for an unsent draft.
 *
 * Extracted from the standalone app's `chat-persistence.ts`, which is otherwise
 * dropped: the rest of that module was a whole-workspace localStorage snapshot,
 * and the normalized `ChatRoom` / `ChatRoomMember` / `ChatMessage` tables
 * replace it. This one function survives because drafts are still per-viewer
 * client state and still need a key.
 *
 * A draft is scoped to (viewer, room, thread) — the same person can have one
 * unsent message in the channel and a different one in a thread inside it, and
 * both must survive switching rooms and coming back.
 */

import type { MessageId, RoomId, UserId } from "./chat-types";

export function draftKey(
  userId: UserId,
  roomId: RoomId,
  threadRootId?: MessageId | null
): string {
  return `${userId}:${roomId}${threadRootId ? `:${threadRootId}` : ""}`;
}
