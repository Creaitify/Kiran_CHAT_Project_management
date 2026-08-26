/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * The theme the app falls back to when nobody has chosen one: a fresh browser,
 * and every path that deliberately drops a preference (sign-out, account
 * switch).
 *
 * It lives here rather than as a literal in the provider because the sign-out
 * paths used to hardcode their own value. They reset to "system", which quietly
 * outranked the provider's default — sign out on a machine set to dark and the
 * sign-in page came back dark. One constant, several call sites, no drift.
 */
export const DEFAULT_THEME = "light";

/** Where next-themes persists the active theme. Its own default key name. */
export const THEME_STORAGE_KEY = "theme";

/**
 * Marks that the one-time default migration has run for this browser.
 *
 * `defaultTheme` only applies when nothing is stored, so returning users kept a
 * persisted "system" from when that was the default and carried on following
 * their OS. That value was never a choice anyone made — it was the old default
 * that happened to get written down — so it is migrated once, and only when it
 * is exactly "system". An explicit dark, light or contrast selection is never
 * touched, and picking "system" deliberately after the migration survives,
 * because the key is already stamped by then.
 *
 * Bump the value to run a future migration; do not reuse it for anything else.
 */
export const THEME_MIGRATION_KEY = "theme_default_migration";
export const THEME_MIGRATION_VERSION = "1";
