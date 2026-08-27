/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Operations, as five tabs.
 *
 * The tab lives in `?tab=`, not in component state, so a palette jump can land
 * on a specific view and a link to "the cost screen" is a link somebody can
 * send. `?department=` rides along for the same reason.
 *
 * `Cost` and the rate editor are workspace-ADMIN only, and the tab is hidden
 * rather than shown-and-refused: offering a screen that answers 403 teaches
 * people the product is broken. The endpoints gate it regardless — this is the
 * UI agreeing with the server, not enforcing anything.
 */

import { useCallback, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useSearchParams } from "next/navigation";
import { Building, Clock, IndianRupee, CalendarClock, BellRing } from "lucide-react";
// components
import { PageHead } from "@/components/core/page-title";
// constants
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
// hooks
import { useUserPermissions } from "@/hooks/store/user";
// apps
import { useAppContext } from "../use-app-context";
// local imports
import { useDefaultRange, type TDateRange } from "./use-operations";
import { CostView } from "./views/cost";
import { DepartmentsView } from "./views/departments";
import { RemindersView } from "./views/reminders";
import { ReportsView } from "./views/reports";
import { TimeView } from "./views/time";

const TABS = [
  { key: "departments", label: "Departments", icon: Building, adminOnly: false },
  { key: "time", label: "Time", icon: Clock, adminOnly: false },
  { key: "cost", label: "Cost", icon: IndianRupee, adminOnly: true },
  { key: "reports", label: "Reports", icon: CalendarClock, adminOnly: false },
  { key: "reminders", label: "Reminders", icon: BellRing, adminOnly: false },
] as const;

type TTabKey = (typeof TABS)[number]["key"];

export const OperationsAppPage = observer(function OperationsAppPage() {
  const { workspaceSlug, router } = useAppContext();
  const searchParams = useSearchParams();
  const { allowPermissions } = useUserPermissions();

  const canManage = allowPermissions(
    [EUserPermissions.ADMIN],
    EUserPermissionsLevel.WORKSPACE,
    workspaceSlug
  );

  const visibleTabs = useMemo(() => TABS.filter((tab) => !tab.adminOnly || canManage), [canManage]);

  const requested = searchParams.get("tab") as TTabKey | null;
  const active: TTabKey =
    requested && visibleTabs.some((tab) => tab.key === requested) ? requested : (visibleTabs[0]?.key ?? "time");

  const [range, setRange] = useState<TDateRange>(useDefaultRange());
  const department = searchParams.get("department") ?? "";

  /** Tabs are URL state, so switching one is a navigation. */
  const go = useCallback(
    (tab: TTabKey, extra?: Record<string, string>) => {
      const params = new URLSearchParams({ tab, ...(extra ?? {}) });
      router.push(`/${workspaceSlug}/operations?${params.toString()}`);
    },
    [router, workspaceSlug]
  );

  return (
    <>
      <PageHead title="Operations" />
      <div className="flex h-full w-full flex-col overflow-hidden">
        <nav className="flex shrink-0 gap-1 border-b border-subtle px-4 pt-3" aria-label="Operations sections">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.key === active;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => go(tab.key)}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-13 transition-colors ${
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-tertiary hover:text-secondary"
                }`}
              >
                <Icon className="size-3.5" />
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="flex-1 overflow-hidden">
          {active === "departments" && <DepartmentsView canManage={canManage} />}
          {active === "time" && <TimeView range={range} onRangeChange={setRange} />}
          {active === "cost" && (
            <CostView
              range={range}
              onRangeChange={setRange}
              department={department}
              onDepartmentChange={(id) => go("cost", id ? { department: id } : {})}
            />
          )}
          {active === "reports" && <ReportsView canManage={canManage} />}
          {active === "reminders" && <RemindersView />}
        </div>
      </div>
    </>
  );
});
