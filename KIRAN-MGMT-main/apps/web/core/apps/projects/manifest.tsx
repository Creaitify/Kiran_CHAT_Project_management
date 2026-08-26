/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { PlaneNewIcon } from "@plane/propel/icons";
import type { TAppManifest } from "../types";

/**
 * Projects -- the original app, and the shell's fallback.
 *
 * `matches` is never consulted for a positive claim: Projects owns the
 * workspace root and a long tail of screens beneath it (`/:slug`,
 * `/:slug/projects/...`, `/:slug/browse/...`, `/:slug/analytics/...`, and more),
 * and enumerating them here would be a list that goes stale the first time
 * someone adds a screen. `isFallback` says the true thing instead: anything no
 * other app claims is Projects.
 *
 * Workspace settings (`/:slug/settings`) is the one path Projects gives back.
 * It is shell furniture with its own rail entry below the divider, so claiming
 * it would light up the Projects icon while the user is plainly somewhere else.
 */
export const projectsAppManifest: TAppManifest = {
  key: "projects",
  label: "Projects",
  icon: <PlaneNewIcon className="size-5" />,
  path: (workspaceSlug) => `/${workspaceSlug}/`,
  matches: (pathname, workspaceSlug) => !pathname.startsWith(`/${workspaceSlug}/settings`),
  order: 100,
  isFallback: true,
  keySequence: "ap",
  keywords: ["work items", "issues", "cycles", "modules"],
};
