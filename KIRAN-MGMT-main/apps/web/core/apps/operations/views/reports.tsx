/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Weekly report schedules, and what they have produced.
 *
 * `Preview` runs the same summariser the beat does, over the last complete week,
 * without saving. It exists so nobody has to wait seven days to discover their
 * schedule was pointed at the wrong department.
 *
 * A report covers the last week that actually *finished*. Including the current,
 * partial week would show a number that is always lower than the real one and
 * always changing, which is how people learn to distrust a report.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { CalendarClock, Eye, Plus, Trash2 } from "lucide-react";
// local imports
import { formatMinutes, formatMoney } from "../format";
import { useDepartments, useReportRuns, useReportSchedules } from "../use-operations";
import { Empty, FormError, TableShell, ViewHeader } from "./shared";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type TPreview = {
  period_start: string;
  period_end: string;
  payload: { totals: { minutes: number; cost_minor: number }; currency: string };
};

export const ReportsView = observer(function ReportsView({ canManage }: { canManage: boolean }) {
  const schedules = useReportSchedules();
  const runs = useReportRuns();
  const departments = useDepartments();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [weekday, setWeekday] = useState(0);
  const [department, setDepartment] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ id: string; data: TPreview } | null>(null);

  const submit = () => {
    void (async () => {
      setBusy(true);
      setErrors(null);
      try {
        await schedules.create({
          name: name.trim(),
          send_weekday: weekday,
          ...(department ? { department } : {}),
        });
        setName("");
        setDepartment("");
        setCreating(false);
        schedules.reload();
      } catch (caught) {
        setErrors(caught as Record<string, string[]>);
      } finally {
        setBusy(false);
      }
    })();
  };

  const runPreview = (id: string) => {
    void (async () => {
      setErrors(null);
      try {
        const data = (await schedules.preview(id)) as TPreview;
        setPreview({ id, data });
      } catch (caught) {
        setErrors(caught as Record<string, string[]>);
      }
    })();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ViewHeader
        title="Weekly reports"
        description="Generated for the last complete week and delivered to each recipient's notifications."
        action={
          canManage && (
            <button
              type="button"
              onClick={() => setCreating((open) => !open)}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-11 font-medium text-on-color transition-opacity hover:opacity-90"
            >
              <Plus className="size-3.5" /> New schedule
            </button>
          )
        }
      />

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
        <FormError errors={errors} />

        {creating && (
          <div className="flex flex-col gap-3 rounded-lg border border-subtle bg-surface-2 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-48 flex-1 flex-col gap-1">
                <span className="text-11 text-tertiary">Name</span>
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Engineering weekly"
                  className="rounded-md border border-subtle bg-surface-1 px-3 py-1.5 text-13 text-primary outline-none focus-visible:border-primary"
                />
                <FormError errors={errors} field="name" />
              </label>
              <label className="flex w-40 flex-col gap-1">
                <span className="text-11 text-tertiary">Send on</span>
                <select
                  value={weekday}
                  onChange={(event) => setWeekday(Number(event.target.value))}
                  className="rounded-md border border-subtle bg-surface-1 px-3 py-1.5 text-13 text-primary outline-none focus-visible:border-primary"
                >
                  {WEEKDAYS.map((day, index) => (
                    <option key={day} value={index}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex w-48 flex-col gap-1">
                <span className="text-11 text-tertiary">Scope</span>
                <select
                  value={department}
                  onChange={(event) => setDepartment(event.target.value)}
                  className="rounded-md border border-subtle bg-surface-1 px-3 py-1.5 text-13 text-primary outline-none focus-visible:border-primary"
                >
                  <option value="">Whole workspace</option>
                  {departments.data.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} — {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={!name.trim() || busy}
                onClick={submit}
                className="rounded-md bg-primary px-3 py-2 text-11 font-medium text-on-color disabled:opacity-50"
              >
                {busy ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        )}

        {schedules.loading ? null : schedules.data.length === 0 ? (
          <Empty>
            No schedules yet. A schedule summarises hours and cost for a department, or the whole workspace, once
            a week.
          </Empty>
        ) : (
          <TableShell
            head={
              <tr>
                <th className="px-4 py-2 text-left font-medium">Report</th>
                <th className="px-4 py-2 text-left font-medium">Sends</th>
                <th className="px-4 py-2 text-left font-medium">Recipients</th>
                <th className="px-4 py-2 text-left font-medium">Last run</th>
                <th className="w-24 px-4 py-2" />
              </tr>
            }
          >
            {schedules.data.map((schedule) => (
              <tr key={schedule.id} className="border-t border-subtle">
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2">
                    <CalendarClock className="size-3.5 text-icon-tertiary" />
                    <span className="text-primary">{schedule.name}</span>
                    {!schedule.is_active && <span className="text-11 text-tertiary">paused</span>}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-secondary">{WEEKDAYS[schedule.send_weekday] ?? "—"}</td>
                <td className="px-4 py-2.5 tabular-nums text-secondary">{schedule.recipient_ids.length}</td>
                <td className="px-4 py-2.5 text-tertiary">{schedule.last_run_for ?? "never"}</td>
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Preview ${schedule.name}`}
                      onClick={() => runPreview(schedule.id)}
                      className="text-icon-tertiary transition-colors hover:text-primary"
                    >
                      <Eye className="size-3.5" />
                    </button>
                    {canManage && (
                      <button
                        type="button"
                        aria-label={`Delete ${schedule.name}`}
                        onClick={() => {
                          void schedules.remove(schedule.id).finally(schedules.reload);
                        }}
                        className="text-icon-tertiary transition-colors hover:text-danger-primary"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </TableShell>
        )}

        {preview && (
          <div className="flex flex-col gap-1 rounded-lg border border-subtle bg-surface-2 p-4">
            <span className="text-11 uppercase tracking-wide text-tertiary">
              Preview · {preview.data.period_start} to {preview.data.period_end}
            </span>
            <span className="text-16 font-medium text-primary">
              {formatMinutes(preview.data.payload.totals.minutes)} ·{" "}
              {formatMoney(preview.data.payload.totals.cost_minor, preview.data.payload.currency)}
            </span>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="mt-2 self-start rounded-md border border-subtle px-3 py-1 text-11 text-secondary"
            >
              Close
            </button>
          </div>
        )}

        <section className="flex flex-col gap-2">
          <h3 className="text-13 font-medium text-secondary">Past runs</h3>
          {runs.loading ? null : runs.data.length === 0 ? (
            <Empty>Nothing generated yet. The first run happens on the schedule&apos;s next send day.</Empty>
          ) : (
            <ul className="flex flex-col gap-1">
              {runs.data.map((run) => (
                <li
                  key={run.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-md border border-subtle px-4 py-2"
                >
                  <span className="text-13 text-primary">{run.schedule_name ?? "Deleted schedule"}</span>
                  <span className="text-11 text-tertiary">
                    {run.period_start} to {run.period_end}
                  </span>
                  <span className="ml-auto text-13 tabular-nums text-secondary">
                    {formatMinutes(run.payload?.totals?.minutes ?? 0)} ·{" "}
                    {formatMoney(run.payload?.totals?.cost_minor ?? 0, run.payload?.currency ?? "INR")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
});
