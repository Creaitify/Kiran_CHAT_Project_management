/**
 * Keyset (cursor) pagination over the message log.
 *
 * The UI never holds "every message ever" — it holds a window, and asks for
 * older pages as the user scrolls up. Cursors are `timestamp:id` pairs rather
 * than offsets, so concurrent inserts can't cause a page to skip or repeat a
 * row, which is exactly the guarantee an `ORDER BY (created_at, id)` keyset
 * query gives on the server.
 */

import {
  decodeCursor,
  encodeCursor,
  type Cursor,
  type Page,
  type SharedMessage,
} from "./chat-types";

export const PAGE_SIZE = 40;

/** Ascending by (timestamp, id) — the canonical channel order. */
export function compareMessages(a: SharedMessage, b: SharedMessage) {
  if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function isBefore(message: SharedMessage, cursor: { timestamp: number; id: string }) {
  if (message.timestamp !== cursor.timestamp) return message.timestamp < cursor.timestamp;
  return message.id < cursor.id;
}

/**
 * Returns the page of messages immediately *older* than `cursor`, newest-last.
 * `nextCursor` points at the oldest row returned, ready for the next call.
 */
export function pageBefore(
  source: SharedMessage[],
  cursor: Cursor | null,
  limit = PAGE_SIZE,
): Page<SharedMessage> {
  const ordered = [...source].sort(compareMessages);
  const decoded = cursor ? decodeCursor(cursor) : null;
  const eligible = decoded ? ordered.filter((message) => isBefore(message, decoded)) : ordered;

  const items = eligible.slice(Math.max(0, eligible.length - limit));
  const hasMore = eligible.length > items.length;
  const oldest = items[0];

  return {
    items,
    nextCursor: hasMore && oldest ? encodeCursor(oldest) : null,
    hasMore,
  };
}

/**
 * Expands a window far enough back to include `messageId`, so a permalink or a
 * jump-to-message can land on a row that is not in the loaded page yet.
 */
export function windowIncluding(
  source: SharedMessage[],
  messageId: string,
  padding = PAGE_SIZE,
): SharedMessage[] {
  const ordered = [...source].sort(compareMessages);
  const index = ordered.findIndex((message) => message.id === messageId);
  if (index === -1) return ordered.slice(Math.max(0, ordered.length - padding));
  return ordered.slice(Math.max(0, index - padding));
}
