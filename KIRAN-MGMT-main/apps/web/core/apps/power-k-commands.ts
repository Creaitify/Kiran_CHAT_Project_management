/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Command palette entries generated from the app registry.
 *
 * Two kinds, from the same registry.
 *
 * **Navigation** -- one "Go to <App>" per app the user can see, minus the app
 * they are already in, because offering to navigate somewhere you already are is
 * noise. Apps without a `keySequence` are skipped, which is how an app opts out
 * of the palette without opting out of the rail.
 *
 * **Contributed** -- whatever an app returns from `usePowerKCommands`. This is
 * the seam for an app's *contents* rather than the app itself: chat contributes
 * its conversations, so Power-K jumps into a room instead of only into chat.
 * The shell does not know what any of them are.
 */

import { useMemo } from "react";
// components
import type { TPowerKCommandConfig } from "@/components/power-k/core/types";
import { handlePowerKNavigate } from "@/components/power-k/utils/navigation";
// local imports
import { useAppContributedPowerKCommands } from "./contributions";
import { useApps } from "./use-apps";

export const useAppRegistryPowerKCommands = (): TPowerKCommandConfig[] => {
  const { apps, activeApp, hasMultipleApps } = useApps();
  // Deliberately outside the `hasMultipleApps` guard below. That guard is about
  // whether *switching apps* is meaningful; jumping to a conversation inside the
  // one app you have is meaningful either way.
  const contributed = useAppContributedPowerKCommands();

  const navigation = useMemo(() => {
    // A single app means there is nowhere to switch to.
    if (!hasMultipleApps) return [];

    return apps
      .filter((app) => app.keySequence && app.key !== activeApp?.key)
      .map<TPowerKCommandConfig>((app) => ({
        id: `nav_app_${app.key}`,
        type: "action",
        group: "navigation",
        // Not an i18n key: `t()` echoes back any string that isn't a dotted key
        // path, so app labels stay in the manifest instead of forcing every new
        // app through a locale-file change in ten languages.
        i18n_title: `Go to ${app.label}`,
        iconNode: app.icon,
        keySequence: app.keySequence,
        keywords: [app.label.toLowerCase(), ...(app.keywords ?? [])],
        action: (ctx) => {
          const workspaceSlug = ctx.params.workspaceSlug?.toString();
          if (!workspaceSlug) return;
          handlePowerKNavigate(ctx, [app.path(workspaceSlug)]);
        },
        isEnabled: (ctx) => Boolean(ctx.params.workspaceSlug?.toString()),
        isVisible: (ctx) => Boolean(ctx.params.workspaceSlug?.toString()),
        closeOnSelect: true,
      }));
  }, [apps, activeApp?.key, hasMultipleApps]);

  return useMemo(() => [...navigation, ...contributed], [navigation, contributed]);
};
