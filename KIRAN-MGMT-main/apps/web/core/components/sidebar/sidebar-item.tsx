/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import Link from "next/link";
import { cn } from "@plane/utils";

// ============================================================================
// TYPES
// ============================================================================

interface AppSidebarItemData {
  href?: string;
  label?: string;
  icon?: React.ReactNode;
  isActive?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  showLabel?: boolean;
  /**
   * Accessible name for the icon-only rendering. Only needed when there is no
   * visible label -- either because the item has none, or because `showLabel` is
   * false (the app rail's "icon only" display mode). Falls back to `label`.
   */
  ariaLabel?: string;
  /**
   * Unread count drawn over the icon. Zero or absent draws nothing.
   *
   * `badgeEmphasis` raises it to the attention colour -- chat uses it for
   * mentions, because eleven unread messages and one addressed to you by name
   * are different facts and a rail that cannot tell them apart trains people to
   * ignore it.
   */
  badgeCount?: number;
  badgeEmphasis?: boolean;
}

interface AppSidebarItemProps {
  variant?: "link" | "button";
  item?: AppSidebarItemData;
}

interface AppSidebarItemLabelProps {
  highlight?: boolean;
  label?: string;
}

interface AppSidebarItemIconProps {
  icon?: React.ReactNode;
  highlight?: boolean;
  badgeCount?: number;
  badgeEmphasis?: boolean;
}

interface AppSidebarLinkItemProps {
  href?: string;
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}

interface AppSidebarButtonItemProps {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

// ============================================================================
// STYLES
// ============================================================================

const styles = {
  base: "group flex flex-col gap-0.5 items-center justify-center text-tertiary",
  icon: "flex items-center justify-center gap-2 size-8 rounded-md text-tertiary",
  iconActive: "bg-layer-transparent-selected text-secondary !text-icon-primary",
  iconInactive: "group-hover:text-icon-secondary group-hover:bg-layer-transparent-hover !text-icon-tertiary",
  label: "text-11 font-medium",
  labelActive: "text-secondary",
  labelInactive: "group-hover:text-secondary text-tertiary",
  // `min-w` rather than a fixed width so "99+" is not clipped, and
  // `pointer-events-none` so the badge never swallows the click on the icon
  // underneath it.
  badge:
    "pointer-events-none absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none",
  badgeQuiet: "bg-layer-transparent-selected text-secondary",
  // `text-on-color` is the design system's text-on-a-solid-fill token, so the
  // badge stays legible in all five themes without a hardcoded white.
  badgeLoud: "bg-danger-primary text-on-color",
} as const;

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function AppSidebarItemLabel({ highlight = false, label }: AppSidebarItemLabelProps) {
  if (!label) return null;

  return (
    <span
      className={cn(styles.label, {
        [styles.labelActive]: highlight,
        [styles.labelInactive]: !highlight,
      })}
    >
      {label}
    </span>
  );
}

function AppSidebarItemIcon({ icon, highlight, badgeCount = 0, badgeEmphasis }: AppSidebarItemIconProps) {
  if (!icon) return null;

  return (
    <div
      className={cn(styles.icon, "relative", {
        [styles.iconActive]: highlight,
        [styles.iconInactive]: !highlight,
      })}
    >
      {icon}
      {badgeCount > 0 && (
        // aria-hidden because the count is already in the item's accessible
        // name; announcing it twice is worse than not announcing it at all.
        <span
          aria-hidden
          className={cn(styles.badge, badgeEmphasis ? styles.badgeLoud : styles.badgeQuiet)}
        >
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      )}
    </div>
  );
}

function AppSidebarLinkItem({ href, children, className, ariaLabel }: AppSidebarLinkItemProps) {
  if (!href) return null;

  return (
    <Link href={href} className={cn(styles.base, className)} aria-label={ariaLabel}>
      {children}
    </Link>
  );
}

function AppSidebarButtonItem({
  children,
  onClick,
  disabled = false,
  className,
  ariaLabel,
}: AppSidebarButtonItemProps) {
  return (
    <button
      className={cn(styles.base, className)}
      onClick={onClick}
      disabled={disabled}
      type="button"
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export type AppSidebarItemComponent = React.FC<AppSidebarItemProps> & {
  Label: React.FC<AppSidebarItemLabelProps>;
  Icon: React.FC<AppSidebarItemIconProps>;
  Link: React.FC<AppSidebarLinkItemProps>;
  Button: React.FC<AppSidebarButtonItemProps>;
};

function AppSidebarItem({ variant = "link", item }: AppSidebarItemProps) {
  if (!item) return null;

  const {
    icon,
    isActive,
    label,
    href,
    onClick,
    disabled,
    showLabel = true,
    ariaLabel,
    badgeCount,
    badgeEmphasis,
  } = item;

  const hasVisibleLabel = showLabel && !!label;
  // Never override a visible text label -- only name the control when the label is
  // hidden ("icon only" display mode) or the item never had one.
  const accessibleName = hasVisibleLabel ? undefined : (ariaLabel ?? label);

  const commonItems = (
    <>
      <AppSidebarItemIcon
        icon={icon}
        highlight={isActive}
        badgeCount={badgeCount}
        badgeEmphasis={badgeEmphasis}
      />
      {showLabel && <AppSidebarItemLabel highlight={isActive} label={label} />}
    </>
  );

  if (variant === "link") {
    return (
      <AppSidebarLinkItem href={href} ariaLabel={accessibleName}>
        {commonItems}
      </AppSidebarLinkItem>
    );
  }

  return (
    <AppSidebarButtonItem onClick={onClick} disabled={disabled} ariaLabel={accessibleName}>
      {commonItems}
    </AppSidebarButtonItem>
  );
}

// ============================================================================
// COMPOUND COMPONENT ASSIGNMENT
// ============================================================================

AppSidebarItem.Label = AppSidebarItemLabel;
AppSidebarItem.Icon = AppSidebarItemIcon;
AppSidebarItem.Link = AppSidebarLinkItem;
AppSidebarItem.Button = AppSidebarButtonItem;

export { AppSidebarItem };
export type { AppSidebarItemData, AppSidebarItemProps };
