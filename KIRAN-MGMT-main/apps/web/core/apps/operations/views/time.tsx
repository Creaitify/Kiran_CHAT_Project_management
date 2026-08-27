/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Logging time, and reading back what you logged.
 *
 * The composer accepts "7h 30m", "7.5h" or "90" because people type all three;
 * `parseDuration` reads a bare number as *minutes*, which is the reading that
 * fails safe — "30" meaning thirty hours would sail past the server's 14-hour
 * guard looking entirely plausible.
 *
 * Everyone sees their own entries here. An admin can widen the view by member
 * through the API, but this screen deliberately does not offer it: a timesheet
 * is a record of how a person spent their week, and a colleague browsing it
 * changes what people write down.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { Plus, Trash2 } from "lucide-react";
// hooks
import { useProject } from "@/hooks/store/use-project";
// local imports
import { formatDay, formatMinutes, isoToday, parseDuration } from "../format";
import { useTimeEntries, type TDateRange } from "../use-operations";
import { Empty, FormError, RangeControls, Stat, TableShell, ViewHeader } from "./shared";

export const TimeView = observer(function TimeView({
  range,
  onRangeChange,
}: {
  range: TDateRange;
  onRangeChange: (range: TDateRange) => void;
}) {
  const entries = useTimeEntries(range);
  const { getProjectById, workspaceProjectIds } = useProject();

  const [project, setProject] = useState("");
  const [duration, setDuration] = useState("");
  const [spentOn, setSpentOn] = useState(isoToday());
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null);
  const [busy, setBusy] = useState(false);

  const minutes = parseDuration(duration);
  const canSubmit = Boolean(project) && minutes !== null && minutes > 0 && !busy;

  const submit = () => {
    if (minutes === null) return;
    void (async () => {
      setBusy(true);
      setErrors(null);
      try {
        await entries.log({ project, spent_on: spentOn, minutes, note: note.trim() });
        setDuration("");
        setNote("");
        entries.reload();
      } catch (caught) {
        setErrors(caught as Record<string, string[]>);
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ViewHeader
        title="Time"
        description="Your hours. Logged against a project, and optionally a day other than today."
        action={<RangeControls start={range.start} end={range.end} onChange={onRangeChange} />}
      />

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
        {/* ------------------------------------------------------ composer */}
        <div className="flex flex-col gap-3 rounded-lg border border-subtle bg-surface-2 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-48 flex-1 flex-col gap-1">
              <span className="text-11 text-tertiary">Project</span>
              <select
                value={project}
                onChange={(event) => setProject(event.target.value)}
                className="rounded-md border border-subtle bg-surface-1 px-3 py-1.5 text-13 text-primary outline-none focus-visible:border-primary"
              >
                <option value="">Pick a project…</option>
                {(workspaceProjectIds ?? []).map((id) => (
                  <option key={id} value={id}>
                    {getProjectById(id)?.name ?? "Untitled project"}
                  </option>
                ))}
              </select>
              <FormError errors={errors} field="project" />
            </label>

            <label className="flex w-32 flex-col gap-1">
              <span className="text-11 text-tertiary">Time</span>
              <input
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
                placeholder="1h 30m"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && canSubmit) submit();
                }}
                className="rounded-md border border-subtle bg-surface-1 px-3 py-1.5 text-13 text-primary outline-none focus-visible:border-primary"
              />
              {/* Echoes the parse back, so a mistyped duration is visible before
                  it is submitted rather than after it is in a total. */}
              <span className="text-11 text-tertiary">
                {duration.trim() === ""
                  ? "1h 30m, 1.5h or 90"
                  : minutes === null
                    ? "Not a duration"
                    : formatMinutes(minutes)}
              </span>
            </label>

            <label className="flex w-40 flex-col gap-1">
              <span className="text-11 text-tertiary">Day</span>
              <input
                type="date"
                value={spentOn}
                max={isoToday()}
                onChange={(event) => setSpentOn(event.target.value)}
                className="rounded-md border border-subtle bg-surface-1 px-3 py-1.5 text-13 text-primary outline-none focus-visible:border-primary"
              />
              <FormError errors={errors} field="spent_on" />
            </label>

            <label className="flex min-w-48 flex-1 flex-col gap-1">
              <span className="text-11 text-tertiary">Note (optional)</span>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Design review"
                className="rounded-md border border-subtle bg-surface-1 px-3 py-1.5 text-13 text-primary outline-none focus-visible:border-primary"
              />
            </label>

            <button
              type="button"
              disabled={!canSubmit}
              onClick={submit}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-11 font-medium text-on-color disabled:opacity-50"
            >
              <Plus className="size-3.5" /> {busy ? "Logging…" : "Log time"}
            </button>
          </div>
          <FormError errors={errors} />
          <FormError errors={errors} field="minutes" />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Logged in range" value={formatMinutes(entries.data.total_minutes)} />
          <Stat label="Entries" value={String(entries.data.items.length)} />
          <Stat
            label="Daily average"
            value={formatMinutes(
              Math.round(entries.data.total_minutes / Math.max(1, daysBetween(range.start, range.end)))
            )}
            hint={`over ${daysBetween(range.start, range.end)} days`}
          />
        </div>

        {entries.loading ? null : entries.data.items.length === 0 ? (
          <Empty>Nothing logged in this range.</Empty>
        ) : (
          <TableShell
            head={
              <tr>
                <th className="px-4 py-2 text-left font-medium">Day</th>
                <th className="px-4 py-2 text-left font-medium">Project</th>
                <th className="px-4 py-2 text-left font-medium">Note</th>
                <th className="px-4 py-2 text-right font-medium">Time</th>
                <th className="w-12 px-4 py-2" />
              </tr>
            }
          >
            {entries.data.items.map((entry) => (
              <tr key={entry.id} className="border-t border-subtle">
                <td className="whitespace-nowrap px-4 py-2.5 text-secondary">{formatDay(entry.spent_on)}</td>
                <td className="px-4 py-2.5 text-primary">{entry.project_name}</td>
                <td className="px-4 py-2.5 text-tertiary">{entry.note || "—"}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-primary">
                  {formatMinutes(entry.minutes)}
                </td>
                <td className="px-4 py-2.5">
                  <button
                    type="button"
                    aria-label="Delete entry"
                    onClick={() => {
                      void entries.remove(entry.id).finally(entries.reload);
                    }}
                    className="text-icon-tertiary transition-colors hover:text-danger-primary"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </TableShell>
        )}
      </div>
    </div>
  );
});

/** Inclusive, so a single-day range is 1 rather than 0 — and never divides by zero. */
function daysBetween(start: string, end: string): number {
  const from = Date.parse(`${start}T00:00:00`);
  const to = Date.parse(`${end}T00:00:00`);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return 1;
  return Math.round((to - from) / 86_400_000) + 1;
}
