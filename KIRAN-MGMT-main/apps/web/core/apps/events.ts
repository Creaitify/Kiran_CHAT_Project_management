/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * The cross-app event channel.
 *
 * Apps must not import each other. When Chat wants to show that a work item
 * moved, or Projects wants to know a conversation was opened, the fact travels
 * through here -- so neither app has a build-time dependency on the other and
 * either can be deleted without breaking the survivor.
 *
 * ---------------------------------------------------------------------------
 * What this is not
 * ---------------------------------------------------------------------------
 * Not a message bus, not a queue, not a state container. It is in-memory,
 * synchronous, and scoped to one browser tab: publish is a `for` loop over
 * subscribers. Nothing is buffered, so a subscriber that mounts after an event
 * fired has missed it -- events are notifications about *now*, and anything
 * that needs history should be asking the server for it.
 *
 * It is deliberately this small. This is the seam that approvals, escalations
 * and notifications will hang off later; making it clever now, before a second
 * app exists to have an opinion, would be guessing.
 */

/**
 * Event names are namespaced `<app>:<thing>.<happened>` so an event's owner is
 * readable at the subscription site. Declared centrally rather than per-app
 * because the point of a shared channel is a shared vocabulary -- if two apps
 * invent `message.sent` independently, they are not talking to each other.
 */
export type TAppEventMap = {
  /** A chat message was accepted by the server. */
  "chat:message.created": { roomId: string; messageId: string; senderId: string };
  /** The user opened a conversation. */
  "chat:room.opened": { roomId: string };
  /** A work item was opened. */
  "projects:work-item.opened": { workItemId: string; projectId: string };
};

export type TAppEventName = keyof TAppEventMap;

type TListener<K extends TAppEventName> = (payload: TAppEventMap[K]) => void;

const listeners = new Map<TAppEventName, Set<TListener<never>>>();

/**
 * Subscribe. Returns the unsubscribe function -- call it, or the listener
 * outlives the component that created it and fires against unmounted state.
 */
export function subscribeToAppEvent<K extends TAppEventName>(name: K, listener: TListener<K>): () => void {
  const set = listeners.get(name) ?? new Set();
  set.add(listener as TListener<never>);
  listeners.set(name, set);

  return () => {
    set.delete(listener as TListener<never>);
    if (set.size === 0) listeners.delete(name);
  };
}

/**
 * Publish to every current subscriber.
 *
 * A throwing subscriber is contained and logged rather than allowed to
 * propagate: one app's broken handler must not abort delivery to the others,
 * and must not fail the publisher's own operation. Delivery is best-effort by
 * design -- if the caller needs to know an event was acted on, an event is the
 * wrong tool.
 *
 * The set is copied before iteration so a listener that unsubscribes itself
 * (a common shape) cannot mutate the collection mid-loop.
 */
export function publishAppEvent<K extends TAppEventName>(name: K, payload: TAppEventMap[K]): void {
  const set = listeners.get(name);
  if (!set) return;

  for (const listener of [...set]) {
    try {
      (listener as TListener<K>)(payload);
    } catch (error) {
      console.error(`[app-events] Subscriber for "${name}" threw.`, error);
    }
  }
}
