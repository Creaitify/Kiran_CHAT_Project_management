/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * The registry, resolved against the current user and URL.
 *
 * Every shell surface that cares about apps reads these hooks rather than the
 * registry directly, so permission gating and active-app resolution happen in
 * one place instead of once per consumer.
 */

import { useMemo } from "react";
import { useParams, usePathname } from "next/navigation";
import { getAvailableApps, resolveActiveApp } from "./registry";
import type { TAppManifest, TAppVisibilityContext } from "./types";
// hooks
import { useUser } from "@/hooks/store/user";

type TUseApps = {
  /** Apps this user may see, in rail order. */
  apps: TAppManifest[];
  /** The app that owns the current URL, or undefined outside a workspace. */
  activeApp: TAppManifest | undefined;
  /**
   * Whether the shell should offer app switching at all.
   *
   * One app is not a choice, and a rail with a single permanently-selected
   * icon is a column of wasted pixels -- which is why the rail shipped
   * disabled. It turns itself on the moment a second app becomes visible.
   */
  hasMultipleApps: boolean;
};

export const useApps = (): TUseApps => {
  const { workspaceSlug } = useParams();
  const pathname = usePathname();
  const {
    permission: { allowPermissions },
  } = useUser();

  const slug = workspaceSlug?.toString() ?? "";

  const apps = useMemo(() => {
    if (!slug) return [];
    const ctx: TAppVisibilityContext = { workspaceSlug: slug, allowPermissions };
    return getAvailableApps(ctx);
  }, [slug, allowPermissions]);

  const activeApp = useMemo(() => {
    if (!slug) return undefined;
    return resolveActiveApp(apps, pathname, slug);
  }, [apps, pathname, slug]);

  return {
    apps,
    activeApp,
    hasMultipleApps: apps.length > 1,
  };
};
