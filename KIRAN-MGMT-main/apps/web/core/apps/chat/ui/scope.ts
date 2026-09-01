/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * The scope class, for anything that renders through a portal.
 *
 * `tokens.css` registers the shadcn class names globally but supplies their
 * values only under `.kiran-chat-app` -- that split is what stops chat's
 * palette leaking into the rest of apps/web. It also means a subtree mounted
 * outside the pane gets the class names and none of the colours: Radix
 * portals into `document.body`, so `bg-background` on a dialog, `bg-popover`
 * on a menu and `bg-primary` on a tooltip all resolve to an invalid value and
 * paint nothing. The dialog reads as a bordered hole with the wallpaper
 * showing through.
 *
 * Re-declaring the class on the portalled root puts the variables back in
 * scope. It carries `--chat-*` from `../styles.css` too, so `bg-surface` and
 * the `glass` utility work inside a dialog exactly as they do in the pane.
 */
export const CHAT_PORTAL_SCOPE = "kiran-chat-app";
