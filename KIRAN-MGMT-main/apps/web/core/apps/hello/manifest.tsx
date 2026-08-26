/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { SparklesIcon } from "lucide-react";
import type { TAppManifest } from "../types";

/**
 * Hello -- the registry's test case.
 *
 * It exists to prove that a second app needs nothing from the shell: no edit to
 * the rail, the router, the command palette or the permission plumbing. If
 * adding a real app ever requires touching those files, the contract is wrong
 * and this app is where that shows up first.
 *
 * Delete it once Chat and a third app have both landed and the contract has
 * stopped moving.
 */
export const helloAppManifest: TAppManifest = {
  key: "hello",
  label: "Hello",
  icon: <SparklesIcon className="size-5" />,
  path: (workspaceSlug) => `/${workspaceSlug}/hello`,
  matches: (pathname, workspaceSlug) => pathname.startsWith(`/${workspaceSlug}/hello`),
  order: 900,
  keySequence: "ah",
  keywords: ["demo", "example", "registry"],
};
