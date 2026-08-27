/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Route contributions from registered apps.
 *
 * BUILD-TIME MODULE. React Router's config loader evaluates this in Node
 * before any browser exists, so nothing here may import JSX, a component, a
 * store, or anything that reads `window`. Keep it to route data.
 *
 * The shell's `app/routes/extended.ts` is the only consumer. Its output is
 * deep-merged into `coreRoutes` by `mergeRoutes`, which matches on the layout
 * `file` -- so an app re-declares the two shell layouts it nests under and the
 * merge folds its screens in beside Projects rather than beside the sign-in
 * page.
 *
 * Projects contributes nothing: its routes predate the registry and still live
 * in `app/routes/core.ts`. That is deliberate. Moving several hundred lines of
 * working route config to prove a point would be a large diff with no
 * behavioural gain, and `mergeRoutes` was built for exactly this shape --
 * core owns the first app, extended owns the rest.
 */

import { layout } from "@react-router/dev/routes";
import type { RouteConfigEntry } from "@react-router/dev/routes";
import { chatAppRoutes } from "./chat/routes";
import { helloAppRoutes } from "./hello/routes";
import { notesAppRoutes } from "./notes/routes";
import { operationsAppRoutes } from "./operations/routes";

/**
 * Nests an app's screens inside the signed-in workspace shell.
 *
 * The two layouts named here are the shell's, not the app's: `(all)/layout.tsx`
 * sets document meta, and `[workspaceSlug]/layout.tsx` supplies authentication,
 * the workspace guard, the app rail and the global modals. Re-declaring them is
 * how `mergeRoutes` knows where the app belongs.
 *
 * Paths are relative to `appDirectory` ("app"), not to this file.
 */
function inWorkspaceShell(children: RouteConfigEntry[]): RouteConfigEntry[] {
  return [layout("./(all)/layout.tsx", [layout("./(all)/[workspaceSlug]/layout.tsx", children)])];
}

/** Every registered app's routes, ready to merge into the core config. */
export const appRegistryRoutes: RouteConfigEntry[] = inWorkspaceShell([...chatAppRoutes, ...notesAppRoutes, ...operationsAppRoutes, ...helloAppRoutes]);
