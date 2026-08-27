/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Your reminders.
 *
 * Yours only — there is no "remind Priya about this" here, and that is a
 * decision rather than an omission: a nudge you did not ask for, arriving from a
 * colleague, is a task assignment wearing a notification's clothes, and KIRAN
 * already has task assignment.
 *
 * A reminder points at `{entity_kind, entity_id}`, the same shape as a
 * cross-app reference. Nothing here knows what a work item is, which is why the
 * work item's own sidebar can show these without either side importing the
 * other.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { BellRing, Check, Clock, Plus, Trash2 } from "lucide-react";
// apps
import { WORK_ITEM_KIND } from "../../projects/entity-links";
// local imports
import { refreshDueReminders } from "../contributions";
import { useReminders } from "../use-operations";
import { Empty, FormError, ViewHeader } from "./shared";
import { useAppContext } from "../../use-app-context";

/** Local datetime, formatted for `<input type="datetime-local">`. */
function localDateTime(offsetMinutes: number): string {
  const when = new Date(Date.now() + offsetMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

export const RemindersView = observer(function RemindersView() {
  const { workspaceSlug } = useAppContext();
  const reminders = useReminders();

  const [note, setNote] = useState("");
  // Defaults to a work item, because that is what people set reminders on. The
  // field is free text rather than a picker: paste an identifier, and the
  // reminder points at it without this screen having to know what it is.
  const [entityId, setEntityId] = useState("");
  const [remindAt, setRemindAt] = useState(() => localDateTime(60));
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = () => {
    void (async () => {
      setBusy(true);
      setErrors(null);
      try {
        await reminders.create({
          entity_kind: WORK_ITEM_KIND,
          entity_id: entityId.trim().toUpperCase(),
          entity_label: entityId.trim().toUpperCase(),
          note: note.trim(),
          // `datetime-local` has no zone; the browser's own offset is the one
          // the person meant when they picked a wall-clock time.
          remind_at: new Date(remindAt).toISOString(),
        });
        setNote("");
        setEntityId("");
        reminders.reload();
        refreshDueReminders(workspaceSlug);
      } catch (caught) {
        setErrors(caught as Record<string, string[]>);
      } finally {
        setBusy(false);
      }
    })();
  };

  const act = (run: () => Promise<unknown>) => {
    void (async () => {
      try {
        await run();
      } catch (caught) {
        setErrors(caught as Record<string, string[]>);
      } finally {
        reminders.reload();
        refreshDueReminders(workspaceSlug);
      }
    })();
  };

  const pending = reminders.data.items.filter((item) => item.state === "pending");
  const past = reminders.data.items.filter((item) => item.state !== "pending");

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ViewHeader
        title="Reminders"
        description="Private to you, delivered to your notifications. Set one on a work item by its identifier — KIR-42."
      />

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
        <div className="flex flex-col gap-3 rounded-lg border border-subtle bg-surface-2 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex w-36 flex-col gap-1">
              <span className="text-11 text-tertiary">Work item</span>
              <input
                value={entityId}
                onChange={(event) => setEntityId(event.target.value.toUpperCase())}
                placeholder="KIR-42"
                className="rounded-md border border-subtle bg-surface-1 px-3 py-1.5 text-13 uppercase text-primary outline-none focus-visible:border-primary"
              />
              <FormError errors={errors} field="entity_id" />
            </label>
            <label className="flex min-w-48 flex-1 flex-col gap-1">
              <span className="text-11 text-tertiary">Remind me to…</span>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Follow up on the estimate"
                className="rounded-md border border-subtle bg-surface-1 px-3 py-1.5 text-13 text-primary outline-none focus-visible:border-primary"
              />
            </label>
            <label className="flex w-56 flex-col gap-1">
              <span className="text-11 text-tertiary">When</span>
              <input
                type="datetime-local"
                value={remindAt}
                onChange={(event) => setRemindAt(event.target.value)}
                className="rounded-md border border-subtle bg-surface-1 px-3 py-1.5 text-13 text-primary outline-none focus-visible:border-primary"
              />
              <FormError errors={errors} field="remind_at" />
            </label>
            <button
              type="button"
              disabled={!entityId.trim() || busy}
              onClick={submit}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-11 font-medium text-on-color disabled:opacity-50"
            >
              <Plus className="size-3.5" /> {busy ? "Setting…" : "Set reminder"}
            </button>
          </div>
          <FormError errors={errors} />
        </div>

        <section className="flex flex-col gap-2">
          <h3 className="text-13 font-medium text-secondary">
            Pending{reminders.data.due_count > 0 && ` · ${reminders.data.due_count} due`}
          </h3>
          {reminders.loading ? null : pending.length === 0 ? (
            <Empty>Nothing pending.</Empty>
          ) : (
            <ul className="flex flex-col gap-1">
              {pending.map((reminder) => (
                <li
                  key={reminder.id}
                  className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${
                    reminder.is_due ? "border-danger-primary/40 bg-danger-transparent" : "border-subtle"
                  }`}
                >
                  <BellRing
                    className={`size-4 shrink-0 ${reminder.is_due ? "text-danger-primary" : "text-icon-tertiary"}`}
                  />
                  <span className="flex flex-1 flex-col gap-0.5">
                    <span className="text-13 text-primary">{reminder.note || "Reminder"}</span>
                    <span className="text-11 text-tertiary">
                      {reminder.entity_label || reminder.entity_id} ·{" "}
                      {new Date(reminder.remind_at).toLocaleString()}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label="Snooze one day"
                    title="Snooze one day"
                    onClick={() =>
                      act(() =>
                        reminders.snooze(
                          reminder.id,
                          new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
                        )
                      )
                    }
                    className="flex size-7 items-center justify-center rounded-md text-icon-tertiary transition-colors hover:bg-layer-transparent-hover hover:text-primary"
                  >
                    <Clock className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Mark done"
                    onClick={() => act(() => reminders.dismiss(reminder.id))}
                    className="flex size-7 items-center justify-center rounded-md text-icon-tertiary transition-colors hover:bg-layer-transparent-hover hover:text-primary"
                  >
                    <Check className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {past.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-13 font-medium text-secondary">Done</h3>
            <ul className="flex flex-col gap-1">
              {past.map((reminder) => (
                <li key={reminder.id} className="flex items-center gap-3 px-4 py-1.5">
                  <span className="flex-1 text-13 text-tertiary line-through">
                    {reminder.note || "Reminder"}
                  </span>
                  <button
                    type="button"
                    aria-label="Delete"
                    onClick={() => act(() => reminders.remove(reminder.id))}
                    className="text-icon-tertiary transition-colors hover:text-danger-primary"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
});
