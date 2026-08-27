/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * The app registry.
 *
 * One list, imported by the rail, the router and the command palette. Adding
 * an app is a manifest plus a line here; nothing else in the shell moves.
 *
 * The list is explicit rather than glob-discovered. `import.meta.glob` would
 * save the line, but the route half of the registry is evaluated by React
 * Router's Node-side config loader, where glob support is a Vite implementation
 * detail rather than a promise. A list that is one line longer and always works
 * is the better trade.
 */

import { chatAppManifest } from "./chat/manifest";
import { helloAppManifest } from "./hello/manifest";
import { notesAppManifest } from "./notes/manifest";
import { operationsAppManifest } from "./operations/manifest";
import { projectsAppManifest } from "./projects/manifest";
import type { TAppKey, TAppManifest, TAppVisibilityContext } from "./types";

/**
 * Registered apps, in registration order. Presentation order comes from
 * `manifest.order`, not from this array.
 */
const MANIFESTS: TAppManifest[] = [projectsAppManifest, chatAppManifest, notesAppManifest, operationsAppManifest, helloAppManifest];

/**
 * Fails loudly in development on the two mistakes that are silent at runtime:
 * a duplicate key (two apps quietly sharing preference storage) and a second
 * fallback (an active-app resolution that depends on array order).
 */
function assertRegistryIsSound(manifests: TAppManifest[]): void {
  if (process.env.NODE_ENV === "production") return;

  const seen = new Set<TAppKey>();
  for (const manifest of manifests) {
    if (seen.has(manifest.key)) {
      throw new Error(`[app-registry] Duplicate app key "${manifest.key}". App keys must be unique.`);
    }
    seen.add(manifest.key);
  }

  const fallbacks = manifests.filter((manifest) => manifest.isFallback);
  if (fallbacks.length > 1) {
    throw new Error(
      `[app-registry] More than one app declares isFallback: ${fallbacks
        .map((manifest) => manifest.key)
        .join(", ")}. Exactly one app may claim unmatched paths.`
    );
  }
}

assertRegistryIsSound(MANIFESTS);

const ORDERED = [...MANIFESTS].sort((a, b) => a.order - b.order);

/** Every registered app, in rail order. Ignores permissions. */
export function getRegisteredApps(): TAppManifest[] {
  return ORDERED;
}

export function getAppByKey(key: TAppKey): TAppManifest | undefined {
  return ORDERED.find((manifest) => manifest.key === key);
}

/** The apps this user may see, in rail order. */
export function getAvailableApps(ctx: TAppVisibilityContext): TAppManifest[] {
  return ORDERED.filter((manifest) => (manifest.isAvailable ? manifest.isAvailable(ctx) : true));
}

/**
 * Which app owns `pathname`.
 *
 * A manifest that claims the path wins. Otherwise the fallback app does, and
 * if there is no fallback the answer is `undefined` -- the rail then shows
 * nothing selected, which is honest rather than arbitrary.
 *
 * Only apps in `available` are considered, so a path belonging to an app the
 * user cannot see resolves to the fallback rather than highlighting a rail
 * entry that isn't rendered.
 */
export function resolveActiveApp(
  available: TAppManifest[],
  pathname: string,
  workspaceSlug: string
): TAppManifest | undefined {
  const claimed = available.find((manifest) => !manifest.isFallback && manifest.matches(pathname, workspaceSlug));
  if (claimed) return claimed;
  return available.find((manifest) => manifest.isFallback);
}
