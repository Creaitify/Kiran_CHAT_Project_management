import { beforeEach, describe, expect, it } from "vitest";
import {
  checkBudget,
  clientKey,
  consume,
  estimateTokens,
  rateLimitHeaders,
  recordUsage,
  __resetRateLimitState,
} from "./rate-limit";

beforeEach(() => __resetRateLimitState());

describe("consume", () => {
  const options = { limit: 3, windowMs: 60_000 };

  it("allows up to the limit then refuses", () => {
    const now = Date.now();
    expect(consume("a", options, 1, now).allowed).toBe(true);
    expect(consume("a", options, 1, now).allowed).toBe(true);
    expect(consume("a", options, 1, now).allowed).toBe(true);
    const blocked = consume("a", options, 1, now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keeps identities independent", () => {
    const now = Date.now();
    for (let i = 0; i < 3; i += 1) consume("a", options, 1, now);
    expect(consume("b", options, 1, now).allowed).toBe(true);
  });

  it("refills over time", () => {
    const now = Date.now();
    for (let i = 0; i < 3; i += 1) consume("a", options, 1, now);
    expect(consume("a", options, 1, now).allowed).toBe(false);
    // One full window later the bucket is full again.
    expect(consume("a", options, 1, now + 60_000).allowed).toBe(true);
  });

  it("reports remaining allowance", () => {
    const now = Date.now();
    expect(consume("a", options, 1, now).remaining).toBe(2);
  });
});

describe("rateLimitHeaders", () => {
  it("includes Retry-After only when blocked", () => {
    const now = Date.now();
    const ok = consume("h", { limit: 2, windowMs: 1000 }, 1, now);
    expect(rateLimitHeaders(ok, 2)["Retry-After"]).toBeUndefined();

    consume("h", { limit: 2, windowMs: 1000 }, 1, now);
    const blocked = consume("h", { limit: 2, windowMs: 1000 }, 1, now);
    expect(rateLimitHeaders(blocked, 2)["Retry-After"]).toBeDefined();
  });
});

describe("clientKey", () => {
  it("prefers the Cloudflare header, then falls back", () => {
    const cf = new Request("https://x.test", { headers: { "cf-connecting-ip": "1.2.3.4" } });
    expect(clientKey(cf, "agent")).toBe("1.2.3.4:agent");

    const xff = new Request("https://x.test", {
      headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" },
    });
    expect(clientKey(xff)).toBe("9.9.9.9");

    expect(clientKey(new Request("https://x.test"))).toBe("unknown");
  });
});

describe("token budget", () => {
  it("tracks usage within a window and resets after it", () => {
    const now = Date.now();
    checkBudget("u1", 1000, 60_000, now);
    recordUsage("u1", 400);
    expect(checkBudget("u1", 1000, 60_000, now).used).toBe(400);

    const afterReset = checkBudget("u1", 1000, 60_000, now + 60_001);
    expect(afterReset.used).toBe(0);
  });
});

describe("estimateTokens", () => {
  it("scales with length and never returns zero for real text", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("hello")).toBeGreaterThan(0);
    expect(estimateTokens("a".repeat(360))).toBeGreaterThan(estimateTokens("a".repeat(36)));
  });
});
