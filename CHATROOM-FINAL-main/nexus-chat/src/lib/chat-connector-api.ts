/**
 * The API connector — chat state living in the KCMS Django backend.
 *
 * Chat does not open its own Postgres connection. It talks to `apps/api`,
 * which already owns `DATABASE_URL`, authentication, workspaces and project
 * roles. Pointing that one `DATABASE_URL` at Neon moves chat's data with it;
 * there is no second connection string, and no second copy of the permission
 * rules to keep in step.
 *
 * ---------------------------------------------------------------------------
 * What is real here and what is not
 * ---------------------------------------------------------------------------
 * Real: the URL construction, credentials, timeouts, error classification and
 * the fallback behaviour. All of it is exercised by `chat-connector.test.ts`.
 *
 * Not real yet: the endpoints. `apps/api` serves no `/chat/` routes until
 * Stage 3 of the integration roadmap. Until it does, this connector detects
 * their absence, prints one line naming the missing endpoint, and reports
 * `ready: false` — at which point the store falls back to seed data and chat
 * still opens. A missing backend must never be a blank screen.
 *
 * Stage 3 note: `save()` is snapshot-shaped because that is what the store
 * does today, and matching it exactly is what makes this a seam rather than a
 * rewrite. A real server will not want the whole workspace PUT at it on every
 * keystroke, so Stage 3 is expected to widen this into incremental operations.
 * That is a cheap change — the store is the only caller.
 */

import type { ChatConnector, ConnectorStatus } from "./chat-connector";
import type { PersistedState } from "./chat-persistence";

/** Slow enough for a cold Django worker, short enough not to stall boot. */
const REQUEST_TIMEOUT_MS = 8_000;

export interface ApiConnectorOptions {
  /** Origin of `apps/api`. Empty string means same origin (behind the proxy). */
  baseUrl?: string;
  /** Workspace the chat data is scoped to. Stage 3 takes this from the shell. */
  workspaceSlug?: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

export function chatApiEndpoints(baseUrl: string, workspaceSlug: string) {
  const root = `${baseUrl.replace(/\/+$/, "")}/api/workspaces/${encodeURIComponent(workspaceSlug)}/chat`;
  return {
    snapshot: `${root}/snapshot/`,
    events: `${root}/events/`,
    health: `${root}/health/`,
  };
}

/** A 404 means "not built yet"; anything else means "built, but broken". */
class MissingEndpointError extends Error {
  constructor(readonly url: string) {
    super(`No chat API at ${url}`);
    this.name = "MissingEndpointError";
  }
}

export function createApiConnector(options: ApiConnectorOptions = {}): ChatConnector {
  const env = import.meta.env as Record<string, string | undefined>;
  const baseUrl = options.baseUrl ?? env["VITE_API_BASE_URL"] ?? "";
  const workspaceSlug = options.workspaceSlug ?? env["VITE_CHAT_WORKSPACE_SLUG"] ?? "";
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const endpoints = chatApiEndpoints(baseUrl, workspaceSlug);

  /** One warning per process, not one per render. */
  let warned = false;
  const warnOnce = (message: string) => {
    if (warned) return;
    warned = true;
    console.warn(`[chat] ${message}`);
  };

  async function request(url: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await doFetch(url, {
        ...init,
        signal: controller.signal,
        // KCMS authenticates with a session cookie. Without this the request is
        // anonymous and every workspace-scoped route answers 401.
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
      });
      if (response.status === 404) throw new MissingEndpointError(url);
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  function misconfigured(): ConnectorStatus | null {
    if (workspaceSlug) return null;
    return {
      kind: "api",
      ready: false,
      detail: "VITE_CHAT_WORKSPACE_SLUG is not set — cannot scope chat to a workspace",
    };
  }

  return {
    kind: "api",

    async load() {
      if (misconfigured()) {
        warnOnce("VITE_CHAT_CONNECTOR=api but VITE_CHAT_WORKSPACE_SLUG is empty; using seed data.");
        return null;
      }
      try {
        const response = await request(endpoints.snapshot);
        // 204 is a real answer: the workspace exists and has no chat history.
        if (response.status === 204) return null;
        if (!response.ok) {
          warnOnce(`Chat snapshot request failed (${response.status}); using seed data.`);
          return null;
        }
        return (await response.json()) as PersistedState;
      } catch (error) {
        if (error instanceof MissingEndpointError) {
          warnOnce(
            `${error.message} — the chat API lands in Stage 3. Running on seed data; nothing is being saved.`,
          );
        } else {
          warnOnce(`Chat snapshot request failed (${describe(error)}); using seed data.`);
        }
        return null;
      }
    },

    async save(state: PersistedState) {
      if (misconfigured()) return false;
      try {
        const response = await request(endpoints.snapshot, {
          method: "PUT",
          body: JSON.stringify(state),
        });
        return response.ok;
      } catch {
        // Losing durability is survivable and already handled upstream; losing
        // the session to an unhandled rejection is not.
        return false;
      }
    },

    subscribe(onChange) {
      if (misconfigured() || typeof EventSource === "undefined") return () => {};

      let source: EventSource | null = null;
      try {
        source = new EventSource(endpoints.events, { withCredentials: true });
      } catch {
        return () => {};
      }

      source.onmessage = (event) => {
        try {
          onChange(JSON.parse(event.data) as PersistedState);
        } catch {
          // A malformed frame is the server's bug. Drop it rather than tearing
          // down a stream that is otherwise delivering.
        }
      };
      source.onerror = () => {
        // No reconnect loop while the endpoint does not exist — that is just a
        // 404 every few seconds in everyone's network tab. Stage 3 adds backoff
        // when there is something to back off to.
        source?.close();
        warnOnce(
          `Chat event stream at ${endpoints.events} is unavailable; updates are local only.`,
        );
      };

      return () => source?.close();
    },

    async status(): Promise<ConnectorStatus> {
      const bad = misconfigured();
      if (bad) return bad;

      const target = `${baseUrl || "same origin"} / ${workspaceSlug}`;
      try {
        const response = await request(endpoints.health);
        if (!response.ok) {
          return { kind: "api", ready: false, detail: `${target} — HTTP ${response.status}` };
        }
        return { kind: "api", ready: true, detail: `KCMS API at ${target}` };
      } catch (error) {
        if (error instanceof MissingEndpointError) {
          return {
            kind: "api",
            ready: false,
            detail: `${target} — no chat endpoints yet (arrives in Stage 3)`,
          };
        }
        return { kind: "api", ready: false, detail: `${target} — ${describe(error)}` };
      }
    },
  };
}

function describe(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "timed out";
  return error instanceof Error ? error.message : "unknown error";
}
