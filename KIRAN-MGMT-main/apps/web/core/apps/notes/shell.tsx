/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Outlet } from "react-router";
import { observer } from "mobx-react";

/**
 * The Notes app's frame.
 *
 * Identical in shape to Hello's and to Chat's outer container, which is the
 * point: the rounded, bordered box is the *shell's* content area, and every app
 * fills it the same way. What each app puts inside is its own business — Chat
 * has a sidebar, Notes has a two-pane list/editor, Hello has neither.
 */
export const NotesAppShell = observer(function NotesAppShell() {
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-lg border border-subtle">
      <main className="relative flex h-full w-full flex-col overflow-hidden bg-surface-1">
        <Outlet />
      </main>
    </div>
  );
});
