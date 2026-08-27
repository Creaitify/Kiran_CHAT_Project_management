/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import type { AppSidebarItemData } from "@/components/sidebar/sidebar-item";
// apps
import { useAppBadges } from "@/apps/contributions";
import { useApps } from "@/apps/use-apps";

type WithDockItemsProps = {
  dockItems: (AppSidebarItemData & { shouldRender: boolean })[];
};

/**
 * Supplies the app rail's items from the app registry.
 *
 * This used to be a one-element array literal containing Projects, which was
 * honest while Projects was the only app. It now reads the registry, so a new
 * app appears in the rail by existing rather than by editing this file.
 *
 * `shouldRender` is always true: permission filtering already happened in
 * `useApps`, and an app the user cannot see never reaches this list. The flag
 * stays in the shape because `AppSidebarItemsRoot` filters on it and other
 * callers may have their own reasons to hide an item.
 *
 * Badges come from `useAppBadges`, which asks every app rather than knowing
 * about any of them -- see `apps/contributions.ts` for why it iterates the
 * registry rather than this visible list.
 */
export function withDockItems<P extends WithDockItemsProps>(WrappedComponent: React.ComponentType<P>) {
  const ComponentWithDockItems = observer(function ComponentWithDockItems(props: Omit<P, keyof WithDockItemsProps>) {
    const { workspaceSlug } = useParams();
    const { apps, activeApp } = useApps();
    const badges = useAppBadges();

    const slug = workspaceSlug?.toString() ?? "";

    const dockItems: (AppSidebarItemData & { shouldRender: boolean })[] = apps.map((app) => {
      const badge = badges[app.key];
      return {
        label: app.label,
        icon: app.icon,
        href: app.path(slug),
        isActive: app.key === activeApp?.key,
        badgeCount: badge?.count,
        badgeEmphasis: badge?.emphasis,
        // The count is spoken as part of the item's name rather than announced
        // separately -- a screen reader reaching a rail icon should hear "Chat,
        // 3 unread messages", not "Chat" and then a stray number.
        ariaLabel: badge?.label ? `${app.label}, ${badge.label}` : undefined,
        shouldRender: true,
      };
    });

    return <WrappedComponent {...(props as P)} dockItems={dockItems} />;
  });

  return ComponentWithDockItems;
}
