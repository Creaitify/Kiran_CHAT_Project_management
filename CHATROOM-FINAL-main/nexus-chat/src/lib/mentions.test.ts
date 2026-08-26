import { describe, expect, it } from "vitest";
import {
  activeMentionQuery,
  mentionCandidates,
  mentionsUser,
  parseMentions,
  resolveMentionTargets,
  toPlainText,
} from "./mentions";
import type { User, UserGroup } from "./chat-types";

const users: User[] = [
  { id: "u1", name: "Rahul Sharma", role: "Lead", online: true, color: "#fff", timeZone: "UTC" },
  { id: "u2", name: "Priya Kapoor", role: "FE", online: true, color: "#fff", timeZone: "UTC" },
  { id: "u3", name: "Akash Mehta", role: "BE", online: false, color: "#fff", timeZone: "UTC" },
];

const groups: UserGroup[] = [
  { id: "g1", handle: "engineering", name: "Engineering", memberIds: ["u2", "u3"] },
];

const room = { participantIds: ["u1", "u2", "u3"] };

describe("parseMentions", () => {
  it("extracts users, groups and broadcasts", () => {
    const result = parseMentions("<@u2> and <!engineering> plus <!here>", groups);
    expect(result.users).toEqual(["u2"]);
    expect(result.groups).toEqual(["engineering"]);
    expect(result.broadcast).toBe("here");
  });

  it("ignores unknown group handles", () => {
    expect(parseMentions("<!nope>", groups).groups).toEqual([]);
  });

  it("lets @channel outrank @here", () => {
    expect(parseMentions("<!here> <!channel>", groups).broadcast).toBe("channel");
  });

  it("deduplicates repeated mentions of the same user", () => {
    expect(parseMentions("<@u2> <@u2>", groups).users).toEqual(["u2"]);
  });
});

describe("resolveMentionTargets", () => {
  it("expands a group to its members", () => {
    const mentions = parseMentions("<!engineering>", groups);
    expect(resolveMentionTargets(mentions, room, users, groups).sort()).toEqual(["u2", "u3"]);
  });

  it("limits @here to online members but @channel to everyone", () => {
    const here = parseMentions("<!here>", groups);
    const channel = parseMentions("<!channel>", groups);
    expect(resolveMentionTargets(here, room, users, groups).sort()).toEqual(["u1", "u2"]);
    expect(resolveMentionTargets(channel, room, users, groups).sort()).toEqual(["u1", "u2", "u3"]);
  });

  it("drops mentions of people who are not in the room", () => {
    const mentions = parseMentions("<@u3>", groups);
    expect(
      resolveMentionTargets(mentions, { participantIds: ["u1", "u2"] }, users, groups),
    ).toEqual([]);
  });

  it("reports whether a specific user is mentioned", () => {
    const mentions = parseMentions("<!engineering>", groups);
    expect(mentionsUser(mentions, "u3", room, users, groups)).toBe(true);
    expect(mentionsUser(mentions, "u1", room, users, groups)).toBe(false);
  });
});

describe("toPlainText", () => {
  it("renders tokens as readable names", () => {
    expect(toPlainText("hi <@u2> and <!engineering>", users, groups)).toBe(
      "hi @Priya Kapoor and @engineering",
    );
  });

  it("survives a mention of a deleted user", () => {
    expect(toPlainText("<@u9>", users, groups)).toBe("@unknown");
  });
});

describe("activeMentionQuery", () => {
  it("finds the fragment under the caret", () => {
    const text = "hello @pri";
    expect(activeMentionQuery(text, text.length)).toEqual({ query: "pri", start: 6 });
  });

  it("returns null when the caret is not in a mention", () => {
    expect(activeMentionQuery("hello there", 11)).toBeNull();
    expect(activeMentionQuery("email a@b.com", 13)).toBeNull();
  });
});

describe("mentionCandidates", () => {
  it("suggests room members, groups and broadcasts", () => {
    const result = mentionCandidates("", users, groups, "u1", ["u1", "u2", "u3"]);
    const kinds = new Set(result.map((candidate) => candidate.kind));
    expect(kinds).toContain("user");
    expect(kinds).toContain("group");
    expect(kinds).toContain("broadcast");
    expect(result.some((candidate) => candidate.key === "u1")).toBe(false);
  });

  it("excludes people who are not in the room", () => {
    const result = mentionCandidates("", users, groups, "u1", ["u1", "u2"]);
    expect(result.some((candidate) => candidate.key === "u3")).toBe(false);
  });

  it("filters by the query", () => {
    const result = mentionCandidates("priya", users, groups, "u1", ["u1", "u2", "u3"]);
    expect(result.map((candidate) => candidate.label)).toEqual(["Priya Kapoor"]);
  });
});
