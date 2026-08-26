/**
 * Store behaviour tests.
 *
 * These drive the real provider through its public hook rather than poking at
 * internals, so they cover the mechanics the UI actually depends on: edits and
 * tombstones, threads, read state, drafts, delivery/outbox and invite rules.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { ChatProvider, useChat } from "./chat-store";

function wrapper({ children }: { children: ReactNode }) {
  return <ChatProvider>{children}</ChatProvider>;
}

function setup() {
  return renderHook(() => useChat(), { wrapper });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("sending", () => {
  it("appends a message and drives it to delivered", async () => {
    const { result } = setup();
    const before = result.current.channelMessages.length;

    act(() => result.current.sendMessage("r1", "hello world"));
    expect(result.current.channelMessages).toHaveLength(before + 1);

    const sent = result.current.channelMessages.at(-1)!;
    expect(sent.content).toBe("hello world");
    expect(sent.clientId).toBeTruthy();

    await waitFor(() => {
      const current = result.current.messages.find((m) => m.id === sent.id);
      expect(["sent", "delivered"]).toContain(current?.delivery);
    });
  });

  it("ignores an empty message", () => {
    const { result } = setup();
    const before = result.current.channelMessages.length;
    act(() => result.current.sendMessage("r1", "   "));
    expect(result.current.channelMessages).toHaveLength(before);
  });

  it("queues sends while offline and keeps them in the outbox", async () => {
    const { result } = setup();
    act(() => result.current.setOnline(false));
    act(() => result.current.sendMessage("r1", "queued while offline"));

    // The send has to actually round-trip and be rejected before it lands in
    // the retry queue, so wait for the terminal state rather than the first.
    await waitFor(() => {
      const queued = result.current.messages.find((m) => m.content === "queued while offline");
      expect(queued?.delivery).toBe("failed");
    });
    expect(result.current.outbox.some((m) => m.content === "queued while offline")).toBe(true);
  });

  it("parses mentions when sending", () => {
    const { result } = setup();
    act(() => result.current.sendMessage("r1", "ping <@u2> and <!engineering>"));
    const sent = result.current.channelMessages.at(-1)!;
    expect(sent.mentions?.users).toEqual(["u2"]);
    expect(sent.mentions?.groups).toEqual(["engineering"]);
  });

  it("attaches link previews", () => {
    const { result } = setup();
    act(() => result.current.sendMessage("r1", "docs at https://example.com/guide"));
    expect(result.current.channelMessages.at(-1)?.linkPreviews).toHaveLength(1);
  });
});

describe("editing and deleting", () => {
  it("marks an edit and reparses mentions", () => {
    const { result } = setup();
    act(() => result.current.sendMessage("r1", "first"));
    const id = result.current.channelMessages.at(-1)!.id;

    act(() => result.current.editMessage(id, "second <@u2>"));
    const edited = result.current.messageById(id)!;
    expect(edited.content).toBe("second <@u2>");
    expect(edited.editedAt).toBeTypeOf("number");
    expect(edited.mentions?.users).toEqual(["u2"]);
  });

  it("refuses to edit someone else's message", () => {
    const { result } = setup();
    // u2 authored this seeded message; the viewer is u1.
    const foreign = result.current.messages.find((m) => m.senderId === "u2")!;
    act(() => result.current.editMessage(foreign.id, "hijacked"));
    expect(result.current.messageById(foreign.id)?.content).not.toBe("hijacked");
  });

  it("tombstones rather than removing, so replies stay valid", () => {
    const { result } = setup();
    act(() => result.current.sendMessage("r1", "delete me"));
    const id = result.current.channelMessages.at(-1)!.id;

    act(() => result.current.deleteMessage(id));
    const deleted = result.current.messageById(id);
    expect(deleted).toBeDefined();
    expect(deleted?.deletedAt).toBeTypeOf("number");
    expect(deleted?.content).toBe("");
    expect(deleted?.deletedBy).toBe("u1");
  });

  it("lets a room admin delete another member's message", () => {
    const { result } = setup();
    // u1 is an admin of r1.
    const foreign = result.current.messages.find(
      (m) => m.roomId === "r1" && m.senderId === "u2" && !m.threadRootId,
    )!;
    act(() => result.current.deleteMessage(foreign.id));
    expect(result.current.messageById(foreign.id)?.deletedAt).toBeTypeOf("number");
  });

  it("does not react to a deleted message", () => {
    const { result } = setup();
    act(() => result.current.sendMessage("r1", "gone"));
    const id = result.current.channelMessages.at(-1)!.id;
    act(() => result.current.deleteMessage(id));
    act(() => result.current.toggleReaction(id, "👍"));
    expect(result.current.messageById(id)?.reactions).toEqual({});
  });
});

describe("reactions", () => {
  it("toggles on and off, removing the key when empty", () => {
    const { result } = setup();
    act(() => result.current.sendMessage("r1", "react to me"));
    const id = result.current.channelMessages.at(-1)!.id;

    act(() => result.current.toggleReaction(id, "🎉"));
    expect(result.current.messageById(id)?.reactions?.["🎉"]).toEqual(["u1"]);

    act(() => result.current.toggleReaction(id, "🎉"));
    expect(result.current.messageById(id)?.reactions?.["🎉"]).toBeUndefined();
  });
});

describe("threads", () => {
  it("keeps replies out of the channel and counts them", () => {
    const { result } = setup();
    const root = result.current.channelMessages.at(-1)!;
    const channelBefore = result.current.channelMessages.length;

    act(() => result.current.sendMessage("r1", "a reply", { threadRootId: root.id }));

    expect(result.current.channelMessages).toHaveLength(channelBefore);
    expect(result.current.threadCount(root.id)).toBe(1);
    expect(result.current.threadReplies(root.id)[0]?.content).toBe("a reply");
  });

  it("tracks follow state", () => {
    const { result } = setup();
    const root = result.current.channelMessages.at(-1)!;
    expect(result.current.isFollowingThread(root.id)).toBe(false);
    act(() => result.current.toggleFollowThread(root.id));
    expect(result.current.isFollowingThread(root.id)).toBe(true);
  });

  it("lists thread participants including the root author", () => {
    const { result } = setup();
    const participants = result.current.threadParticipants("r1-u4-90");
    expect(participants.map((user) => user.id)).toContain("u4");
  });
});

describe("read state", () => {
  it("clears unread when the room is marked read", () => {
    const { result } = setup();
    act(() => result.current.markRoomRead("r1"));
    expect(result.current.unreadFor("r1").total).toBe(0);

    act(() => result.current.setCurrentUserId("u2"));
    act(() => result.current.setActiveRoom("r1"));
    act(() => result.current.sendMessage("r1", "from priya"));
    act(() => result.current.setCurrentUserId("u1"));

    expect(result.current.unreadFor("r1").total).toBeGreaterThan(0);
  });

  it("counts mentions separately from plain unread", () => {
    const { result } = setup();
    act(() => result.current.markRoomRead("r1"));
    act(() => result.current.setCurrentUserId("u2"));
    act(() => result.current.sendMessage("r1", "hey <@u1> look"));
    act(() => result.current.setCurrentUserId("u1"));

    const unread = result.current.unreadFor("r1");
    expect(unread.mentions).toBe(1);
    expect(unread.total).toBeGreaterThanOrEqual(1);
  });

  it("does not count your own messages as unread", () => {
    const { result } = setup();
    act(() => result.current.markRoomRead("r1"));
    act(() => result.current.sendMessage("r1", "mine"));
    expect(result.current.unreadFor("r1").total).toBe(0);
  });
});

describe("drafts", () => {
  it("persists per room and per thread", () => {
    const { result } = setup();
    act(() => result.current.saveDraft("r1", { text: "unsent channel" }));
    act(() => result.current.saveDraft("r1", { text: "unsent thread" }, "m9"));

    expect(result.current.getDraft("r1")?.text).toBe("unsent channel");
    expect(result.current.getDraft("r1", "m9")?.text).toBe("unsent thread");
    expect(result.current.getDraft("r2")).toBeUndefined();
  });

  it("clears a draft when the text is emptied", () => {
    const { result } = setup();
    act(() => result.current.saveDraft("r1", { text: "typing" }));
    act(() => result.current.saveDraft("r1", { text: "   " }));
    expect(result.current.getDraft("r1")).toBeUndefined();
  });

  it("scopes drafts to the viewing user", () => {
    const { result } = setup();
    act(() => result.current.saveDraft("r1", { text: "rahul's draft" }));
    act(() => result.current.setCurrentUserId("u2"));
    expect(result.current.getDraft("r1")).toBeUndefined();
  });
});

describe("pins, saves and forwards", () => {
  it("pins and unpins", () => {
    const { result } = setup();
    const target = result.current.channelMessages.at(-1)!;
    act(() => result.current.togglePin(target.id));
    expect(result.current.pinnedMessages("r1").some((m) => m.id === target.id)).toBe(true);
    act(() => result.current.togglePin(target.id));
    expect(result.current.pinnedMessages("r1").some((m) => m.id === target.id)).toBe(false);
  });

  it("saves per user", () => {
    const { result } = setup();
    const target = result.current.channelMessages.at(-1)!;
    act(() => result.current.toggleSave(target.id));
    expect(result.current.isSaved(target.id)).toBe(true);

    act(() => result.current.setCurrentUserId("u2"));
    expect(result.current.isSaved(target.id)).toBe(false);
  });

  it("forwards into other rooms with attribution", () => {
    const { result } = setup();
    const target = result.current.channelMessages.find((m) => m.content.length > 0)!;
    act(() => result.current.forwardMessage(target.id, ["r2"]));

    const forwarded = result.current.messages.filter((m) => m.roomId === "r2").at(-1)!;
    expect(forwarded.content).toBe(target.content);
    expect(forwarded.forwardedFrom?.senderId).toBe(target.senderId);
  });

  it("builds a permalink that carries room and message", () => {
    const { result } = setup();
    const target = result.current.channelMessages.at(-1)!;
    const link = result.current.permalinkFor(target);
    expect(link).toContain(`room=${target.roomId}`);
    expect(link).toContain(`msg=${target.id}`);
  });
});

describe("scheduled messages", () => {
  it("queues without publishing to the channel", () => {
    const { result } = setup();
    const before = result.current.channelMessages.length;
    act(() => result.current.scheduleMessage("r1", "later", Date.now() + 600_000));

    expect(result.current.channelMessages).toHaveLength(before);
    expect(result.current.scheduledMessages("r1")).toHaveLength(1);
  });

  it("cancels a queued message", () => {
    const { result } = setup();
    act(() => result.current.scheduleMessage("r1", "nope", Date.now() + 600_000));
    const queued = result.current.scheduledMessages("r1")[0]!;
    act(() => result.current.cancelScheduled(queued.id));
    expect(result.current.scheduledMessages("r1")).toHaveLength(0);
  });

  it("publishes when sent immediately", async () => {
    const { result } = setup();
    act(() => result.current.scheduleMessage("r1", "send now", Date.now() + 600_000));
    const queued = result.current.scheduledMessages("r1")[0]!;

    act(() => result.current.sendScheduledNow(queued.id));
    await waitFor(() => {
      expect(result.current.channelMessages.some((m) => m.content === "send now")).toBe(true);
    });
    expect(result.current.scheduledMessages("r1")).toHaveLength(0);
  });
});

describe("room management", () => {
  it("renames and sets a topic, recording a system message", () => {
    const { result } = setup();
    act(() => result.current.renameRoom("r1", "Product Strategy v2"));
    expect(result.current.rooms.find((r) => r.id === "r1")?.name).toBe("Product Strategy v2");

    act(() => result.current.setRoomTopic("r1", "Shipping Friday"));
    expect(result.current.rooms.find((r) => r.id === "r1")?.topic).toBe("Shipping Friday");
    expect(
      result.current.messages.some((m) => m.system && m.content.includes("Shipping Friday")),
    ).toBe(true);
  });

  it("lets a member update the group photo and notifies the room", () => {
    const { result } = setup();
    const photo = { dataUrl: "data:image/webp;base64,demo", zoom: 1, x: 50, y: 50 };

    act(() => {
      expect(result.current.updateGroupPhoto("r1", photo)).toBe(true);
    });

    expect(result.current.rooms.find((room) => room.id === "r1")?.photo).toEqual(photo);
    expect(
      result.current.messages.some(
        (message) =>
          message.roomId === "r1" && message.system && /group photo/i.test(message.content),
      ),
    ).toBe(true);
    expect(
      result.current.notifications.some((notification) => /group photo/i.test(notification.text)),
    ).toBe(true);
  });

  it("archives a room out of the visible list and back", () => {
    const { result } = setup();
    act(() => result.current.setArchived("r2", true));
    expect(result.current.visibleRooms.some((r) => r.id === "r2")).toBe(false);
    expect(result.current.archivedRooms.some((r) => r.id === "r2")).toBe(true);

    act(() => result.current.setArchived("r2", false));
    expect(result.current.visibleRooms.some((r) => r.id === "r2")).toBe(true);
  });

  it("blocks sending in an archived room", () => {
    const { result } = setup();
    act(() => result.current.setArchived("r2", true));
    const room = result.current.rooms.find((r) => r.id === "r2")!;
    expect(result.current.canSend(room, "u1")).toEqual({ allowed: false, reason: "archived" });
  });

  it("adds and removes members", () => {
    const { result } = setup();
    act(() => result.current.addMembers("r3", ["u2"]));
    expect(result.current.rooms.find((r) => r.id === "r3")?.participantIds).toContain("u2");

    act(() => result.current.removeMember("r3", "u2"));
    expect(result.current.rooms.find((r) => r.id === "r3")?.participantIds).not.toContain("u2");
  });

  it("never removes the last admin", () => {
    const { result } = setup();
    act(() => result.current.toggleAdmin("r3", "u1"));
    expect(result.current.rooms.find((r) => r.id === "r3")?.adminIds).toEqual(["u1"]);
  });

  it("refuses to let the only admin walk out of a populated room", () => {
    const { result } = setup();
    act(() => result.current.leaveRoom("r3"));
    expect(result.current.rooms.find((r) => r.id === "r3")?.participantIds).toContain("u1");
  });

  it("reuses an existing group DM rather than creating a duplicate", () => {
    const { result } = setup();
    let first = "";
    act(() => {
      first = result.current.createGroupDm(["u2", "u4"]);
    });
    let second = "";
    act(() => {
      second = result.current.createGroupDm(["u4", "u2"]);
    });
    expect(second).toBe(first);
  });

  it("mutes group messaging for non-admins only", () => {
    const { result } = setup();
    act(() => result.current.toggleGroupMute("r1"));
    const room = result.current.rooms.find((r) => r.id === "r1")!;
    expect(result.current.canSend(room, "u1").allowed).toBe(true);
    expect(result.current.canSend(room, "u2")).toEqual({ allowed: false, reason: "group" });
  });
});

describe("invites", () => {
  it("rejects an expired link", () => {
    const { result } = setup();
    // r3 is seeded with an invite that expired yesterday.
    let outcome: { error?: string } = {};
    act(() => {
      outcome = result.current.joinByCode("ALP447");
    });
    expect(outcome.error).toMatch(/expired/i);
  });

  it("joins with a valid link and increments its use count", () => {
    const { result } = setup();
    act(() => result.current.setCurrentUserId("u3"));

    const before = result.current.rooms.find((r) => r.id === "r2")!.invite!.uses;
    act(() => {
      result.current.joinByCode("SLS900");
    });

    const room = result.current.rooms.find((r) => r.id === "r2")!;
    expect(room.participantIds).toContain("u3");
    expect(room.invite!.uses).toBe(before + 1);
  });

  it("rejects an unknown code", () => {
    const { result } = setup();
    let outcome: { error?: string } = {};
    act(() => {
      outcome = result.current.joinByCode("NOPE00");
    });
    expect(outcome.error).toBeTruthy();
  });

  it("revokes a link so it can no longer be redeemed", () => {
    const { result } = setup();
    act(() => result.current.revokeInvite("r2"));
    expect(result.current.roomByCode("SLS900")).toBeNull();
  });

  it("issues codes long enough to resist enumeration", () => {
    const { result } = setup();
    act(() => result.current.createInvite("r2", { expiresInMs: 3600_000, maxUses: 5 }));
    const invite = result.current.rooms.find((r) => r.id === "r2")!.invite!;
    expect(invite.code.length).toBeGreaterThanOrEqual(10);
    expect(invite.uses).toBe(0);
  });
});

describe("search", () => {
  it("matches on rendered text, not the mention encoding", () => {
    const { result } = setup();
    act(() => result.current.sendMessage("r1", "ping <@u2> about the deck"));
    const hits = result.current.searchMessages("Priya");
    expect(hits.some((m) => m.content.includes("about the deck"))).toBe(true);
  });

  it("excludes deleted messages", () => {
    const { result } = setup();
    act(() => result.current.sendMessage("r1", "findmeplease"));
    const id = result.current.channelMessages.at(-1)!.id;
    expect(result.current.searchMessages("findmeplease")).toHaveLength(1);

    act(() => result.current.deleteMessage(id));
    expect(result.current.searchMessages("findmeplease")).toHaveLength(0);
  });

  it("returns nothing for an empty query", () => {
    const { result } = setup();
    expect(result.current.searchMessages("   ")).toEqual([]);
  });
});

describe("pagination", () => {
  it("windows history and grows on demand", () => {
    const { result } = setup();
    act(() => {
      for (let i = 0; i < 60; i += 1) result.current.sendMessage("r1", `bulk ${i}`);
    });

    expect(result.current.hasMoreHistory).toBe(true);
    const windowed = result.current.channelMessages.length;
    act(() => result.current.loadOlder());
    expect(result.current.channelMessages.length).toBeGreaterThan(windowed);
  });
});

describe("persistence", () => {
  it("writes a snapshot that can be read back", async () => {
    const { result } = setup();
    act(() => result.current.sendMessage("r1", "persist me"));

    await waitFor(() => {
      const raw = window.localStorage.getItem("nexus-chat-demo-v1");
      expect(raw).toBeTruthy();
      expect(raw).toContain("persist me");
    });
  });
});
