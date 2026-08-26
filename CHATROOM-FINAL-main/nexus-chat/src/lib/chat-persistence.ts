/**
 * Snapshot persistence and schema migration.
 *
 * Bumping the schema without a migration path silently throws away everyone's
 * existing workspace, so v1 snapshots (the previous localStorage format) are
 * upgraded in place rather than discarded.
 */

import type {
  Draft,
  MessageId,
  Notification,
  PrivateAIMessage,
  ReadState,
  Room,
  RoomId,
  SharedMessage,
  UserId,
} from "./chat-types";

export const STORAGE_KEY = "nexus-chat-demo-v1";
export const SCHEMA_VERSION = 2;

export interface PersistedState {
  version: number;
  rooms: Room[];
  messages: SharedMessage[];
  aiMessages: PrivateAIMessage[];
  currentUserId: UserId;
  activeRoomId: RoomId;
  notifications: Notification[];
  readState: ReadState;
  drafts: Record<string, Draft>;
  saved: Record<UserId, MessageId[]>;
  followedThreads: Record<UserId, MessageId[]>;
}

interface LegacyV1 {
  version: 1;
  rooms: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  aiMessages: Array<Record<string, unknown>>;
  currentUserId: string;
  activeRoomId: string;
  notifications: Array<{ id: string; text: string; timestamp: number }>;
  unread: Record<string, number>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** v1 rooms carried a bare `inviteCode`; v2 models an invite with limits. */
function migrateRoom(raw: Record<string, unknown>): Room {
  const inviteCode = raw["inviteCode"];
  const createdAt =
    typeof raw["createdAt"] === "number" ? (raw["createdAt"] as number) : Date.now();
  return {
    id: String(raw["id"]),
    type: (raw["type"] === "direct" ? "direct" : "group") as Room["type"],
    ...(typeof raw["name"] === "string" ? { name: raw["name"] } : {}),
    ...(typeof raw["description"] === "string" ? { description: raw["description"] } : {}),
    ...(typeof raw["createdBy"] === "string" ? { createdBy: raw["createdBy"] } : {}),
    createdAt,
    adminIds: Array.isArray(raw["adminIds"]) ? (raw["adminIds"] as string[]) : [],
    participantIds: Array.isArray(raw["participantIds"]) ? (raw["participantIds"] as string[]) : [],
    groupMuted: Boolean(raw["groupMuted"]),
    mutedUserIds: Array.isArray(raw["mutedUserIds"]) ? (raw["mutedUserIds"] as string[]) : [],
    invite:
      typeof inviteCode === "string"
        ? { code: inviteCode, createdAt, expiresAt: null, maxUses: null, uses: 0 }
        : null,
    ...(typeof raw["color"] === "string" ? { color: raw["color"] } : {}),
    ...(Array.isArray(raw["notificationsMutedBy"])
      ? { notificationsMutedBy: raw["notificationsMutedBy"] as string[] }
      : {}),
  };
}

function migrateMessage(raw: Record<string, unknown>): SharedMessage {
  const id = String(raw["id"]);
  const attachment = raw["attachment"];
  return {
    id,
    // v1 had no idempotency key; derive a stable one from the row id.
    clientId: typeof raw["clientId"] === "string" ? raw["clientId"] : `legacy-${id}`,
    roomId: String(raw["roomId"]),
    senderId: String(raw["senderId"]),
    content: typeof raw["content"] === "string" ? raw["content"] : "",
    timestamp: typeof raw["timestamp"] === "number" ? (raw["timestamp"] as number) : Date.now(),
    ...(raw["system"] ? { system: true } : {}),
    reactions: isObject(raw["reactions"]) ? (raw["reactions"] as Record<string, string[]>) : {},
    replyToId: typeof raw["replyToId"] === "string" ? raw["replyToId"] : null,
    ...(raw["sharedFromAi"] ? { sharedFromAi: true } : {}),
    ...(isObject(attachment)
      ? { attachment: attachment as unknown as SharedMessage["attachment"] }
      : {}),
    // Anything already stored was, by definition, delivered.
    delivery: "delivered",
  };
}

function migrateAi(raw: Record<string, unknown>): PrivateAIMessage {
  return {
    id: String(raw["id"]),
    roomId: String(raw["roomId"]),
    ownerUserId: String(raw["ownerUserId"]),
    prompt: typeof raw["prompt"] === "string" ? raw["prompt"] : "",
    response: typeof raw["response"] === "string" ? raw["response"] : "",
    timestamp: typeof raw["timestamp"] === "number" ? (raw["timestamp"] as number) : Date.now(),
    ...(raw["pending"] ? { pending: true } : {}),
    ...(raw["error"] ? { error: true } : {}),
    // Each legacy exchange becomes its own single-turn conversation.
    conversationId: `legacy-${String(raw["id"])}`,
    kind: "chat",
  };
}

/**
 * Rebuilds per-user read markers from v1's `unread` counters. The counts are
 * approximate by nature, so this places the marker N messages back from the
 * newest — close enough that nothing is wrongly marked read.
 */
function migrateReadState(legacy: LegacyV1, messages: SharedMessage[]): ReadState {
  const readState: ReadState = {};
  const byRoom = new Map<string, SharedMessage[]>();
  for (const message of messages) {
    const list = byRoom.get(message.roomId) ?? [];
    list.push(message);
    byRoom.set(message.roomId, list);
  }

  for (const [roomId, list] of byRoom) {
    const ordered = list.sort((a, b) => a.timestamp - b.timestamp);
    const unread = legacy.unread?.[roomId] ?? 0;
    const index = Math.max(0, ordered.length - unread - 1);
    const marker = ordered[index];
    readState[roomId] = {
      [legacy.currentUserId]: {
        lastReadTimestamp: marker ? marker.timestamp : 0,
        lastReadMessageId: marker ? marker.id : null,
        updatedAt: Date.now(),
      },
    };
  }
  return readState;
}

function migrateV1(legacy: LegacyV1): PersistedState {
  const messages = legacy.messages.filter(isObject).map(migrateMessage);
  return {
    version: SCHEMA_VERSION,
    rooms: legacy.rooms.filter(isObject).map(migrateRoom),
    messages,
    aiMessages: legacy.aiMessages.filter(isObject).map(migrateAi),
    currentUserId: legacy.currentUserId,
    activeRoomId: legacy.activeRoomId,
    notifications: (legacy.notifications ?? []).map((n) => ({ ...n, kind: "system" as const })),
    readState: migrateReadState(legacy, messages),
    drafts: {},
    saved: {},
    followedThreads: {},
  };
}

function isV2(value: Record<string, unknown>): boolean {
  return (
    value["version"] === SCHEMA_VERSION &&
    Array.isArray(value["rooms"]) &&
    Array.isArray(value["messages"]) &&
    Array.isArray(value["aiMessages"]) &&
    typeof value["currentUserId"] === "string" &&
    typeof value["activeRoomId"] === "string"
  );
}

export function parseSavedState(raw: string | null): PersistedState | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(value)) return null;

  if (value["version"] === 1 && Array.isArray(value["messages"])) {
    try {
      return migrateV1(value as unknown as LegacyV1);
    } catch {
      // A corrupt legacy snapshot should reset to seed data, not crash boot.
      return null;
    }
  }

  if (!isV2(value)) return null;
  const state = value as unknown as PersistedState;
  return {
    ...state,
    notifications: state.notifications ?? [],
    readState: state.readState ?? {},
    drafts: state.drafts ?? {},
    saved: state.saved ?? {},
    followedThreads: state.followedThreads ?? {},
  };
}

export function writeSnapshot(state: PersistedState): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    // Quota exhausted (attachments are stored inline) or storage disabled.
    // The app stays fully usable in memory; only durability is lost.
    return false;
  }
}

export const draftKey = (userId: UserId, roomId: RoomId, threadRootId?: MessageId | null) =>
  `${userId}:${roomId}${threadRootId ? `:${threadRootId}` : ""}`;
