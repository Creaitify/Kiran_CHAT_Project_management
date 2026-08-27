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
// components
import type { TPowerKCommandConfig } from "@/components/power-k/core/types";

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

/**
 * What an app puts on its rail icon.
 *
 * Returning `undefined` draws nothing, which is different from returning
 * `{count: 0}` -- "I do not have a number yet" and "the number is zero" both
 * render as no badge, but only the first is honest while a request is in
 * flight, and the difference matters if a caller ever wants to show a
 * placeholder.
 */
export type TAppBadge = {
  /** Zero renders nothing. Anything past 99 renders as "99+". */
  count: number;
  /**
   * Raise the badge to the attention colour.
   *
   * Chat sets this for mentions: eleven unread messages is a number, one of
   * them being addressed to you by name is a different thing, and a rail that
   * cannot tell them apart trains people to ignore it.
   */
  emphasis?: boolean;
  /** Accessible description, e.g. "3 unread messages, 1 mention". */
  label?: string;
};

/**
 * What a contribution hook is told about its own app.
 *
 * `isVisible` is the important one. Contribution hooks are called for *every*
 * registered app on every render, visible or not -- see `contributions.ts` for
 * why that is the only Rules-of-Hooks-safe shape -- so an app that fetches
 * anything has to be told when not to bother.
 */
export type TAppContributionContext = {
  workspaceSlug: string;
  /** False when this app is gated away from the current user. Do no work. */
  isVisible: boolean;
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
  /**
   * Live count for the rail icon.
   *
   * A hook rather than a value because a manifest is a static object and a
   * badge is not: the number has to come from somewhere that can poll, cache
   * and re-render. The shell calls it; the app owns where the number comes
   * from, and owns keeping it cheap.
   *
   * Called on every render of the rail whether or not the app is visible, so
   * check `ctx.isVisible` before doing anything expensive. Return `undefined`
   * for "no badge".
   */
  useBadge?: (ctx: TAppContributionContext) => TAppBadge | undefined;
  /**
   * Palette entries beyond the "Go to <App>" one the registry generates for
   * free.
   *
   * This is the seam for *contents*: chat contributes its conversations, so
   * Power-K can jump straight into a room rather than only into the app. Same
   * visibility caveat as `useBadge` -- the hook runs regardless, so gate the
   * work on `ctx.isVisible`.
   *
   * Return a stable array; the shell memoises on identity.
   */
  usePowerKCommands?: (ctx: TAppContributionContext) => TPowerKCommandConfig[];
};
