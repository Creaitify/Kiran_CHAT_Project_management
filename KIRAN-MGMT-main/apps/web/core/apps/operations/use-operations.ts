/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Data hooks for the operations surfaces.
 *
 * Plain `useState` + `useEffect` rather than MobX. Every one of these is a
 * request whose result is rendered once and refetched on an explicit action —
 * there is no shared mutable graph for a store to be the single source of truth
 * about, and a store would be ceremony around five independent lists.
 *
 * The reminder count is the exception and lives in a module-scope cache, because
 * the rail badge needs it from outside this app — the same reason chat's
 * overview does. See `./contributions.ts`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// apps
import { useAppContext } from "../use-app-context";
// local imports
import { isoDaysAgo, isoToday } from "./format";
import {
  OperationsService,
  type TCostReport,
  type TDepartment,
  type TMemberRate,
  type TProjectLink,
  type TReminder,
  type TReportRun,
  type TReportSchedule,
  type TTimeEntry,
} from "./service";

const service = new OperationsService();

/** Shared shape for every fetch-and-render surface below. */
export type TAsync<T> = {
  data: T;
  loading: boolean;
  /** Server-side field errors, or a form-level message under `__form`. */
  error: Record<string, string[]> | null;
  reload: () => void;
};

function asFieldErrors(error: unknown): Record<string, string[]> {
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const body = error as Record<string, unknown>;
    if (typeof body.error === "string") return { __form: [body.error] };
    const out: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(body)) {
      if (Array.isArray(value)) out[key] = value.map(String);
      else if (typeof value === "string") out[key] = [value];
    }
    if (Object.keys(out).length) return out;
  }
  return { __form: ["Something went wrong. Try again."] };
}

/**
 * The one pattern every surface uses.
 *
 * `version` is a counter rather than a boolean so two reloads in a row both
 * fire; `live` guards against a response landing after the workspace changed.
 */
function useResource<T>(
  fetcher: (slug: string) => Promise<T>,
  fallback: T,
  deps: unknown[] = []
): TAsync<T> {
  const { workspaceSlug } = useAppContext();
  const [data, setData] = useState<T>(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Record<string, string[]> | null>(null);
  const [version, setVersion] = useState(0);

  // Held in a ref so a fetcher defined inline in a component does not restart
  // the effect on every render.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!workspaceSlug) return;
    let live = true;
    setLoading(true);
    setError(null);

    void fetcherRef
      .current(workspaceSlug)
      .then((result) => {
        if (live) setData(result);
      })
      .catch((caught) => {
        if (live) setError(asFieldErrors(caught));
      })
      .finally(() => {
        if (live) setLoading(false);
      });

    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceSlug, version, ...deps]);

  const reload = useCallback(() => setVersion((n) => n + 1), []);

  return { data, loading, error, reload };
}

/* -------------------------------------------------------------- departments */

export function useDepartments() {
  const { workspaceSlug } = useAppContext();
  const state = useResource<TDepartment[]>((slug) => service.listDepartments(slug), []);

  const create = useCallback(
    (data: Partial<TDepartment>) => service.createDepartment(workspaceSlug, data),
    [workspaceSlug]
  );
  const update = useCallback(
    (id: string, data: Partial<TDepartment>) => service.updateDepartment(workspaceSlug, id, data),
    [workspaceSlug]
  );
  const remove = useCallback(
    (id: string) => service.deleteDepartment(workspaceSlug, id),
    [workspaceSlug]
  );
  const setProjects = useCallback(
    (id: string, projectIds: string[]) => service.setDepartmentProjects(workspaceSlug, id, projectIds),
    [workspaceSlug]
  );

  return { ...state, create, update, remove, setProjects };
}

/* -------------------------------------------------------------------- links */

export function useProjectLinks(pendingOnly = false) {
  const { workspaceSlug } = useAppContext();
  const state = useResource<TProjectLink[]>(
    (slug) => service.listProjectLinks(slug, { pending: pendingOnly }),
    [],
    [pendingOnly]
  );

  const confirm = useCallback(
    (id: string) => service.confirmProjectLink(workspaceSlug, id),
    [workspaceSlug]
  );
  const reject = useCallback(
    (id: string) => service.deleteProjectLink(workspaceSlug, id),
    [workspaceSlug]
  );
  const create = useCallback(
    (source: string, target: string, kind?: TProjectLink["kind"]) =>
      service.createProjectLink(workspaceSlug, { source, target, kind }),
    [workspaceSlug]
  );

  return { ...state, confirm, reject, create };
}

/* --------------------------------------------------------------------- time */

export type TDateRange = { start: string; end: string };

export function useTimeEntries(range: TDateRange, member?: string) {
  const { workspaceSlug } = useAppContext();
  const state = useResource<{ items: TTimeEntry[]; total_minutes: number }>(
    (slug) => service.listTimeEntries(slug, { ...range, ...(member ? { member } : {}) }),
    { items: [], total_minutes: 0 },
    [range.start, range.end, member]
  );

  const log = useCallback(
    (data: { project: string; work_item?: string | null; spent_on: string; minutes: number; note?: string }) =>
      service.createTimeEntry(workspaceSlug, data),
    [workspaceSlug]
  );
  const remove = useCallback(
    (id: string) => service.deleteTimeEntry(workspaceSlug, id),
    [workspaceSlug]
  );

  return { ...state, log, remove };
}

/** The last 30 days, inclusive. The default every range control starts from. */
export function useDefaultRange(): TDateRange {
  return useMemo(() => ({ start: isoDaysAgo(29), end: isoToday() }), []);
}

/* --------------------------------------------------------------------- cost */

export function useCost(range: TDateRange, department?: string) {
  return useResource<TCostReport | null>(
    (slug) => service.fetchCost(slug, { ...range, ...(department ? { department } : {}) }),
    null,
    [range.start, range.end, department]
  );
}

export function useRates() {
  const { workspaceSlug } = useAppContext();
  const state = useResource<TMemberRate[]>((slug) => service.listRates(slug), []);

  const setRate = useCallback(
    (data: { member: string; amount_minor: number; currency?: string; effective_from: string }) =>
      service.createRate(workspaceSlug, data),
    [workspaceSlug]
  );
  const remove = useCallback((id: string) => service.deleteRate(workspaceSlug, id), [workspaceSlug]);

  return { ...state, setRate, remove };
}

/* ------------------------------------------------------------------ reports */

export function useReportSchedules() {
  const { workspaceSlug } = useAppContext();
  const state = useResource<TReportSchedule[]>((slug) => service.listReportSchedules(slug), []);

  const create = useCallback(
    (data: Record<string, unknown>) => service.createReportSchedule(workspaceSlug, data),
    [workspaceSlug]
  );
  const update = useCallback(
    (id: string, data: Record<string, unknown>) => service.updateReportSchedule(workspaceSlug, id, data),
    [workspaceSlug]
  );
  const remove = useCallback(
    (id: string) => service.deleteReportSchedule(workspaceSlug, id),
    [workspaceSlug]
  );
  const preview = useCallback((id: string) => service.previewReport(workspaceSlug, id), [workspaceSlug]);

  return { ...state, create, update, remove, preview };
}

export function useReportRuns() {
  return useResource<TReportRun[]>((slug) => service.listReportRuns(slug), []);
}

/* ---------------------------------------------------------------- reminders */

export function useReminders(state?: string) {
  const { workspaceSlug } = useAppContext();
  const resource = useResource<{ items: TReminder[]; due_count: number }>(
    (slug) => service.listReminders(slug, state ? { state } : {}),
    { items: [], due_count: 0 },
    [state]
  );

  const create = useCallback(
    (data: { entity_kind: string; entity_id: string; entity_label?: string; note?: string; remind_at: string }) =>
      service.createReminder(workspaceSlug, data),
    [workspaceSlug]
  );
  const dismiss = useCallback(
    (id: string) => service.dismissReminder(workspaceSlug, id),
    [workspaceSlug]
  );
  const remove = useCallback((id: string) => service.deleteReminder(workspaceSlug, id), [workspaceSlug]);
  const snooze = useCallback(
    (id: string, remindAt: string) => service.updateReminder(workspaceSlug, id, { remind_at: remindAt }),
    [workspaceSlug]
  );

  return { ...resource, create, dismiss, remove, snooze };
}

export { service as operationsService, asFieldErrors };
