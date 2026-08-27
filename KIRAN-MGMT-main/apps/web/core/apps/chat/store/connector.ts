/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Where chat state comes from, and where the small part of it that is nobody
 * else's business goes.
 *
 * ---------------------------------------------------------------------------
 * What changed from Stage 1
 * ---------------------------------------------------------------------------
 * The Stage 1 connector had `load(): PersistedState` and
 * `save(state: PersistedState)` -- the whole workspace in, the whole workspace
 * out, on every keystroke. That was a deliberate placeholder: it matched
 * exactly what the store already did with localStorage, which is what made it a
 * seam and not a rewrite. It was also indefensible as a design.
 *
 * `save` is gone. Every mutation that other people can see now goes through its
 * own endpoint at the point the store performs it -- sending a message POSTs a
 * message, renaming a room PATCHes a room. Nothing writes the world.
 *
 * What survives is `load`, because boot genuinely is "fetch everything I can
 * see", and `subscribe`, because something has to notice other people typing.
 *
 * ---------------------------------------------------------------------------
 * The client-local slice
 * ---------------------------------------------------------------------------
 * Three things stay in localStorage and should: unsent drafts, which room you
 * had open, and the last polling watermark. None of them is anyone else's
 * business, none survives a device change in any useful way, and a round trip
 * to Postgres per keystroke to store a draft would be worse in every dimension.
 *
 * Saved messages and followed threads used to live here too. They do not any
 * more -- they are real per-person data that should follow an account between
 * devices, and they now have a table.
 */

import type {
  Draft,
  ReadState,
  Room,
  RoomId,
  SharedMessage,
  User,
  UserGroup,
  UserId,
} from "../lib/chat-types";
import type { ChatService } from "../services/chat.service";
import type { TWireRoom } from "../services/wire";
import { toEpoch, wireToMessage, wireToRoom, wireToUserGroup } from "../services/wire";

/** How many messages of history to pull per room at boot. */
const INITIAL_PAGE = 40;

/**
 * How often to ask the server what changed.
 *
 * Three seconds is a compromise, not a measurement: fast enough that a
 * conversation does not feel like email, slow enough that a handful of people
 * with chat open do not look like a load test. The moment the websocket service
 * works, this whole mechanism is replaced by it.
 */
const POLL_INTERVAL_MS = 3_000;

const LOCAL_KEY = "kiran-chat-local-v1";

export type TChatLocalState = {
  activeRoomId: RoomId | null;
  drafts: Record<string, Draft>;
  /** Server clock, echoed back on the next poll. Never a local reading. */
  watermark: string | null;
};

const EMPTY_LOCAL: TChatLocalState = { activeRoomId: null, drafts: {}, watermark: null };

/** Everything the store needs to start rendering. */
export type TChatBootstrap = {
  rooms: Room[];
  messages: SharedMessage[];
  readState: ReadState;
  userGroups: UserGroup[];
  /** Rooms whose history has more pages behind the first one. */
  hasMoreByRoom: Record<RoomId, boolean>;
  /** Oldest-message cursor per room, for scrollback. */
  cursorByRoom: Record<RoomId, string | null>;
};

/* -------------------------------------------------------------------------- */
/* Client-local slice                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Reads never throw. A corrupt value, a private window, or storage disabled
 * entirely must all degrade to "no drafts" rather than to a blank screen --
 * losing a draft is an annoyance, failing to boot is a bug.
 */
export function readLocalState(userId: UserId): TChatLocalState {
  if (typeof window === "undefined") return EMPTY_LOCAL;
  try {
    const raw = window.localStorage.getItem(`${LOCAL_KEY}:${userId}`);
    if (!raw) return EMPTY_LOCAL;
    const parsed = JSON.parse(raw) as Partial<TChatLocalState>;
    return {
      activeRoomId: typeof parsed.activeRoomId === "string" ? parsed.activeRoomId : null,
      drafts: typeof parsed.drafts === "object" && parsed.drafts !== null ? parsed.drafts : {},
      watermark: typeof parsed.watermark === "string" ? parsed.watermark : null,
    };
  } catch {
    return EMPTY_LOCAL;
  }
}

export function writeLocalState(userId: UserId, state: TChatLocalState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${LOCAL_KEY}:${userId}`, JSON.stringify(state));
  } catch {
    // Quota or a disabled store. The app is fully usable in memory; only the
    // draft's survival across a reload is lost.
  }
}

/* -------------------------------------------------------------------------- */
/* Boot                                                                        */
/* -------------------------------------------------------------------------- */

/** Read markers for every member of every room, keyed the way the UI wants. */
function readStateFrom(wireRooms: TWireRoom[]): ReadState {
  const readState: ReadState = {};
  for (const room of wireRooms) {
    const byUser: ReadState[string] = {};
    for (const member of room.members) {
      if (!member.last_read_at) continue;
      byUser[member.member_id] = {
        lastReadTimestamp: toEpoch(member.last_read_at),
        lastReadMessageId: member.last_read_message,
        updatedAt: toEpoch(member.last_read_at),
      };
    }
    readState[room.id] = byUser;
  }
  return readState;
}

/**
 * Fetches the rooms, then the newest page of each in parallel.
 *
 * Parallel rather than sequential because these are independent reads and a
 * person in fifteen rooms should not wait fifteen round trips to see the first
 * one. A room whose history fails to load yields an empty page rather than
 * failing the boot: an empty conversation you can scroll is recoverable, a
 * chat app that will not open is not.
 */
export async function bootstrapChat(service: ChatService, workspaceSlug: string): Promise<TChatBootstrap> {
  const wireRooms = await service.listRooms(workspaceSlug);
  const rooms = wireRooms.map(wireToRoom);

  // Alongside the room reads, not before them. Mention groups are cosmetic
  // until someone types `@` -- a workspace with none, or an endpoint that
  // 500s, must cost the composer its group suggestions and nothing else.
  const userGroups = await service
    .listUserGroups(workspaceSlug)
    .then((wire) => wire.map(wireToUserGroup))
    .catch(() => []);

  const pages = await Promise.all(
    wireRooms.map(async (room) => {
      try {
        const page = await service.listMessages(workspaceSlug, room.id, { limit: INITIAL_PAGE });
        return { roomId: room.id, page };
      } catch {
        return { roomId: room.id, page: { items: [], next_cursor: null, has_more: false } };
      }
    })
  );

  const messages: SharedMessage[] = [];
  const hasMoreByRoom: Record<RoomId, boolean> = {};
  const cursorByRoom: Record<RoomId, string | null> = {};

  for (const { roomId, page } of pages) {
    for (const wire of page.items) messages.push(wireToMessage(wire));
    hasMoreByRoom[roomId] = page.has_more;
    cursorByRoom[roomId] = page.next_cursor;
  }

  return {
    rooms,
    messages,
    readState: readStateFrom(wireRooms),
    userGroups,
    hasMoreByRoom,
    cursorByRoom,
  };
}

/* -------------------------------------------------------------------------- */
/* Live updates                                                                */
/* -------------------------------------------------------------------------- */

export type TChatDelta = {
  messages: SharedMessage[];
  rooms: Room[];
  readState: ReadState;
  userGroups: UserGroup[];
  watermark: string;
};

/**
 * Polls for changes until the returned function is called.
 *
 * Two properties matter more than the interval:
 *
 * - **The watermark comes from the server.** Each response carries
 *   `server_time`, and that is what the next request sends back. A client whose
 *   clock is thirty seconds fast would otherwise ask for changes since a moment
 *   that has not happened yet and silently skip half a minute of other people's
 *   messages -- a bug that reproduces only on someone else's laptop.
 *
 * - **A failed poll does not advance the watermark and does not stop the loop.**
 *   The next tick re-asks for the same window. A dropped Wi-Fi connection costs
 *   latency, never messages.
 */
export function subscribeToChatUpdates(
  service: ChatService,
  workspaceSlug: string,
  initialWatermark: string,
  onDelta: (delta: TChatDelta) => void
): () => void {
  let watermark = initialWatermark;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      const update = await service.fetchUpdates(workspaceSlug, watermark);
      if (stopped) return;

      watermark = update.server_time;

      // `groups` is absent from a server that predates mention groups, so it is
      // read defensively rather than assumed -- an older API answering this poll
      // must not make the whole delta throw.
      const groups = update.groups ?? [];

      if (update.messages.length || update.rooms.length || groups.length) {
        onDelta({
          messages: update.messages.map(wireToMessage),
          rooms: update.rooms.map(wireToRoom),
          readState: readStateFrom(update.rooms),
          userGroups: groups.map(wireToUserGroup),
          watermark,
        });
      }

      // The server capped the response. Come straight back rather than waiting
      // out the interval, or a busy workspace can never catch up with itself.
      if (update.truncated) {
        timer = setTimeout(() => void tick(), 0);
        return;
      }
    } catch {
      // Deliberately silent. A poll that fails every three seconds during an
      // outage would otherwise fill the console with identical noise, and the
      // user already has a connection indicator.
    }
    if (!stopped) timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
  };

  timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

/* -------------------------------------------------------------------------- */
/* Merging                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Folds a delta into the message list the UI is rendering.
 *
 * Matching is by server id first, then by `clientId`. The second is what stops
 * your own message appearing twice: it is already on screen as an optimistic
 * row with a locally-minted id, and the copy the server sends back has a
 * different id but the same client key.
 *
 * An incoming row wins over a local one except while the local one is still in
 * flight -- a `sending` or `failed` message is the user's unsaved work and must
 * not be overwritten by an older server view of the same conversation.
 */
export function mergeMessages(current: SharedMessage[], incoming: SharedMessage[]): SharedMessage[] {
  if (incoming.length === 0) return current;

  const byId = new Map(current.map((message) => [message.id, message]));
  const byClientId = new Map(current.filter((m) => m.clientId).map((m) => [m.clientId, m]));

  let changed = false;
  const next = [...current];

  for (const message of incoming) {
    const existing = byId.get(message.id) ?? byClientId.get(message.clientId);
    if (!existing) {
      next.push(message);
      changed = true;
      continue;
    }
    if (existing.delivery === "sending" || existing.delivery === "failed") continue;

    const index = next.indexOf(existing);
    if (index >= 0) {
      next[index] = message;
      changed = true;
    }
  }

  return changed ? next : current;
}

/** Same idea for rooms: replace by id, append what is new. */
export function mergeRooms(current: Room[], incoming: Room[]): Room[] {
  if (incoming.length === 0) return current;

  const next = [...current];
  let changed = false;

  for (const room of incoming) {
    const index = next.findIndex((r) => r.id === room.id);
    if (index >= 0) next[index] = room;
    else next.push(room);
    changed = true;
  }

  return changed ? next : current;
}

/**
 * Same idea for mention groups, with one asymmetry worth knowing about.
 *
 * A group arrives whole -- the server touches the group row whenever its
 * membership moves -- so replacing by id is always correct and a partial merge
 * is never needed. What the delta cannot carry is a *deletion*: a deleted group
 * is soft-deleted, and soft-deleted rows are filtered out of every query rather
 * than reported as gone. The admin who deleted it drops it locally; everyone
 * else keeps offering the handle until their next reload, at which point the
 * boot fetch is authoritative.
 *
 * That is a tolerable failure mode and an intentional one: a stale handle
 * resolves to a group that is no longer there, `resolveMentionTargets` finds
 * nothing to notify, and `MarkdownContent` renders it as plain text. Nobody is
 * mis-notified; a mention just quietly does nothing.
 */
export function mergeUserGroups(current: UserGroup[], incoming: UserGroup[]): UserGroup[] {
  if (incoming.length === 0) return current;

  const next = [...current];
  for (const group of incoming) {
    const index = next.findIndex((existing) => existing.id === group.id);
    if (index >= 0) next[index] = group;
    else next.push(group);
  }

  return next;
}

/**
 * Read markers only ever move forward.
 *
 * Polls can arrive out of order, and a stale response carrying an older marker
 * would otherwise resurrect an unread badge the user has already cleared.
 */
export function mergeReadState(current: ReadState, incoming: ReadState): ReadState {
  const next: ReadState = { ...current };
  for (const [roomId, byUser] of Object.entries(incoming)) {
    const existing = next[roomId] ?? {};
    const merged = { ...existing };
    for (const [userId, marker] of Object.entries(byUser)) {
      const previous = existing[userId];
      if (previous && previous.lastReadTimestamp >= marker.lastReadTimestamp) continue;
      merged[userId] = marker;
    }
    next[roomId] = merged;
  }
  return next;
}

/**
 * Workspace members, as chat's directory.
 *
 * Chat had a `User` type with a `color` used for avatar gradients and a
 * `timeZone` used to render "their local time". KIRAN's member records carry
 * neither reliably, so `color` is derived deterministically from the user id --
 * the same person is the same colour on every device and in every session,
 * which is the only property the avatar actually needs.
 */
const AVATAR_COLORS = [
  "#176ee8",
  "#0f9d58",
  "#d93025",
  "#8430ce",
  "#0b8043",
  "#e37400",
  "#0a7ea4",
  "#c5221f",
  "#3949ab",
  "#00897b",
];

export function colorForUser(userId: UserId): string {
  let hash = 0;
  for (let index = 0; index < userId.length; index += 1) {
    hash = (hash * 31 + userId.charCodeAt(index)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

export type TWorkspaceMemberLike = {
  member: { id: string; display_name?: string; first_name?: string; last_name?: string; email?: string };
  role?: number;
};

export function directoryFromWorkspaceMembers(members: TWorkspaceMemberLike[]): User[] {
  return members.map(({ member, role }) => ({
    id: member.id,
    name: member.display_name || [member.first_name, member.last_name].filter(Boolean).join(" ") || member.email || "Member",
    role: role === 20 ? "Admin" : role === 5 ? "Guest" : "Member",
    // Presence needs a heartbeat nobody is sending yet. Reporting everyone as
    // offline is a lie the UI renders honestly (a grey dot); reporting everyone
    // as online is a lie it renders as a green one.
    online: false,
    color: colorForUser(member.id),
    timeZone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC",
  }));
}
