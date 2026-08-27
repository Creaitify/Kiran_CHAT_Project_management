/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Collecting what apps contribute to shared shell surfaces.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists at all
 * ---------------------------------------------------------------------------
 * `useBadge` and `usePowerKCommands` are hooks on the manifest, which is the
 * only shape that works -- a badge count has to poll and re-render, and a
 * static object cannot. But calling them naively breaks the Rules of Hooks:
 *
 *     apps.map((app) => app.useBadge?.(ctx))   // WRONG
 *
 * `apps` is the *visible* app list. It changes when permissions resolve, so the
 * number of hooks called changes between renders, and React's hook order breaks
 * — usually as somebody else's state appearing in the wrong component.
 *
 * The fix is to iterate `getRegisteredApps()` instead. That returns a
 * module-level constant: the same array, the same length, in the same order,
 * for the entire life of the page. Hook count is fixed at import time, which is
 * exactly the guarantee React wants.
 *
 * The cost is that a hidden app's hooks still run. That is why the contribution
 * context carries `isVisible`, and why both contracts say in as many words that
 * an app must do no work when it is false.
 *
 * ---------------------------------------------------------------------------
 * Why not a MobX store, or a context, or a registry of subscriptions
 * ---------------------------------------------------------------------------
 * All of those move the coupling rather than removing it: the app would have to
 * find the store and push into it, which means an app reaching into shell
 * internals -- the thing the contract exists to prevent. Here the shell asks and
 * the app answers, and an app that does not implement the hook contributes
 * nothing without knowing the surface exists.
 */

import { useMemo } from "react";
import { useParams } from "next/navigation";
// components
import type { TPowerKCommandConfig } from "@/components/power-k/core/types";
// local imports
import { getRegisteredApps } from "./registry";
import type { TAppBadge, TAppContributionContext, TAppKey } from "./types";
import { useApps } from "./use-apps";

/**
 * Every app's badge, keyed by app key.
 *
 * Undefined for an app with no `useBadge`, and for one whose hook returned
 * nothing. Callers should treat both the same way: draw no badge.
 */
export const useAppBadges = (): Record<TAppKey, TAppBadge | undefined> => {
  const { workspaceSlug } = useParams();
  const { apps } = useApps();

  const slug = workspaceSlug?.toString() ?? "";
  const visible = useMemo(() => new Set(apps.map((app) => app.key)), [apps]);

  const badges: Record<TAppKey, TAppBadge | undefined> = {};

  // Fixed iteration over the module-level registry. See the header: this array
  // never changes identity or length, which is what keeps the hook count stable.
  for (const app of getRegisteredApps()) {
    const ctx: TAppContributionContext = { workspaceSlug: slug, isVisible: visible.has(app.key) };
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const badge = app.useBadge?.(ctx);
    // A hidden app's result is discarded rather than trusted. Its hook was
    // called only to keep the count stable, and it was told not to do the work.
    badges[app.key] = visible.has(app.key) ? badge : undefined;
  }

  return badges;
};

/** Every app's extra palette commands, flattened. */
export const useAppContributedPowerKCommands = (): TPowerKCommandConfig[] => {
  const { workspaceSlug } = useParams();
  const { apps } = useApps();

  const slug = workspaceSlug?.toString() ?? "";
  const visible = useMemo(() => new Set(apps.map((app) => app.key)), [apps]);

  const contributed: TPowerKCommandConfig[][] = [];

  for (const app of getRegisteredApps()) {
    const ctx: TAppContributionContext = { workspaceSlug: slug, isVisible: visible.has(app.key) };
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const commands = app.usePowerKCommands?.(ctx) ?? [];
    contributed.push(visible.has(app.key) ? commands : []);
  }

  return contributed.flat();
};
