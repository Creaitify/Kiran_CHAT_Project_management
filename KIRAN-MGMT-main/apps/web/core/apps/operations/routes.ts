/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/** BUILD-TIME MODULE -- see `core/apps/routes.ts`. No JSX, no browser globals. */

import { layout, route } from "@react-router/dev/routes";
import type { RouteConfigEntry } from "@react-router/dev/routes";

export const operationsAppRoutes: RouteConfigEntry[] = [
  layout("./(all)/[workspaceSlug]/(operations)/layout.tsx", [
    route(":workspaceSlug/operations", "./(all)/[workspaceSlug]/(operations)/page.tsx"),
  ]),
];
