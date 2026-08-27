/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// KCMS imports
import { joinUrlPath } from "@plane/utils";
// local imports
import type { TPowerKContext } from "../core/types";

/**
 * Navigate from a command, given the destination as path segments.
 *
 * A query string or hash on the last segment survives. That is not free
 * behaviour: `joinUrlPath` normalises by returning `new URL(...).pathname`,
 * which silently discards everything after the `?`. Every command written
 * before app contributions existed passed bare path segments, so nothing ever
 * noticed — and then the first two apps to contribute a deep link (chat jumping
 * into a room, notes jumping to a note) both lost their target and landed on
 * the app's default screen instead.
 *
 * Splitting the suffix off before joining and re-attaching it after keeps the
 * normalisation doing its job on the path, which is all it was ever for.
 */
export const handlePowerKNavigate = (context: TPowerKContext, routerSegments: (string | undefined)[]) => {
  const validRouterSegments = routerSegments.filter((segment) => segment !== undefined);

  if (validRouterSegments.length === 0) {
    console.warn("No valid router segments provided", routerSegments);
    return;
  }

  if (validRouterSegments.length !== routerSegments.length) {
    console.warn("Some of the router segments are undefined", routerSegments);
  }

  // Only the last segment may carry one; a `?` in the middle of a path is a
  // caller error, not a query, and joining would have mangled it either way.
  const lastIndex = validRouterSegments.length - 1;
  const last = validRouterSegments[lastIndex] ?? "";
  const suffixAt = last.search(/[?#]/);

  if (suffixAt === -1) {
    context.router.push(joinUrlPath(...validRouterSegments));
    return;
  }

  const segments = [...validRouterSegments];
  segments[lastIndex] = last.slice(0, suffixAt);
  context.router.push(`${joinUrlPath(...segments)}${last.slice(suffixAt)}`);
};
