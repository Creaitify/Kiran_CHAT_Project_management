/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useMemo } from "react";
import { observer } from "mobx-react";
import { useTheme } from "next-themes";
// KCMS imports
import type { I_THEME_OPTION } from "@plane/constants";
import { THEME_OPTIONS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { setPromiseToast } from "@plane/propel/toast";
import { applyCustomTheme } from "@plane/utils";
// components
import { CustomThemeSelector } from "@/components/core/theme/custom-theme-selector";
import { ThemeSwitch } from "@/components/core/theme/theme-switch";
import { SettingsControlItem } from "@/components/settings/control-item";
// hooks
import { useUserProfile } from "@/hooks/store/user";

export const ThemeSwitcher = observer(function ThemeSwitcher(props: {
  option: {
    id: string;
    title: string;
    description: string;
  };
}) {
  // store hooks
  const { data: userProfile, updateUserTheme } = useUserProfile();
  // theme
  const { setTheme, theme, resolvedTheme } = useTheme();
  // translation
  const { t } = useTranslation();
  // derived values
  const currentTheme = useMemo(() => {
    // A fresh account has no saved profile theme, so matching on that alone
    // left this null and the control fell back to its "select your theme"
    // placeholder — which reads as though nothing is set and there is no light
    // mode to choose, even though a theme is very much in effect. Fall back to
    // the provider's active theme ("system" on a fresh account, which is a
    // real option), then to whatever that resolved to.
    // oxlint-disable-next-line no-shadow
    const byValue = (value?: string) => THEME_OPTIONS.find((t) => t.value === value);
    return byValue(userProfile?.theme?.theme) ?? byValue(theme) ?? byValue(resolvedTheme) ?? null;
  }, [userProfile?.theme?.theme, theme, resolvedTheme]);

  const handleThemeChange = useCallback(
    async (themeOption: I_THEME_OPTION) => {
      try {
        setTheme(themeOption.value);

        // If switching to custom theme and user has saved custom colors, apply them immediately
        if (
          themeOption.value === "custom" &&
          userProfile?.theme?.primary &&
          userProfile?.theme?.background &&
          userProfile?.theme?.darkPalette !== undefined
        ) {
          applyCustomTheme(
            userProfile.theme.primary,
            userProfile.theme.background,
            userProfile.theme.darkPalette ? "dark" : "light"
          );
        }

        const updatePromise = updateUserTheme({ theme: themeOption.value });
        setPromiseToast(updatePromise, {
          loading: "Updating theme...",
          success: {
            title: "Theme updated",
            message: () => `Switched to ${themeOption.i18n_label ?? themeOption.value}.`,
          },
          error: {
            title: "Error!",
            message: () => "Failed to update theme. Please try again.",
          },
        });
        await updatePromise;

        // Only the custom theme needs a reload. The built-in themes are pure
        // token swaps behind [data-theme], so setTheme() above has already
        // repainted the whole app — reloading for those just made switching
        // feel broken. The custom theme writes its palette imperatively, so it
        // still gets the full remount until that path is reworked.
        if (themeOption.value === "custom") window.location.reload();
      } catch (error) {
        console.error("Error updating theme:", error);
      }
    },
    [setTheme, updateUserTheme, userProfile]
  );

  if (!userProfile) return null;

  return (
    <>
      <SettingsControlItem
        title={t(props.option.title)}
        description={t(props.option.description)}
        control={
          <ThemeSwitch
            value={currentTheme}
            onChange={(themeOption) => {
              void handleThemeChange(themeOption);
            }}
          />
        }
      />
      {userProfile.theme?.theme === "custom" && <CustomThemeSelector />}
    </>
  );
});
