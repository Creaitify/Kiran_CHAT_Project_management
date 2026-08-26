/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/** BUILD-TIME MODULE -- see `core/apps/routes.ts`. No JSX, no browser globals. */

import { layout, route } from "@react-router/dev/routes";
import type { RouteConfigEntry } from "@react-router/dev/routes";

/**
 * Two screens.
 *
 * The workspace view takes the active room from a `?room=` query parameter
 * rather than a path segment, which is how the standalone app did it and is
 * worth keeping: the room is a selection within one long-lived screen, not a
 * separate page. Putting it in the path would remount the conversation list on
 * every room switch.
 */
export const chatAppRoutes: RouteConfigEntry[] = [
  layout("./(all)/[workspaceSlug]/(chat)/layout.tsx", [
    route(":workspaceSlug/chat", "./(all)/[workspaceSlug]/(chat)/page.tsx"),
    route(":workspaceSlug/chat/join/:code", "./(all)/[workspaceSlug]/(chat)/join/page.tsx"),
  ]),
];
