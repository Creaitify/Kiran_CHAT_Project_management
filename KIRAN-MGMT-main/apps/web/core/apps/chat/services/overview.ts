/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Chat's summary for the shell, and the one poll behind it.
 *
 * The rail badge and the command palette both want this, they mount
 * independently, and neither is inside `ChatProvider` -- so the cache lives at
 * module scope rather than in a React context. A context would have to be
 * mounted somewhere above both surfaces, which means the shell hosting a
 * chat-shaped provider, which is exactly the coupling the app contract exists to
 * avoid.
 *
 * Three properties make it cheap enough to run on every page in the product:
 *
 * 1. **One request, shared.** Concurrent callers await the same promise. Two
 *    consumers mounting on the same tick cost one round trip.
 * 2. **Slow by default.** Thirty seconds. This is a number on an icon, not a
 *    conversation -- the three-second poll inside chat exists because messages
 *    are being read as they arrive, and that reasoning does not transfer.
 * 3. **Event-driven where it matters.** Sending a message or opening a room
 *    publishes on the app event channel, and this refreshes on both. So the
 *    badge clears the moment you read a room rather than up to thirty seconds
 *    later, without polling faster to achieve it.
 */

import { useCallback, useEffect, useState } from "react";
// apps
import { subscribeToAppEvent } from "../../events";
// local imports
import { ChatService } from "./chat.service";

export type TChatOverviewRoom = {
  id: string;
  title: string;
  type: "group" | "direct" | "groupdm";
  unread: number;
  mentions: number;
};

export type TChatOverview = {
  unread: { total: number; mentions: number };
  rooms: TChatOverviewRoom[];
};

/** Slow on purpose. See the header. */
const POLL_INTERVAL_MS = 30_000;

/** Coalesces bursts -- opening three rooms in a second is one refetch. */
const REFRESH_DEBOUNCE_MS = 400;

const service = new ChatService();

type TCacheEntry = {
  value: TChatOverview | null;
  inFlight: Promise<TChatOverview | null> | null;
  listeners: Set<(value: TChatOverview | null) => void>;
};

/** Keyed by workspace: switching workspaces must not show the old numbers. */
const cache = new Map<string, TCacheEntry>();

function entryFor(workspaceSlug: string): TCacheEntry {
  let entry = cache.get(workspaceSlug);
  if (!entry) {
    entry = { value: null, inFlight: null, listeners: new Set() };
    cache.set(workspaceSlug, entry);
  }
  return entry;
}

async function fetchOverview(workspaceSlug: string): Promise<TChatOverview | null> {
  const entry = entryFor(workspaceSlug);
  // Whoever asked first owns the request; everyone else waits on it.
  if (entry.inFlight) return entry.inFlight;

  entry.inFlight = service
    .fetchOverview(workspaceSlug)
    .then((value) => {
      entry.value = value;
      for (const listener of entry.listeners) listener(value);
      return value;
    })
    // A failed overview is not worth a toast or a console line: the rail simply
    // shows no badge, which is what it showed a moment ago. The next tick
    // retries.
    .catch(() => entry.value)
    .finally(() => {
      entry.inFlight = null;
    });

  return entry.inFlight;
}

/**
 * The current overview, or null before the first response.
 *
 * Returns null rather than a zeroed object on purpose -- "no badge yet" and
 * "the count is zero" both draw nothing, but only the first is true while the
 * request is in flight.
 */
export function useChatOverview(workspaceSlug: string, enabled: boolean): TChatOverview | null {
  const [value, setValue] = useState<TChatOverview | null>(
    () => (workspaceSlug ? entryFor(workspaceSlug).value : null)
  );

  const refresh = useCallback(() => {
    if (!enabled || !workspaceSlug) return;
    void fetchOverview(workspaceSlug);
  }, [enabled, workspaceSlug]);

  useEffect(() => {
    if (!enabled || !workspaceSlug) {
      setValue(null);
      return;
    }

    const entry = entryFor(workspaceSlug);
    setValue(entry.value);
    entry.listeners.add(setValue);
    refresh();

    const interval = setInterval(refresh, POLL_INTERVAL_MS);

    // The app event channel, used for the thing it was built for. Chat does not
    // know the rail exists; the rail does not know what a room is. Both know the
    // event.
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(refresh, REFRESH_DEBOUNCE_MS);
    };
    const unsubscribes = [
      subscribeToAppEvent("chat:message.created", soon),
      subscribeToAppEvent("chat:room.opened", soon),
    ];

    return () => {
      entry.listeners.delete(setValue);
      clearInterval(interval);
      if (debounce) clearTimeout(debounce);
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [enabled, workspaceSlug, refresh]);

  return value;
}

/** Test seam: drops every cached overview. */
export function __resetChatOverviewCache() {
  cache.clear();
}
