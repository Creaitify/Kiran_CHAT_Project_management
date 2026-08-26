import { describe, expect, it } from "vitest";
import { derivePreview, derivePreviews, extractUrls, isSafeHref } from "./link-preview";
import { commandSuggestions, findCommand, parseSlash } from "./slash-commands";
import { formatMessage } from "./i18n";
import { dayKey, formatDayLabel, formatRelative, formatTime } from "./time";
import { isTombstoned, previewText, type SharedMessage } from "./chat-types";
import { inviteIsUsable } from "./invite-rules";

describe("link previews", () => {
  it("extracts http(s) URLs and strips trailing punctuation", () => {
    expect(extractUrls("see https://example.com/docs. thanks")).toEqual([
      "https://example.com/docs",
    ]);
  });

  it("deduplicates and caps the number of previews", () => {
    const text = "a https://a.com b https://a.com c https://b.com d https://c.com e https://d.com";
    expect(derivePreviews(text)).toHaveLength(3);
  });

  it("rejects dangerous schemes", () => {
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref("data:text/html;base64,x")).toBe(false);
    expect(isSafeHref("https://ok.example")).toBe(true);
    expect(derivePreview("javascript:alert(1)")).toBeNull();
  });

  it("derives a readable title from the path", () => {
    const preview = derivePreview("https://nexus.example.com/releases/q3-launch-plan");
    expect(preview?.siteName).toBe("nexus.example.com");
    expect(preview?.title).toBe("Q3 Launch Plan");
  });
});

describe("slash commands", () => {
  it("parses a command and its arguments", () => {
    expect(parseSlash("/topic Q3 planning")).toEqual({ name: "topic", args: "Q3 planning" });
    expect(parseSlash("/shrug")).toEqual({ name: "shrug", args: "" });
    expect(parseSlash("not a command")).toBeNull();
    expect(parseSlash("/123")).toBeNull();
  });

  it("resolves aliases", () => {
    expect(findCommand("ai")?.name).toBe("agent");
    expect(findCommand("catchup")?.name).toBe("summarize");
    expect(findCommand("nope")).toBeUndefined();
  });

  it("hides group-only commands in direct messages", () => {
    // Query by prefix: the bare "/" list is capped for the popover.
    expect(commandSuggestions("/arch", false)).toEqual([]);
    expect(commandSuggestions("/arch", true).map((c) => c.name)).toEqual(["archive"]);
  });

  it("filters suggestions by prefix", () => {
    expect(commandSuggestions("/sum", true).map((c) => c.name)).toEqual(["summarize"]);
  });
});

describe("i18n formatting", () => {
  it("interpolates values", () => {
    expect(formatMessage("Hi {name}", { name: "Priya" })).toBe("Hi Priya");
  });

  it("selects plural branches", () => {
    const template = "{count, plural, one {# reply} other {# replies}}";
    expect(formatMessage(template, { count: 1 })).toBe("1 reply");
    expect(formatMessage(template, { count: 4 })).toBe("4 replies");
    expect(formatMessage(template, { count: 0 })).toBe("0 replies");
  });

  it("handles a plural block surrounded by other text", () => {
    expect(
      formatMessage("You have {count, plural, one {# item} other {# items}} left", { count: 2 }),
    ).toBe("You have 2 items left");
  });

  it("leaves unknown placeholders untouched", () => {
    expect(formatMessage("Hi {missing}")).toBe("Hi {missing}");
  });
});

describe("time formatting", () => {
  const ts = Date.UTC(2026, 0, 15, 18, 30);

  it("formats in an explicit zone rather than the host default", () => {
    expect(formatTime(ts, { timeZone: "UTC" })).not.toBe(
      formatTime(ts, { timeZone: "Asia/Kolkata" }),
    );
  });

  it("buckets days in the target zone", () => {
    expect(dayKey(ts, "UTC")).toBe("2026-01-15");
    // 18:30 UTC is already the next day in Auckland.
    expect(dayKey(ts, "Pacific/Auckland")).toBe("2026-01-16");
  });

  it("labels today and yesterday", () => {
    const now = Date.UTC(2026, 0, 15, 20, 0);
    expect(formatDayLabel(ts, { timeZone: "UTC" }, now)).toBe("Today");
    expect(formatDayLabel(ts - 86_400_000, { timeZone: "UTC" }, now)).toBe("Yesterday");
  });

  it("produces relative labels", () => {
    const now = Date.now();
    expect(formatRelative(now - 5_000, {}, now)).toBe("just now");
    expect(formatRelative(now - 3 * 3_600_000, {}, now)).toContain("hour");
  });
});

describe("message helpers", () => {
  const base: SharedMessage = {
    id: "m1",
    clientId: "c1",
    roomId: "r1",
    senderId: "u1",
    content: "hello",
    timestamp: 1,
    delivery: "delivered",
  };

  it("detects tombstones", () => {
    expect(isTombstoned(base)).toBe(false);
    expect(isTombstoned({ ...base, deletedAt: 5 })).toBe(true);
  });

  it("previews deleted messages and attachments", () => {
    expect(previewText({ ...base, deletedAt: 5, content: "" })).toBe("This message was deleted");
    expect(
      previewText({
        ...base,
        content: "",
        attachment: { name: "spec.pdf", type: "application/pdf", size: 10, dataUrl: "d" },
      }),
    ).toContain("spec.pdf");
  });
});

describe("invite rules", () => {
  const now = 1_000_000;

  it("accepts a live invite", () => {
    expect(
      inviteIsUsable({ code: "x", createdAt: 0, expiresAt: now + 1000, maxUses: 5, uses: 1 }, now),
    ).toBe("active");
  });

  it("rejects an expired invite", () => {
    expect(
      inviteIsUsable({ code: "x", createdAt: 0, expiresAt: now - 1, maxUses: null, uses: 0 }, now),
    ).toBe("expired");
  });

  it("rejects an exhausted invite", () => {
    expect(
      inviteIsUsable({ code: "x", createdAt: 0, expiresAt: null, maxUses: 3, uses: 3 }, now),
    ).toBe("exhausted");
  });

  it("treats null limits as unlimited", () => {
    expect(
      inviteIsUsable({ code: "x", createdAt: 0, expiresAt: null, maxUses: null, uses: 999 }, now),
    ).toBe("active");
  });

  it("reports a missing invite", () => {
    expect(inviteIsUsable(null, now)).toBe("none");
  });
});
