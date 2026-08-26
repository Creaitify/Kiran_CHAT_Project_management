/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { RouteConfigEntry } from "@react-router/dev/routes";
// Relative rather than aliased: this module is evaluated by React Router's
// Node-side config loader, which resolves tsconfig paths through a Vite plugin.
// A relative path has no such dependency.
import { appRegistryRoutes } from "../../core/apps/routes";

/**
 * Routes contributed by registered apps.
 *
 * `mergeRoutes` folds these into `coreRoutes` by matching layout files, so an
 * app nests inside the signed-in workspace shell without core.ts knowing it
 * exists. See `core/apps/routes.ts`.
 */
export const extendedRoutes: RouteConfigEntry[] = [...appRegistryRoutes];
