/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * The handful of pieces all five operations views share.
 *
 * Small and local rather than reached for from the design system, because each
 * is a layout decision about *these* screens — a stat tile that leads with a
 * number, an empty state that explains rather than apologises. Anything here
 * that turns out to be general belongs in propel, not in a second component
 * library living in an app.
 */

import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";

export function ViewHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-subtle px-6 py-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-16 font-medium text-primary">{title}</h2>
        {description && <p className="max-w-prose text-11 text-tertiary">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/**
 * A number with its label under it.
 *
 * `tabular-nums` because these sit in a row and a column of digits that shifts
 * as values change reads as noise. The design system sets it globally; it is
 * repeated here because this component is the reason it matters.
 */
export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-subtle bg-surface-2 px-4 py-3">
      <span className="text-11 uppercase tracking-wide text-tertiary">{label}</span>
      <span className="text-20 font-semibold tabular-nums text-primary">{value}</span>
      {hint && <span className="text-11 text-tertiary">{hint}</span>}
    </div>
  );
}

/** Says what would be here and how to make it appear. Never "no data". */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-subtle px-4 py-10 text-center text-13 text-tertiary">
      {children}
    </p>
  );
}

/**
 * Server-side errors, rendered where they belong.
 *
 * A field error goes next to its input; this is for the form-level ones the API
 * returns under `error`, and for anything unrecognised.
 */
export function FormError({ errors, field = "__form" }: { errors: Record<string, string[]> | null; field?: string }) {
  const message = errors?.[field]?.[0];
  if (!message) return null;
  return (
    <p className="flex items-start gap-1.5 text-11 text-danger-primary">
      <AlertCircle className="mt-px size-3.5 shrink-0" />
      {message}
    </p>
  );
}

/**
 * A range picker that is two date inputs.
 *
 * Deliberately not a calendar widget with presets. Every operations screen is
 * read against a period the reader already has in mind — a month, a quarter, the
 * week someone asked about — and typing it is faster than navigating to it.
 */
export function RangeControls({
  start,
  end,
  onChange,
}: {
  start: string;
  end: string;
  onChange: (range: { start: string; end: string }) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-1.5 text-11 text-tertiary">
        From
        <input
          type="date"
          value={start}
          max={end}
          onChange={(event) => onChange({ start: event.target.value, end })}
          className="rounded-md border border-subtle bg-surface-2 px-2 py-1 text-11 text-primary outline-none focus-visible:border-primary"
        />
      </label>
      <label className="flex items-center gap-1.5 text-11 text-tertiary">
        to
        <input
          type="date"
          value={end}
          min={start}
          onChange={(event) => onChange({ start, end: event.target.value })}
          className="rounded-md border border-subtle bg-surface-2 px-2 py-1 text-11 text-primary outline-none focus-visible:border-primary"
        />
      </label>
    </div>
  );
}

export function TableShell({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    // The page must never scroll sideways, so a wide table scrolls inside itself.
    <div className="overflow-x-auto rounded-lg border border-subtle">
      <table className="w-full text-13">
        <thead className="bg-surface-2 text-11 uppercase tracking-wide text-tertiary">{head}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
