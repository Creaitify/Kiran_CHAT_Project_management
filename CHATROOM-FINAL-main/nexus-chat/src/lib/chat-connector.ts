/**
 * The chat data connector.
 *
 * Chat has never had a backend — every room, message and user is a fixture in
 * `chat-seed.ts`, held in React state and mirrored to localStorage. That is
 * fine for a demo and useless for a product, so this file introduces the seam
 * the real backend will arrive through.
 *
 * The store no longer knows where its state lives. It asks a `ChatConnector`
 * to load, save and notify, and one of two implementations answers:
 *
 *   local  — localStorage. Byte-for-byte the behaviour that shipped before this
 *            file existed. Still the default, so nothing changes visually.
 *   api    — the KCMS Django API at `apps/api`. Chat rides the project app's
 *            existing auth, workspaces and roles rather than growing a second
 *            set of its own.
 *
 * Chosen at build time by `VITE_CHAT_CONNECTOR`. See CONNECTORS.md.
 *
 * ---------------------------------------------------------------------------
 * Scope note, so this is not mistaken for more than it is
 * ---------------------------------------------------------------------------
 * Stage 1 of the integration roadmap builds *only the seam*. The `api`
 * connector talks to endpoints that `apps/api` does not serve yet; it probes
 * for them, says so plainly once, and degrades to seed data rather than to a
 * broken screen. Stage 3 implements the server side and fills in the same
 * methods — without the store or any component changing.
 *
 * Which is the point of the interface being snapshot-shaped rather than
 * per-entity: it is the smallest contract that covers what the store does
 * today, so swapping implementations is a swap and not a rewrite.
 */

import { createApiConnector } from "./chat-connector-api";
import { createLocalConnector } from "./chat-connector-local";
import type { PersistedState } from "./chat-persistence";

export type ConnectorKind = "local" | "api";

export interface ConnectorStatus {
  kind: ConnectorKind;
  /** False when the backing store is unreachable or has no chat schema yet. */
  ready: boolean;
  /** One line, safe to show a developer. Never contains credentials. */
  detail: string;
}

export interface ChatConnector {
  readonly kind: ConnectorKind;

  /**
   * Durable state at boot, or `null` for "there is none — use the seed".
   *
   * `null` is a legitimate first-run answer, not an error. Errors are the
   * connector's own problem: it reports them through `status()` and returns
   * `null` so the app still opens.
   */
  load(): Promise<PersistedState | null>;

  /**
   * Persist. Resolves `false` when the write was dropped — storage quota,
   * offline, missing schema. The caller carries on either way; the app is
   * fully usable in memory and only durability is lost.
   */
  save(state: PersistedState): Promise<boolean>;

  /**
   * State changed somewhere else — another tab today, another user's session
   * once there is a server. Returns an unsubscribe function.
   */
  subscribe(onChange: (state: PersistedState) => void): () => void;

  /** Reachability probe. Drives the connector line in the diagnostics panel. */
  status(): Promise<ConnectorStatus>;
}

/**
 * Reads the build-time selection.
 *
 * Anything other than `api` means local, deliberately: a typo in an env var
 * should leave a working app rather than an empty one, and the `api` path is
 * the one that announces itself in the console.
 */
export function resolveConnectorKind(
  env: Record<string, string | boolean | undefined> = import.meta.env,
): ConnectorKind {
  const raw = env["VITE_CHAT_CONNECTOR"];
  return typeof raw === "string" && raw.trim().toLowerCase() === "api" ? "api" : "local";
}

/**
 * Builds the connector this build is configured for.
 *
 * Both implementations are imported eagerly and that is deliberate: the API
 * connector is a few hundred bytes of `fetch` plumbing, and a lazy import here
 * would make the store's boot path asynchronous for no measurable gain.
 */
export function createChatConnector(kind: ConnectorKind = resolveConnectorKind()): ChatConnector {
  return kind === "api" ? createApiConnector() : createLocalConnector();
}
