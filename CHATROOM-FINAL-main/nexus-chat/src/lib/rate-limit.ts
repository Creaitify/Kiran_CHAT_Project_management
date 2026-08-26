/**
 * Server-side rate limiting and token budgets for the AI route.
 *
 * Scope, stated plainly: this is an in-memory limiter. It is correct for a
 * single instance and is the right shape for the interface, but it does not
 * survive a restart and does not coordinate across instances — on Cloudflare
 * Workers each isolate gets its own copy. Moving to Durable Objects, Redis or
 * `@upstash/ratelimit` means replacing the store below, not the call sites.
 *
 * Without this, an unauthenticated POST loop against /api/agent bills the
 * deployment's Anthropic key until the account is drained.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Requests left in the current window. */
  remaining: number;
  /** Epoch ms when the window resets. */
  resetAt: number;
  retryAfterSeconds: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface RateLimitOptions {
  /** Sustained requests allowed per window. */
  limit: number;
  windowMs: number;
}

const buckets = new Map<string, Bucket>();
/** Bounds memory growth from unique keys on a long-lived isolate. */
const MAX_TRACKED_KEYS = 10_000;

function sweep(now: number, windowMs: number) {
  if (buckets.size <= MAX_TRACKED_KEYS) return;
  for (const [key, bucket] of buckets) {
    if (now - bucket.updatedAt > windowMs * 2) buckets.delete(key);
  }
  // Still oversized after sweeping stale entries: drop oldest-first.
  if (buckets.size > MAX_TRACKED_KEYS) {
    const sorted = [...buckets.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    for (const [key] of sorted.slice(0, buckets.size - MAX_TRACKED_KEYS)) buckets.delete(key);
  }
}

/** Token bucket: smooth refill, tolerates short bursts, cheap to evaluate. */
export function consume(
  key: string,
  { limit, windowMs }: RateLimitOptions,
  cost = 1,
  now = Date.now(),
): RateLimitResult {
  sweep(now, windowMs);
  const refillPerMs = limit / windowMs;
  const existing = buckets.get(key);
  const bucket: Bucket = existing ?? { tokens: limit, updatedAt: now };

  if (existing) {
    const elapsed = Math.max(0, now - existing.updatedAt);
    bucket.tokens = Math.min(limit, existing.tokens + elapsed * refillPerMs);
    bucket.updatedAt = now;
  }

  if (bucket.tokens < cost) {
    const deficit = cost - bucket.tokens;
    const waitMs = Math.ceil(deficit / refillPerMs);
    buckets.set(key, bucket);
    return {
      allowed: false,
      remaining: 0,
      resetAt: now + waitMs,
      retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)),
    };
  }

  bucket.tokens -= cost;
  buckets.set(key, bucket);
  const missing = limit - bucket.tokens;
  return {
    allowed: true,
    remaining: Math.floor(bucket.tokens),
    resetAt: now + Math.ceil(missing / refillPerMs),
    retryAfterSeconds: 0,
  };
}

/**
 * Best-effort client identity. Without auth this is spoofable via a forged
 * `x-forwarded-for`, and it is only a speed bump — the real fix is to key the
 * limiter on an authenticated user id once sessions exist.
 */
export function clientKey(request: Request, suffix = ""): string {
  const headers = request.headers;
  const ip =
    headers.get("cf-connecting-ip") ??
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  return `${ip}${suffix ? `:${suffix}` : ""}`;
}

export function rateLimitHeaders(result: RateLimitResult, limit: number): Record<string, string> {
  const headers: Record<string, string> = {
    "RateLimit-Limit": String(limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(Math.ceil((result.resetAt - Date.now()) / 1000)),
  };
  if (!result.allowed) headers["Retry-After"] = String(result.retryAfterSeconds);
  return headers;
}

/* -------------------------------------------------------------------------- */
/* Token budgets                                                              */
/* -------------------------------------------------------------------------- */

export interface BudgetState {
  used: number;
  limit: number;
  resetAt: number;
}

const budgets = new Map<string, BudgetState>();

/** Rolling per-identity token allowance, independent of request count. */
export function checkBudget(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): BudgetState {
  const existing = budgets.get(key);
  if (!existing || now >= existing.resetAt) {
    const fresh: BudgetState = { used: 0, limit, resetAt: now + windowMs };
    budgets.set(key, fresh);
    return fresh;
  }
  return existing;
}

export function recordUsage(key: string, tokens: number, now = Date.now()): BudgetState {
  const state = budgets.get(key);
  if (!state) return { used: tokens, limit: 0, resetAt: now };
  state.used += tokens;
  return state;
}

/** Rough char-per-token heuristic — enough to enforce a ceiling, not billing-grade. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}

/** Test seam: clears all limiter and budget state. */
export function __resetRateLimitState() {
  buckets.clear();
  budgets.clear();
}
