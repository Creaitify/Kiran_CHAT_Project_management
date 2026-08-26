/**
 * The local connector — localStorage, exactly as it always worked.
 *
 * This is a move, not a rewrite. `parseSavedState`, `writeSnapshot` and the
 * cross-tab `storage` listener are the same functions the store called inline
 * before the connector existed, so the demo behaves identically: same key,
 * same schema, same migration path, same quota-failure tolerance. Existing
 * snapshots in a user's browser keep loading.
 *
 * It stays the default. Nothing about attaching a real database is allowed to
 * require this path to change.
 */

import { parseSavedState, writeSnapshot, STORAGE_KEY } from "./chat-persistence";
import type { ChatConnector, ConnectorStatus } from "./chat-connector";
import type { PersistedState } from "./chat-persistence";

export function createLocalConnector(): ChatConnector {
  return {
    kind: "local",

    async load() {
      // localStorage is synchronous; the promise is for the interface, not for
      // the read. Resolving on a microtask keeps the first paint identical to
      // the old code, which also applied the snapshot in an effect.
      if (typeof window === "undefined") return null;
      return parseSavedState(window.localStorage.getItem(STORAGE_KEY));
    },

    async save(state: PersistedState) {
      if (typeof window === "undefined") return false;
      return writeSnapshot(state);
    },

    subscribe(onChange) {
      if (typeof window === "undefined") return () => {};
      const handle = (event: StorageEvent) => {
        if (event.key !== STORAGE_KEY) return;
        const next = parseSavedState(event.newValue);
        if (next) onChange(next);
      };
      window.addEventListener("storage", handle);
      return () => window.removeEventListener("storage", handle);
    },

    async status(): Promise<ConnectorStatus> {
      if (typeof window === "undefined") {
        return { kind: "local", ready: false, detail: "No window — server render" };
      }
      // Availability is not the same as presence: private-mode browsers expose
      // localStorage and throw on write. Probe with an actual write.
      try {
        const probe = `${STORAGE_KEY}:probe`;
        window.localStorage.setItem(probe, "1");
        window.localStorage.removeItem(probe);
        return { kind: "local", ready: true, detail: `localStorage (${STORAGE_KEY})` };
      } catch {
        return {
          kind: "local",
          ready: false,
          detail: "localStorage is not writable — this session will not be saved",
        };
      }
    },
  };
}
