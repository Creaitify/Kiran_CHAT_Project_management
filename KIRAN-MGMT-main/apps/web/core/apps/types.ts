/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * The app contract.
 *
 * KIRAN is a shell that hosts several apps -- Projects today, Chat next, and
 * whatever comes after. An "app" is a top-level section with its own rail
 * entry, its own routes under `/:workspaceSlug/...`, and its own sidebar. It is
 * *not* a page, a tab, or a project feature; those belong inside an app.
 *
 * Everything the shell needs to know about an app is declared here. The rail,
 * the router and the command palette all read the same registry, so adding an
 * app means adding a manifest -- not editing the shell.
 *
 * ---------------------------------------------------------------------------
 * Two halves, on purpose
 * ---------------------------------------------------------------------------
 * `AppManifest` (this file) is the runtime half: icons, labels, permission
 * gates. It imports React and is only ever loaded in the browser.
 *
 * `AppRoutes` (`./routes.ts`) is the build-time half. React Router's config
 * loader evaluates it in Node before the app exists, so it must stay free of
 * JSX and of anything that touches `window`. Keeping the two apart is what
 * lets a single registry serve both without the route config dragging the
 * entire component tree into the build step.
 */

import type { EUserPermissionsLevel } from "@plane/constants";
import type { EUserProjectRoles, EUserWorkspaceRoles } from "@plane/types";

export type TAppKey = string;

/**
 * What an app is allowed to ask about the current user when deciding whether
 * to appear. Deliberately narrow: an app may gate on role, and nothing else.
 * Anything richer is a question for the app's own screens, not the rail.
 */
export type TAppVisibilityContext = {
  workspaceSlug: string;
  /**
   * The workspace/project role check from `useUser().permission`. Same
   * signature the rest of the app uses, so a manifest reads like any other
   * permission call.
   */
  allowPermissions: (
    allowedRoles: (EUserWorkspaceRoles | EUserProjectRoles)[],
    level: EUserPermissionsLevel,
    workspaceSlug?: string,
    projectId?: string
  ) => boolean;
};

export type TAppManifest = {
  /** Stable identifier. Used in preference keys, so renaming one migrates nothing. */
  key: TAppKey;
  /**
   * Rail label, and the command palette title after "Go to ".
   *
   * Plain English, not an i18n key. `useTranslation().t` echoes back any string
   * that isn't a dotted key path, so literal labels render correctly and can be
   * swapped for real keys later without changing this contract.
   */
  label: string;
  /** Rail icon. Sized by the caller; render it at `size-5`. */
  icon: React.ReactNode;
  /** Where the rail entry points. */
  path: (workspaceSlug: string) => string;
  /**
   * Does this pathname belong to the app?
   *
   * Return false for paths you don't own -- the shell resolves exactly one
   * active app and falls back to the app marked `isFallback` when no manifest
   * claims the path.
   */
  matches: (pathname: string, workspaceSlug: string) => boolean;
  /** Rail order, ascending. Leave gaps so later apps can slot between. */
  order: number;
  /**
   * Claims every path no other app claims. Exactly one app may set this.
   *
   * Projects owns it because the workspace root (`/:workspaceSlug`) is a
   * Projects screen and always has been. Without a declared fallback the rail
   * would show nothing selected on half the routes in the product.
   */
  isFallback?: boolean;
  /** Role gate. Omitted means "anyone who can see the workspace". */
  isAvailable?: (ctx: TAppVisibilityContext) => boolean;
  /**
   * Power-K key sequence that jumps to the app.
   *
   * The `a*` space is reserved for apps -- `ap` Projects, `ah` Hello, `ac`
   * Chat. The `g*` ("go to") space the rest of the palette uses is nearly
   * exhausted and already contains duplicates; keeping apps out of it means a
   * new app can pick a sequence without auditing every command in the product.
   *
   * Omit to keep the app out of the palette's navigation group.
   */
  keySequence?: string;
  /** Extra search terms for the palette. The label is always searchable. */
  keywords?: string[];
};
