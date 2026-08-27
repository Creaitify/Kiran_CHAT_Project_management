/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Departments, and the cross-department project links.
 *
 * Two panels on one screen because they are one question: how the work is
 * grouped, and which groups are working on the same thing without saying so.
 *
 * The suggestions panel is the "automatic linking" ask, and the automatic half
 * stops at proposing. Each suggestion carries the sentence explaining it and
 * does nothing until someone accepts — a system that silently asserts how a
 * business is organised is one nobody can correct.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { Building, Check, Plus, Trash2, X } from "lucide-react";
// hooks
import { useProject } from "@/hooks/store/use-project";
// local imports
import { useDepartments, useProjectLinks } from "../use-operations";
import { ProjectPicker } from "./project-picker";
import { Empty, FormError, TableShell, ViewHeader } from "./shared";

export const DepartmentsView = observer(function DepartmentsView({ canManage }: { canManage: boolean }) {
  const departments = useDepartments();
  const links = useProjectLinks();
  const { getProjectById, workspaceProjectIds } = useProject();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingProjects, setEditingProjects] = useState<string | null>(null);

  const submit = () => {
    void (async () => {
      setBusy(true);
      setErrors(null);
      try {
        await departments.create({ name: name.trim(), code: code.trim() });
        setName("");
        setCode("");
        setCreating(false);
        departments.reload();
      } catch (caught) {
        setErrors(caught as Record<string, string[]>);
      } finally {
        setBusy(false);
      }
    })();
  };

  const act = (run: () => Promise<unknown>, reload: () => void) => {
    void (async () => {
      try {
        await run();
      } catch (caught) {
        setErrors(caught as Record<string, string[]>);
      } finally {
        reload();
      }
    })();
  };

  const suggestions = links.data.filter((link) => !link.is_confirmed);
  const confirmed = links.data.filter((link) => link.is_confirmed);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ViewHeader
        title="Departments"
        description="How work is grouped for reporting. A project can belong to more than one — a department that shares a project still spent the time."
        action={
          canManage && (
            <button
              type="button"
              onClick={() => setCreating((open) => !open)}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-11 font-medium text-on-color transition-opacity hover:opacity-90"
            >
              <Plus className="size-3.5" /> New department
            </button>
          )
        }
      />

      <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
        <FormError errors={errors} />

        {creating && (
          <div className="flex flex-col gap-3 rounded-lg border border-subtle bg-surface-2 p-4">
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-11 text-tertiary">Name</span>
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Engineering"
                  className="rounded-md border border-subtle bg-surface-1 px-3 py-1.5 text-13 text-primary outline-none focus-visible:border-primary"
                />
                <FormError errors={errors} field="name" />
              </label>
              <label className="flex w-32 flex-col gap-1">
                <span className="text-11 text-tertiary">Code</span>
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  placeholder="ENG"
                  maxLength={12}
                  className="rounded-md border border-subtle bg-surface-1 px-3 py-1.5 text-13 uppercase text-primary outline-none focus-visible:border-primary"
                />
                <FormError errors={errors} field="code" />
              </label>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!name.trim() || !code.trim() || busy}
                onClick={submit}
                className="rounded-md bg-primary px-3 py-1.5 text-11 font-medium text-on-color disabled:opacity-50"
              >
                {busy ? "Creating…" : "Create"}
              </button>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="rounded-md border border-subtle px-3 py-1.5 text-11 text-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {departments.loading ? null : departments.data.length === 0 ? (
          <Empty>
            No departments yet. They are the dimension cost and hours are reported by — without one, every report
            is workspace-wide.
          </Empty>
        ) : (
          <TableShell
            head={
              <tr>
                <th className="px-4 py-2 text-left font-medium">Department</th>
                <th className="px-4 py-2 text-left font-medium">Projects</th>
                {canManage && <th className="w-12 px-4 py-2" />}
              </tr>
            }
          >
            {departments.data.map((department) => (
              <tr key={department.id} className="border-t border-subtle">
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2">
                    <span className="flex size-6 items-center justify-center rounded bg-layer-transparent-selected text-11 font-semibold text-secondary">
                      {department.code.slice(0, 3)}
                    </span>
                    <span className="text-primary">{department.name}</span>
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  {canManage ? (
                    <button
                      type="button"
                      onClick={() => setEditingProjects(editingProjects === department.id ? null : department.id)}
                      className="text-13 tabular-nums text-secondary underline-offset-2 hover:underline"
                    >
                      {department.project_count} — edit
                    </button>
                  ) : (
                    <span className="tabular-nums text-secondary">{department.project_count}</span>
                  )}
                </td>
                {canManage && (
                  <td className="px-4 py-2.5">
                    <button
                      type="button"
                      aria-label={`Delete ${department.name}`}
                      onClick={() => act(() => departments.remove(department.id), departments.reload)}
                      className="text-icon-tertiary transition-colors hover:text-danger-primary"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </TableShell>
        )}

        {editingProjects && (
          <ProjectPicker
            departmentId={editingProjects}
            projectIds={workspaceProjectIds ?? []}
            nameOf={(id) => getProjectById(id)?.name ?? "Untitled project"}
            onSave={async (selected) => {
              await departments.setProjects(editingProjects, selected);
              setEditingProjects(null);
              departments.reload();
            }}
            onCancel={() => setEditingProjects(null)}
          />
        )}

        {/* -------------------------------------------------- suggestions */}
        <section className="flex flex-col gap-2">
          <h3 className="text-13 font-medium text-secondary">Suggested cross-department links</h3>
          <p className="max-w-prose text-11 text-tertiary">
            Proposed nightly when projects in different departments share three or more people. Nothing is asserted
            until you accept it.
          </p>
          {links.loading ? null : suggestions.length === 0 ? (
            <Empty>Nothing proposed. This fills in as people start working across departments.</Empty>
          ) : (
            <ul className="flex flex-col gap-2">
              {suggestions.map((link) => (
                <li
                  key={link.id}
                  className="flex items-center gap-3 rounded-lg border border-subtle bg-surface-2 px-4 py-3"
                >
                  <Building className="size-4 shrink-0 text-icon-tertiary" />
                  <span className="flex flex-1 flex-col gap-0.5">
                    <span className="text-13 text-primary">
                      {link.source_name} ↔ {link.target_name}
                    </span>
                    {/* Rendered verbatim: the sweep writes this for a person. */}
                    <span className="text-11 text-tertiary">{link.rationale}</span>
                  </span>
                  <button
                    type="button"
                    aria-label="Accept"
                    onClick={() => act(() => links.confirm(link.id), links.reload)}
                    className="flex size-7 items-center justify-center rounded-md text-icon-tertiary transition-colors hover:bg-layer-transparent-hover hover:text-primary"
                  >
                    <Check className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Dismiss"
                    onClick={() => act(() => links.reject(link.id), links.reload)}
                    className="flex size-7 items-center justify-center rounded-md text-icon-tertiary transition-colors hover:bg-layer-transparent-hover hover:text-danger-primary"
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {confirmed.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-13 font-medium text-secondary">Linked projects</h3>
            <ul className="flex flex-col gap-1">
              {confirmed.map((link) => (
                <li key={link.id} className="flex items-center gap-2 text-13 text-secondary">
                  <span className="text-primary">{link.source_name}</span>
                  <span className="text-11 text-tertiary">{link.kind.replace("_", " ")}</span>
                  <span className="text-primary">{link.target_name}</span>
                  <button
                    type="button"
                    aria-label="Unlink"
                    onClick={() => act(() => links.reject(link.id), links.reload)}
                    className="ml-auto text-icon-tertiary transition-colors hover:text-danger-primary"
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
