/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * The operations HTTP client.
 *
 * One class, five surfaces — departments, links, time, cost, reports, reminders
 * — because they are one API prefix and one deployment. Splitting it into five
 * services would mean five axios instances and five places to change a base URL.
 *
 * Lives in the app rather than in `@plane/services` for the reason MODULES.md
 * gives: an app is one directory, and a service in the package would need the
 * package rebuilt before the dev server saw a change to it.
 *
 * **Money crosses this boundary as integer minor units.** `amount_minor`,
 * `cost_minor` — paise, cents. Never a float, because a JSON number that has
 * been through a float can come back as 1234.9999999999998, and a finance screen
 * is the last place that should happen. `formatMoney` in `./format.ts` is the
 * only thing that divides.
 */

import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";

/* ------------------------------------------------------------------- types */

export type TDepartment = {
  id: string;
  name: string;
  code: string;
  description: string;
  lead: string | null;
  project_count: number;
};

export type TProjectDepartment = {
  id: string;
  project_id: string;
  department_id: string;
  project_name: string;
  department_code: string;
  role: "owner" | "contributor";
};

export type TProjectLink = {
  id: string;
  source_id: string;
  target_id: string;
  source_name: string;
  target_name: string;
  kind: "related" | "depends_on" | "blocks";
  origin: "manual" | "suggested";
  rationale: string;
  is_confirmed: boolean;
  confirmed_at: string | null;
};

export type TMemberRate = {
  id: string;
  member_id: string;
  amount_minor: number;
  currency: string;
  effective_from: string;
};

export type TTimeEntry = {
  id: string;
  member_id: string;
  project_id: string;
  work_item_id: string | null;
  member_name: string;
  project_name: string;
  spent_on: string;
  minutes: number;
  note: string;
};

export type TTimeTotals = {
  minutes: number;
  hours: number;
  cost_minor: number;
  /** Minutes with no applicable rate. Reported, never priced at zero. */
  unpriced_minutes: number;
};

export type TCostRow = TTimeTotals & { name: string };

export type TCostReport = {
  period_start: string;
  period_end: string;
  currency: string;
  totals: TTimeTotals;
  by_project: (TCostRow & { project_id: string })[];
  by_member: (TCostRow & { member_id: string })[];
  by_department: (TTimeTotals & { department_id: string; code: string; name: string; project_count: number })[];
};

export type TReportSchedule = {
  id: string;
  name: string;
  cadence: "weekly";
  send_weekday: number;
  is_active: boolean;
  department_id: string | null;
  recipient_ids: string[];
  last_run_for: string | null;
};

export type TReportRun = {
  id: string;
  schedule_id: string | null;
  schedule_name: string | null;
  period_start: string;
  period_end: string;
  payload: Omit<TCostReport, "by_department">;
};

export type TReminder = {
  id: string;
  member_id: string;
  entity_kind: string;
  entity_id: string;
  entity_label: string;
  note: string;
  remind_at: string;
  state: "pending" | "sent" | "dismissed";
  sent_at: string | null;
  is_due: boolean;
};

/* ----------------------------------------------------------------- service */

export class OperationsService extends APIService {
  constructor(BASE_URL?: string) {
    super(BASE_URL || API_BASE_URL);
  }

  private root(workspaceSlug: string): string {
    return `/api/workspaces/${encodeURIComponent(workspaceSlug)}/operations`;
  }

  /** Every method unwraps the same way; `throw error?.response?.data` keeps DRF
   *  field errors reachable so a form can render them next to the input. */
  private unwrap<T>(promise: Promise<{ data: T }>): Promise<T> {
    return promise
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /* ---------------------------------------------------------- departments */

  listDepartments(workspaceSlug: string): Promise<TDepartment[]> {
    return this.unwrap(this.get(`${this.root(workspaceSlug)}/departments/`));
  }

  createDepartment(workspaceSlug: string, data: Partial<TDepartment>): Promise<TDepartment> {
    return this.unwrap(this.post(`${this.root(workspaceSlug)}/departments/`, data));
  }

  updateDepartment(workspaceSlug: string, id: string, data: Partial<TDepartment>): Promise<TDepartment> {
    return this.unwrap(this.patch(`${this.root(workspaceSlug)}/departments/${id}/`, data));
  }

  deleteDepartment(workspaceSlug: string, id: string): Promise<void> {
    return this.unwrap(this.delete(`${this.root(workspaceSlug)}/departments/${id}/`));
  }

  /** The whole project list, not a delta — see the endpoint's own note. */
  setDepartmentProjects(
    workspaceSlug: string,
    id: string,
    projectIds: string[]
  ): Promise<TProjectDepartment[]> {
    return this.unwrap(
      this.post(`${this.root(workspaceSlug)}/departments/${id}/projects/`, { project_ids: projectIds })
    );
  }

  /* ---------------------------------------------------------------- links */

  listProjectLinks(workspaceSlug: string, params: { project?: string; pending?: boolean } = {}) {
    return this.unwrap<TProjectLink[]>(
      this.get(`${this.root(workspaceSlug)}/links/`, {
        params: {
          ...(params.project ? { project: params.project } : {}),
          ...(params.pending ? { pending: 1 } : {}),
        },
      })
    );
  }

  createProjectLink(
    workspaceSlug: string,
    data: { source: string; target: string; kind?: TProjectLink["kind"] }
  ): Promise<TProjectLink> {
    return this.unwrap(this.post(`${this.root(workspaceSlug)}/links/`, data));
  }

  confirmProjectLink(workspaceSlug: string, id: string): Promise<TProjectLink> {
    return this.unwrap(this.post(`${this.root(workspaceSlug)}/links/${id}/confirm/`));
  }

  deleteProjectLink(workspaceSlug: string, id: string): Promise<void> {
    return this.unwrap(this.delete(`${this.root(workspaceSlug)}/links/${id}/`));
  }

  /* ----------------------------------------------------------------- time */

  listTimeEntries(
    workspaceSlug: string,
    params: { start?: string; end?: string; member?: string; project?: string } = {}
  ): Promise<{ items: TTimeEntry[]; total_minutes: number; start: string; end: string }> {
    return this.unwrap(this.get(`${this.root(workspaceSlug)}/time/`, { params }));
  }

  createTimeEntry(
    workspaceSlug: string,
    data: { project: string; work_item?: string | null; spent_on: string; minutes: number; note?: string }
  ): Promise<TTimeEntry> {
    return this.unwrap(this.post(`${this.root(workspaceSlug)}/time/`, data));
  }

  updateTimeEntry(workspaceSlug: string, id: string, data: Partial<TTimeEntry>): Promise<TTimeEntry> {
    return this.unwrap(this.patch(`${this.root(workspaceSlug)}/time/${id}/`, data));
  }

  deleteTimeEntry(workspaceSlug: string, id: string): Promise<void> {
    return this.unwrap(this.delete(`${this.root(workspaceSlug)}/time/${id}/`));
  }

  /* ----------------------------------------------------------- rates/cost */

  listRates(workspaceSlug: string, member?: string): Promise<TMemberRate[]> {
    return this.unwrap(
      this.get(`${this.root(workspaceSlug)}/rates/`, { params: member ? { member } : {} })
    );
  }

  createRate(
    workspaceSlug: string,
    data: { member: string; amount_minor: number; currency?: string; effective_from: string }
  ): Promise<TMemberRate> {
    return this.unwrap(this.post(`${this.root(workspaceSlug)}/rates/`, data));
  }

  deleteRate(workspaceSlug: string, id: string): Promise<void> {
    return this.unwrap(this.delete(`${this.root(workspaceSlug)}/rates/${id}/`));
  }

  fetchCost(
    workspaceSlug: string,
    params: { start?: string; end?: string; department?: string } = {}
  ): Promise<TCostReport> {
    return this.unwrap(this.get(`${this.root(workspaceSlug)}/cost/`, { params }));
  }

  /* -------------------------------------------------------------- reports */

  listReportSchedules(workspaceSlug: string): Promise<TReportSchedule[]> {
    return this.unwrap(this.get(`${this.root(workspaceSlug)}/report-schedules/`));
  }

  createReportSchedule(workspaceSlug: string, data: Record<string, unknown>): Promise<TReportSchedule> {
    return this.unwrap(this.post(`${this.root(workspaceSlug)}/report-schedules/`, data));
  }

  updateReportSchedule(
    workspaceSlug: string,
    id: string,
    data: Record<string, unknown>
  ): Promise<TReportSchedule> {
    return this.unwrap(this.patch(`${this.root(workspaceSlug)}/report-schedules/${id}/`, data));
  }

  deleteReportSchedule(workspaceSlug: string, id: string): Promise<void> {
    return this.unwrap(this.delete(`${this.root(workspaceSlug)}/report-schedules/${id}/`));
  }

  previewReport(workspaceSlug: string, id: string): Promise<Omit<TReportRun, "id" | "schedule_id" | "schedule_name">> {
    return this.unwrap(this.get(`${this.root(workspaceSlug)}/report-schedules/${id}/preview/`));
  }

  listReportRuns(workspaceSlug: string, schedule?: string): Promise<TReportRun[]> {
    return this.unwrap(
      this.get(`${this.root(workspaceSlug)}/reports/`, { params: schedule ? { schedule } : {} })
    );
  }

  /* ------------------------------------------------------------ reminders */

  listReminders(
    workspaceSlug: string,
    params: { state?: string; entity_kind?: string; entity_id?: string } = {}
  ): Promise<{ items: TReminder[]; due_count: number }> {
    return this.unwrap(this.get(`${this.root(workspaceSlug)}/reminders/`, { params }));
  }

  createReminder(
    workspaceSlug: string,
    data: { entity_kind: string; entity_id: string; entity_label?: string; note?: string; remind_at: string }
  ): Promise<TReminder> {
    return this.unwrap(this.post(`${this.root(workspaceSlug)}/reminders/`, data));
  }

  updateReminder(workspaceSlug: string, id: string, data: Partial<TReminder>): Promise<TReminder> {
    return this.unwrap(this.patch(`${this.root(workspaceSlug)}/reminders/${id}/`, data));
  }

  dismissReminder(workspaceSlug: string, id: string): Promise<TReminder> {
    return this.unwrap(this.post(`${this.root(workspaceSlug)}/reminders/${id}/dismiss/`));
  }

  deleteReminder(workspaceSlug: string, id: string): Promise<void> {
    return this.unwrap(this.delete(`${this.root(workspaceSlug)}/reminders/${id}/`));
  }
}
