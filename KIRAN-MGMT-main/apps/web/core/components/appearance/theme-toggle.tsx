/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useTheme } from "next-themes";
import { Check, Monitor, Moon, Sun } from "lucide-react";
// KCMS imports
import type { I_THEME_OPTION } from "@plane/constants";
import { THEME_OPTIONS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { CustomMenu } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useUserProfile } from "@/hooks/store/user";

/**
 * The custom theme is deliberately excluded here. Unlike the other themes it is
 * not a token swap behind [data-theme] — it needs a palette saved on the user
 * profile and applied imperatively, so there is nothing for it to render before
 * sign-in. It stays in profile settings, the only place it can be configured.
 */
const TOGGLE_THEME_OPTIONS: I_THEME_OPTION[] = THEME_OPTIONS.filter(
  (option) => option.value !== "custom",
);

/**
 * Matches the `dark` variant selector in tailwind-config's variables.css, which
 * is `[data-theme*="dark"]` — a substring match, on purpose, because it is what
 * makes `dark-contrast` inherit the dark palette. Keep the two in step: an
 * exact comparison here would show a sun icon on a dark screen.
 */
function isDarkTheme(theme: string | undefined): boolean {
  return !!theme && theme.includes("dark");
}

/**
 * Reads and writes the theme without assuming anyone is signed in.
 *
 * next-themes is the source of truth for what is on screen and persists to
 * localStorage on its own, so this works unauthenticated. When a profile does
 * exist the choice is also written back to the server — without that, the
 * one-time server sync in StoreWrapper would revert the change on next load.
 */
function useThemePreference() {
  const { setTheme, theme, resolvedTheme } = useTheme();
  const { data: userProfile, updateUserTheme } = useUserProfile();
  // next-themes cannot know the stored theme until it is on the client, so
  // anything derived from it has to wait for mount or it hydrates mismatched.
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // The same fallback chain the settings control uses, and for the same reason:
  // a fresh account has no saved profile theme, and matching on that alone left
  // this null, which reads as "no theme is set" when one plainly is.
  const currentTheme = useMemo(() => {
    // oxlint-disable-next-line no-shadow
    const byValue = (value?: string) => TOGGLE_THEME_OPTIONS.find((t) => t.value === value);
    return byValue(userProfile?.theme?.theme) ?? byValue(theme) ?? byValue(resolvedTheme) ?? null;
  }, [userProfile?.theme?.theme, theme, resolvedTheme]);

  const selectTheme = useCallback(
    (option: I_THEME_OPTION) => {
      setTheme(option.value);
      // Guard on `id`, not on the object. ProfileStore initialises `data` to a
      // populated-shape literal with every field undefined, so the store value is
      // truthy even when nobody is signed in — `if (!userProfile)` never fires.
      // Getting this wrong is not a no-op: the PATCH goes out, 401s, and the
      // interceptor in api.service.ts turns any 401 into a window.location
      // .replace(), so switching theme on the sign-in page did a full page load
      // instead of a token swap.
      if (!userProfile?.id) return;
      updateUserTheme({ theme: option.value }).catch((error: unknown) => {
        console.error("Error updating theme:", error);
      });
    },
    [setTheme, updateUserTheme, userProfile?.id],
  );

  return { currentTheme, isMounted, resolvedTheme, selectTheme };
}

function ThemeSwatch({ option, className }: { option: I_THEME_OPTION; className?: string }) {
  return (
    <div
      className={cn(
        "relative flex h-4 w-4 rotate-45 transform items-center justify-center rounded-full border-1",
        className,
      )}
      style={{ borderColor: option.icon.border }}
    >
      <div className="h-full w-1/2 rounded-l-full" style={{ background: option.icon.color1 }} />
      <div
        className="h-full w-1/2 rounded-r-full border-l"
        style={{ borderLeftColor: option.icon.border, background: option.icon.color2 }}
      />
    </div>
  );
}

type TThemeToggleProps = {
  className?: string;
};

/**
 * Compact theme picker for chrome that has to work before sign-in — the auth
 * screens' top bar. Offers every theme the app ships, not just light and dark.
 */
export const ThemeToggle = observer(function ThemeToggle({ className }: TThemeToggleProps) {
  const { t } = useTranslation();
  const { currentTheme, isMounted, resolvedTheme, selectTheme } = useThemePreference();

  const TriggerIcon =
    !isMounted || currentTheme?.value === "system"
      ? Monitor
      : isDarkTheme(resolvedTheme)
        ? Moon
        : Sun;

  return (
    <CustomMenu
      ariaLabel={t("select_your_theme")}
      placement="bottom-end"
      closeOnSelect
      maxHeight="lg"
      customButtonClassName={cn(
        "grid size-8 place-items-center rounded-md border border-subtle-1 text-secondary",
        "transition-colors hover:bg-layer-2 hover:text-primary",
        "focus-visible:outline-accent-primary focus-visible:outline-2 focus-visible:outline-offset-2",
        className,
      )}
      customButton={<TriggerIcon className="size-4 shrink-0" aria-hidden="true" />}
      optionsClassName="w-56 p-1"
    >
      {TOGGLE_THEME_OPTIONS.map((option) => (
        <CustomMenu.MenuItem key={option.value} onClick={() => selectTheme(option)}>
          <div className="flex items-center gap-2">
            <ThemeSwatch option={option} />
            <span className="flex-grow truncate">{t(option.key)}</span>
            {isMounted && currentTheme?.value === option.value && (
              <Check className="size-3.5 shrink-0 text-accent-primary" aria-hidden="true" />
            )}
          </div>
        </CustomMenu.MenuItem>
      ))}
    </CustomMenu>
  );
});

/**
 * The same picker flattened into a row of swatches, for placing inside a menu
 * that is already open. Nesting a dropdown inside the user menu fights the
 * outside-click detector; a row does not.
 */
export const ThemeOptionsRow = observer(function ThemeOptionsRow() {
  const { t } = useTranslation();
  const { currentTheme, isMounted, selectTheme } = useThemePreference();

  return (
    <div className="flex flex-col gap-1.5 px-1">
      <span className="text-caption-md-regular text-tertiary">{t("select_your_theme")}</span>
      <div className="flex items-center gap-1.5">
        {TOGGLE_THEME_OPTIONS.map((option) => {
          const isActive = isMounted && currentTheme?.value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-label={t(option.key)}
              aria-pressed={isActive}
              title={t(option.key)}
              onClick={(event) => {
                // The user menu closes on select. Picking a theme is a setting,
                // not navigation — keep the menu open so the change is visible.
                event.preventDefault();
                event.stopPropagation();
                selectTheme(option);
              }}
              className={cn(
                "grid size-7 place-items-center rounded-md border transition-colors",
                "focus-visible:outline-accent-primary focus-visible:outline-2 focus-visible:outline-offset-2",
                isActive ? "border-accent-primary bg-layer-2" : "border-subtle-1 hover:bg-layer-2",
              )}
            >
              <ThemeSwatch option={option} />
            </button>
          );
        })}
      </div>
    </div>
  );
});
