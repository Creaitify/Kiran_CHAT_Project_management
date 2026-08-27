/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef } from "react";
import { subscribeToAppEvent } from "./events";
import type { TAppEventMap, TAppEventName } from "./events";

/**
 * Subscribe to a cross-app event for the lifetime of a component.
 *
 * The handler is held in a ref so a caller passing an inline arrow function --
 * which is every caller -- does not resubscribe on every render. The
 * subscription is keyed on the event name alone, so it is created once and torn
 * down on unmount.
 */
export function useAppEvent<K extends TAppEventName>(name: K, handler: (payload: TAppEventMap[K]) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => subscribeToAppEvent(name, (payload) => handlerRef.current(payload)), [name]);
}
