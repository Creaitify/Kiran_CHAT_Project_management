/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Outlet } from "react-router";
import { observer } from "mobx-react";

/**
 * The Hello app's frame.
 *
 * Deliberately a sibling of the Projects frame rather than a child of it: an
 * app owns everything inside the shell's content area, including whether it
 * has a sidebar. Projects has one; Hello doesn't. That difference is the point
 * -- if the shell were imposing a layout, this file could not exist.
 *
 * The outer rounded, bordered container matches Projects because that border is
 * the shell's content area, not the app's chrome.
 */
export const HelloAppShell = observer(function HelloAppShell() {
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-lg border border-subtle">
      <main className="relative flex h-full w-full flex-col overflow-hidden bg-surface-1">
        <Outlet />
      </main>
    </div>
  );
});
