/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Cost — by department, by project, by person.
 *
 * Two things on this screen are deliberate and worth knowing before reading a
 * number off it.
 *
 * **Unpriced hours are shown, never folded in.** Time logged by someone with no
 * rate contributes zero money, and a total that quietly absorbed it would make a
 * half-rated department look cheap. Where it exists, it is called out beside the
 * figure it is missing from.
 *
 * **Department rows sum to more than the workspace total.** A project shared by
 * two departments contributes its hours to both. That is the honest answer to
 * "what did engineering spend" when engineering genuinely shares a project, and
 * the alternative — splitting by an invented ratio — is a number nobody can
 * defend. The screen says so rather than leaving the reader to discover it.
 */

import { observer } from "mobx-react";
import { AlertTriangle } from "lucide-react";
// local imports
import { formatMinutes, formatMoney } from "../format";
import { useCost, useDepartments, type TDateRange } from "../use-operations";
import { Empty, FormError, RangeControls, Stat, TableShell, ViewHeader } from "./shared";

export const CostView = observer(function CostView({
  range,
  onRangeChange,
  department,
  onDepartmentChange,
}: {
  range: TDateRange;
  onRangeChange: (range: TDateRange) => void;
  department: string;
  onDepartmentChange: (id: string) => void;
}) {
  const cost = useCost(range, department || undefined);
  const departments = useDepartments();

  const report = cost.data;
  const currency = report?.currency ?? "INR";
  const unpriced = report?.totals.unpriced_minutes ?? 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ViewHeader
        title="Cost"
        description="Hours priced at the rate in force on the day they were logged. Nothing here is stored — it is recomputed each time, so a corrected rate fixes history."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={department}
              onChange={(event) => onDepartmentChange(event.target.value)}
              aria-label="Department"
              className="rounded-md border border-subtle bg-surface-2 px-2 py-1 text-11 text-primary outline-none focus-visible:border-primary"
            >
              <option value="">All departments</option>
              {departments.data.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} — {item.name}
                </option>
              ))}
            </select>
            <RangeControls start={range.start} end={range.end} onChange={onRangeChange} />
          </div>
        }
      />

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
        <FormError errors={cost.error} />

        {cost.loading || !report ? null : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label="Total cost" value={formatMoney(report.totals.cost_minor, currency)} />
              <Stat label="Hours" value={formatMinutes(report.totals.minutes)} />
              <Stat
                label="Unpriced"
                value={formatMinutes(unpriced)}
                hint={unpriced ? "not included in cost" : "everyone has a rate"}
              />
            </div>

            {unpriced > 0 && (
              <p className="flex items-start gap-2 rounded-lg border border-subtle bg-surface-2 px-4 py-3 text-11 text-secondary">
                <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning-primary" />
                <span>
                  {formatMinutes(unpriced)} were logged by people with no rate set for those dates, so they are
                  counted as hours but not as money. Set a rate to include them.
                </span>
              </p>
            )}

            {/* ------------------------------------------------ departments */}
            <section className="flex flex-col gap-2">
              <h3 className="text-13 font-medium text-secondary">By department</h3>
              <p className="max-w-prose text-11 text-tertiary">
                A project in two departments counts in both, so these add up to more than the total above.
              </p>
              {report.by_department.length === 0 ? (
                <Empty>No departments yet.</Empty>
              ) : (
                <TableShell
                  head={
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Department</th>
                      <th className="px-4 py-2 text-right font-medium">Projects</th>
                      <th className="px-4 py-2 text-right font-medium">Hours</th>
                      <th className="px-4 py-2 text-right font-medium">Cost</th>
                    </tr>
                  }
                >
                  {report.by_department.map((row) => (
                    <tr key={row.department_id} className="border-t border-subtle">
                      <td className="px-4 py-2.5">
                        <span className="text-primary">{row.code}</span>
                        <span className="ml-2 text-tertiary">{row.name}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-secondary">{row.project_count}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-secondary">
                        {formatMinutes(row.minutes)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-primary">
                        {formatMoney(row.cost_minor, currency)}
                      </td>
                    </tr>
                  ))}
                </TableShell>
              )}
            </section>

            {/* --------------------------------------------------- projects */}
            <section className="flex flex-col gap-2">
              <h3 className="text-13 font-medium text-secondary">By project</h3>
              {report.by_project.length === 0 ? (
                <Empty>No time logged in this range.</Empty>
              ) : (
                <TableShell
                  head={
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Project</th>
                      <th className="px-4 py-2 text-right font-medium">Hours</th>
                      <th className="px-4 py-2 text-right font-medium">Cost</th>
                    </tr>
                  }
                >
                  {report.by_project.map((row) => (
                    <tr key={row.project_id} className="border-t border-subtle">
                      <td className="px-4 py-2.5 text-primary">{row.name}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-secondary">
                        {formatMinutes(row.minutes)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-primary">
                        {formatMoney(row.cost_minor, currency)}
                      </td>
                    </tr>
                  ))}
                </TableShell>
              )}
            </section>

            {/* ---------------------------------------------------- people */}
            <section className="flex flex-col gap-2">
              <h3 className="text-13 font-medium text-secondary">By person</h3>
              {report.by_member.length === 0 ? (
                <Empty>No time logged in this range.</Empty>
              ) : (
                <TableShell
                  head={
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Person</th>
                      <th className="px-4 py-2 text-right font-medium">Hours</th>
                      <th className="px-4 py-2 text-right font-medium">Cost</th>
                    </tr>
                  }
                >
                  {report.by_member.map((row) => (
                    <tr key={row.member_id} className="border-t border-subtle">
                      <td className="px-4 py-2.5 text-primary">{row.name}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-secondary">
                        {formatMinutes(row.minutes)}
                        {row.unpriced_minutes > 0 && (
                          <span className="ml-1.5 text-11 text-warning-primary">no rate</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-primary">
                        {formatMoney(row.cost_minor, currency)}
                      </td>
                    </tr>
                  ))}
                </TableShell>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
});
