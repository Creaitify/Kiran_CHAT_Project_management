/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { StickyNoteIcon } from "lucide-react";
import type { TAppManifest } from "../types";
import { useNotesPowerKCommands } from "./contributions";

/**
 * Notes -- the third app, and the measurement Stage 4 actually asked for.
 *
 * Chosen for what it does *not* have. It has no backend, no migration, no
 * serializer and no permission model, because the one Stage 2 constraint nobody
 * had tested was "the contract must not assume a module has a backend, since
 * some will not". `hello` has no backend but also no state; chat has one of the
 * heaviest in the product. This is the case in between: real state, real
 * persistence, real palette entries, zero server.
 *
 * No `isAvailable` gate and no `useBadge`. Notes are personal, so everyone in
 * the workspace gets them; and a count of things you wrote yourself is not a
 * notification. Skipping one contribution while taking the other is itself part
 * of the test.
 */
export const notesAppManifest: TAppManifest = {
  key: "notes",
  label: "Notes",
  icon: <StickyNoteIcon className="size-5" />,
  path: (workspaceSlug) => `/${workspaceSlug}/notes`,
  matches: (pathname, workspaceSlug) => pathname.startsWith(`/${workspaceSlug}/notes`),
  order: 300,
  keySequence: "an",
  keywords: ["note", "scratch", "jot", "memo"],
  usePowerKCommands: useNotesPowerKCommands,
};
