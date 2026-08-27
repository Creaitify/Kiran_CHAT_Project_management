/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Outlet } from "react-router";
import { observer } from "mobx-react";

/**
 * The Operations app's frame.
 *
 * The same rounded, bordered container every app fills, because that box is the
 * shell's content area rather than any app's chrome. What goes inside is this
 * app's business -- here, a tab bar and five views.
 */
export const OperationsAppShell = observer(function OperationsAppShell() {
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-lg border border-subtle">
      <main className="relative flex h-full w-full flex-col overflow-hidden bg-surface-1">
        <Outlet />
      </main>
    </div>
  );
});
