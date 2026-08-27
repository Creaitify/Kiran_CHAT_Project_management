/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Which projects belong to a department.
 *
 * Sends the whole set rather than adds and removes, matching the endpoint —
 * "which projects are engineering's" is one decision, and sending it in one
 * request is what makes it atomic.
 *
 * It opens with nothing selected rather than pre-loading the department's
 * current projects, and says so. Fetching the current set would mean a second
 * request whose only job is to be immediately editable, and the honest label is
 * cheaper than the round trip.
 */

import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";

export function ProjectPicker({
  departmentId,
  projectIds,
  nameOf,
  onSave,
  onCancel,
}: {
  departmentId: string;
  projectIds: string[];
  nameOf: (id: string) => string;
  onSave: (selected: string[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const matches = useMemo(
    () => projectIds.filter((id) => nameOf(id).toLowerCase().includes(query.toLowerCase())),
    [projectIds, nameOf, query]
  );

  const toggle = (id: string) =>
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-subtle bg-surface-2 p-4" key={departmentId}>
      <p className="text-11 text-tertiary">
        Pick the projects for this department. This replaces its current list — anything not selected is removed.
      </p>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-icon-tertiary" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search projects…"
          className="w-full rounded-md border border-subtle bg-surface-1 py-1.5 pl-9 pr-3 text-13 text-primary outline-none focus-visible:border-primary"
        />
      </div>

      <div className="max-h-56 overflow-y-auto">
        {matches.length === 0 ? (
          <p className="px-2 py-6 text-center text-11 text-tertiary">No projects match.</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {matches.map((id) => {
              const isSelected = selected.includes(id);
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => toggle(id)}
                    className={`flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left transition-colors ${
                      isSelected ? "bg-layer-transparent-selected" : "hover:bg-layer-transparent-hover"
                    }`}
                  >
                    <span
                      className={`flex size-4 items-center justify-center rounded border ${
                        isSelected ? "border-primary bg-primary" : "border-subtle"
                      }`}
                    >
                      {isSelected && <Check className="size-3 text-on-color" />}
                    </span>
                    <span className="truncate text-13 text-primary">{nameOf(id)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onSave(selected).finally(() => setBusy(false));
          }}
          className="rounded-md bg-primary px-3 py-1.5 text-11 font-medium text-on-color disabled:opacity-50"
        >
          {busy ? "Saving…" : `Save ${selected.length} project${selected.length === 1 ? "" : "s"}`}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-subtle px-3 py-1.5 text-11 text-secondary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
