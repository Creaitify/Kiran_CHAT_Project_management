import { describe, expect, it } from "vitest";
import { draftKey, parseSavedState, SCHEMA_VERSION } from "./chat-persistence";

const legacyV1 = {
  version: 1,
  rooms: [
    {
      id: "r1",
      type: "group",
      name: "Product",
      createdAt: 1000,
      adminIds: ["u1"],
      participantIds: ["u1", "u2"],
      mutedUserIds: [],
      inviteCode: "ABC123",
    },
  ],
  messages: [
    { id: "m1", roomId: "r1", senderId: "u1", content: "one", timestamp: 1000, reactions: {} },
    { id: "m2", roomId: "r1", senderId: "u2", content: "two", timestamp: 2000, reactions: {} },
    { id: "m3", roomId: "r1", senderId: "u2", content: "three", timestamp: 3000, reactions: {} },
  ],
  aiMessages: [
    { id: "a1", roomId: "r1", ownerUserId: "u1", prompt: "p", response: "r", timestamp: 1500 },
  ],
  currentUserId: "u1",
  activeRoomId: "r1",
  notifications: [{ id: "n1", text: "hello", timestamp: 900 }],
  unread: { r1: 1 },
};

describe("parseSavedState", () => {
  it("returns null for absent or corrupt input", () => {
    expect(parseSavedState(null)).toBeNull();
    expect(parseSavedState("{not json")).toBeNull();
    expect(parseSavedState(JSON.stringify({ version: 99 }))).toBeNull();
  });

  it("migrates a v1 snapshot instead of discarding it", () => {
    const state = parseSavedState(JSON.stringify(legacyV1));
    expect(state).not.toBeNull();
    expect(state?.version).toBe(SCHEMA_VERSION);
    expect(state?.messages).toHaveLength(3);
    expect(state?.rooms).toHaveLength(1);
  });

  it("gives every migrated message an idempotency key and a delivery state", () => {
    const state = parseSavedState(JSON.stringify(legacyV1));
    for (const message of state?.messages ?? []) {
      expect(message.clientId).toBeTruthy();
      expect(message.delivery).toBe("delivered");
    }
  });

  it("converts the legacy inviteCode into a structured invite", () => {
    const state = parseSavedState(JSON.stringify(legacyV1));
    expect(state?.rooms[0]?.invite).toMatchObject({
      code: "ABC123",
      expiresAt: null,
      maxUses: null,
    });
  });

  it("rebuilds read markers from the old unread counters", () => {
    const state = parseSavedState(JSON.stringify(legacyV1));
    const marker = state?.readState["r1"]?.["u1"];
    // One message was unread, so the marker sits on the second-newest.
    expect(marker?.lastReadMessageId).toBe("m2");
  });

  it("accepts a v2 snapshot and backfills newly added collections", () => {
    const v2 = {
      version: SCHEMA_VERSION,
      rooms: [],
      messages: [],
      aiMessages: [],
      currentUserId: "u1",
      activeRoomId: "r1",
    };
    const state = parseSavedState(JSON.stringify(v2));
    expect(state?.drafts).toEqual({});
    expect(state?.saved).toEqual({});
    expect(state?.followedThreads).toEqual({});
    expect(state?.notifications).toEqual([]);
  });
});

describe("draftKey", () => {
  it("scopes drafts per user, room and thread", () => {
    expect(draftKey("u1", "r1")).toBe("u1:r1");
    expect(draftKey("u1", "r1", "m9")).toBe("u1:r1:m9");
    expect(draftKey("u2", "r1")).not.toBe(draftKey("u1", "r1"));
  });
});
