import { describe, expect, it } from "vitest";
import { compareMessages, pageBefore, windowIncluding } from "./paginate";
import { decodeCursor, encodeCursor, type SharedMessage } from "./chat-types";

function make(id: string, timestamp: number): SharedMessage {
  return {
    id,
    clientId: `c-${id}`,
    roomId: "r1",
    senderId: "u1",
    content: id,
    timestamp,
    delivery: "delivered",
  };
}

const log = Array.from({ length: 10 }, (_, index) => make(`m${index}`, 1000 + index));

describe("cursors", () => {
  it("round-trips", () => {
    const cursor = encodeCursor({ timestamp: 1700, id: "abc" });
    expect(decodeCursor(cursor)).toEqual({ timestamp: 1700, id: "abc" });
  });

  it("rejects malformed input", () => {
    expect(decodeCursor("nonsense")).toBeNull();
    expect(decodeCursor("abc:def")).toBeNull();
  });

  it("survives an id that itself contains a colon", () => {
    const cursor = encodeCursor({ timestamp: 5, id: "a:b:c" });
    expect(decodeCursor(cursor)).toEqual({ timestamp: 5, id: "a:b:c" });
  });
});

describe("pageBefore", () => {
  it("returns the newest page first, oldest-last within the page", () => {
    const page = pageBefore(log, null, 4);
    expect(page.items.map((m) => m.id)).toEqual(["m6", "m7", "m8", "m9"]);
    expect(page.hasMore).toBe(true);
  });

  it("walks backwards without gaps or repeats", () => {
    const seen: string[] = [];
    let cursor = null as string | null;
    for (let i = 0; i < 5; i += 1) {
      const page = pageBefore(log, cursor, 3);
      seen.unshift(...page.items.map((m) => m.id));
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    }
    expect(seen).toEqual(log.map((m) => m.id));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("reports the end of history", () => {
    const page = pageBefore(log, null, 50);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it("is stable when a newer message arrives mid-pagination", () => {
    const first = pageBefore(log, null, 4);
    const withNewer = [...log, make("m10", 2000)];
    const second = pageBefore(withNewer, first.nextCursor, 4);
    // The new message is newer than the cursor, so it must not appear in an
    // older page — this is the guarantee offset pagination cannot give.
    expect(second.items.map((m) => m.id)).toEqual(["m2", "m3", "m4", "m5"]);
  });

  it("breaks timestamp ties by id so ordering is total", () => {
    const tied = [make("b", 500), make("a", 500)];
    expect([...tied].sort(compareMessages).map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("windowIncluding", () => {
  it("expands far enough back to contain the target", () => {
    const window = windowIncluding(log, "m1", 2);
    expect(window.some((message) => message.id === "m1")).toBe(true);
  });

  it("falls back to the tail for an unknown id", () => {
    const window = windowIncluding(log, "missing", 3);
    expect(window.map((m) => m.id)).toEqual(["m7", "m8", "m9"]);
  });
});
