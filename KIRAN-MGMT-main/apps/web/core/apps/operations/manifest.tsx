/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { GaugeIcon } from "lucide-react";
import type { TAppManifest } from "../types";
import {
  useOperationsBacklinks,
  useOperationsBadge,
  useOperationsPowerKCommands,
} from "./contributions";

/**
 * Operations -- departments, time, cost, weekly reports and reminders.
 *
 * The five project-management asks from Scope.pdf, and one app rather than five
 * features bolted onto Projects. They are one domain: a department is the unit
 * work is grouped by, time is what people spend on it, cost is time priced, a
 * weekly report is those three summarised, and a reminder is the nudge that
 * keeps any of it moving.
 *
 * Building it as an app rather than inside Projects is the point of having a
 * module system. Projects gained one thing from this work -- `entityLinks`, so
 * its work items can be referenced -- and nothing else in it moved.
 *
 * No `isAvailable` gate. Logging your own time and setting your own reminders is
 * everyone's business; the surfaces that are not (rates, cost, department
 * editing) are gated per-endpoint at ADMIN, which is the level the question
 * actually belongs at.
 *
 * The first app to use all three contributions.
 */
export const operationsAppManifest: TAppManifest = {
  key: "operations",
  label: "Operations",
  icon: <GaugeIcon className="size-5" />,
  path: (workspaceSlug) => `/${workspaceSlug}/operations`,
  matches: (pathname, workspaceSlug) => pathname.startsWith(`/${workspaceSlug}/operations`),
  order: 400,
  keySequence: "ao",
  keywords: ["time", "cost", "department", "report", "reminder", "timesheet", "budget"],
  useBadge: useOperationsBadge,
  usePowerKCommands: useOperationsPowerKCommands,
  useBacklinks: useOperationsBacklinks,
};
