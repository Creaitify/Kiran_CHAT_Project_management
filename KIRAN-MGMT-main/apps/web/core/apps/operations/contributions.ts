/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * What Operations puts on the shell's shared surfaces.
 *
 * All three contributions, which makes this the first app to use the whole
 * contract:
 *
 * - **`useBadge`** — reminders that have come due. The one number here that is
 *   genuinely a notification: something you asked to be told about, at a time
 *   you chose, that has arrived.
 * - **`usePowerKCommands`** — jump to a department's cost view.
 * - **`useBacklinks`** — reminders you set on somebody else's object, so a work
 *   item's sidebar shows them next to the conversations about it. Operations
 *   never learns what a work item is; it stores an opaque `{kind, id}` and
 *   answers questions about it.
 *
 * The due count is cached at module scope for the reason chat's overview is: the
 * rail is mounted outside this app, and a React context would mean the shell
 * hosting an operations-shaped provider.
 */

import { useEffect, useMemo, useState } from "react";
import { BuildingIcon } from "lucide-react";
// components
import type { TPowerKCommandConfig } from "@/components/power-k/core/types";
import { handlePowerKNavigate } from "@/components/power-k/utils/navigation";
// apps
import type { TBacklinks, TEntityRef } from "../links";
import type { TAppBadge, TAppContributionContext } from "../types";
// local imports
import { OperationsService, type TDepartment } from "./service";

const service = new OperationsService();

/* -------------------------------------------------------------------------- */
/* Due reminders, shared between the badge and anything else that asks         */
/* -------------------------------------------------------------------------- */

/**
 * Slower than chat's badge on purpose. A reminder is due at a minute you chose,
 * and the beat that fires it runs every minute — so a rail that notices within
 * two is telling the truth closely enough, and polling faster would be spending
 * requests on precision nobody asked for.
 */
const POLL_INTERVAL_MS = 120_000;

type TDueCache = {
  count: number | null;
  inFlight: Promise<number | null> | null;
  listeners: Set<(count: number | null) => void>;
};

const dueByWorkspace = new Map<string, TDueCache>();

function dueEntry(workspaceSlug: string): TDueCache {
  let entry = dueByWorkspace.get(workspaceSlug);
  if (!entry) {
    entry = { count: null, inFlight: null, listeners: new Set() };
    dueByWorkspace.set(workspaceSlug, entry);
  }
  return entry;
}

function fetchDue(workspaceSlug: string): Promise<number | null> {
  const entry = dueEntry(workspaceSlug);
  if (entry.inFlight) return entry.inFlight;

  entry.inFlight = service
    .listReminders(workspaceSlug, { state: "pending" })
    .then((response) => {
      entry.count = response?.due_count ?? 0;
      for (const listener of entry.listeners) listener(entry.count);
      return entry.count;
    })
    // A failed poll leaves the previous count alone and draws no badge on the
    // first failure. The rail is not the place to report that an API is down.
    .catch(() => entry.count)
    .finally(() => {
      entry.inFlight = null;
    });

  return entry.inFlight;
}

export function useDueReminderCount(workspaceSlug: string, enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(() =>
    workspaceSlug ? dueEntry(workspaceSlug).count : null
  );

  useEffect(() => {
    if (!enabled || !workspaceSlug) {
      setCount(null);
      return;
    }

    const entry = dueEntry(workspaceSlug);
    setCount(entry.count);
    entry.listeners.add(setCount);
    void fetchDue(workspaceSlug);

    const interval = setInterval(() => void fetchDue(workspaceSlug), POLL_INTERVAL_MS);
    return () => {
      entry.listeners.delete(setCount);
      clearInterval(interval);
    };
  }, [enabled, workspaceSlug]);

  return count;
}

/** Called after creating or dismissing a reminder, so the rail catches up now. */
export function refreshDueReminders(workspaceSlug: string): void {
  if (workspaceSlug) void fetchDue(workspaceSlug);
}

/* -------------------------------------------------------------------------- */
/* Contributions                                                              */
/* -------------------------------------------------------------------------- */

export function useOperationsBadge(ctx: TAppContributionContext): TAppBadge | undefined {
  const due = useDueReminderCount(ctx.workspaceSlug, ctx.isVisible);

  return useMemo(() => {
    if (due === null || due === 0) return undefined;
    return {
      count: due,
      // Always emphasised. Unlike an unread message, a due reminder is something
      // the person explicitly asked to be interrupted about — treating it as
      // ambient would defeat the point of having set it.
      emphasis: true,
      label: `${due} reminder${due === 1 ? "" : "s"} due`,
    };
  }, [due]);
}

export function useOperationsPowerKCommands(ctx: TAppContributionContext): TPowerKCommandConfig[] {
  const [departments, setDepartments] = useState<TDepartment[]>([]);
  const { workspaceSlug, isVisible } = ctx;

  useEffect(() => {
    if (!isVisible || !workspaceSlug) {
      setDepartments([]);
      return;
    }
    let live = true;
    void service
      .listDepartments(workspaceSlug)
      .then((result) => {
        if (live) setDepartments(result ?? []);
      })
      .catch(() => {
        if (live) setDepartments([]);
      });
    return () => {
      live = false;
    };
  }, [isVisible, workspaceSlug]);

  return useMemo(
    () =>
      departments.slice(0, 25).map<TPowerKCommandConfig>((department) => ({
        id: `operations_department_${department.id}`,
        type: "action",
        group: "navigation",
        i18n_title: `${department.code} — ${department.name}`,
        i18n_description: `Cost and hours · ${department.project_count} project${
          department.project_count === 1 ? "" : "s"
        }`,
        icon: BuildingIcon,
        keywords: ["department", "cost", "hours", "operations", department.code.toLowerCase()],
        action: (commandCtx) => {
          const slug = commandCtx.params.workspaceSlug?.toString();
          if (!slug) return;
          handlePowerKNavigate(commandCtx, [`/${slug}/operations?tab=cost&department=${department.id}`]);
        },
        isEnabled: (commandCtx) => Boolean(commandCtx.params.workspaceSlug?.toString()),
        isVisible: (commandCtx) => Boolean(commandCtx.params.workspaceSlug?.toString()),
        closeOnSelect: true,
      })),
    [departments]
  );
}

const NO_BACKLINKS: TBacklinks = { items: [], loading: false };

/**
 * Reminders you set on someone else's object.
 *
 * Only yours: the endpoint scopes reminders to the caller, so a work item's
 * sidebar shows the nudges *you* set on it and never anyone else's. That is the
 * right privacy answer and it is enforced server-side, not here.
 */
export function useOperationsBacklinks(
  ref: TEntityRef | null,
  ctx: TAppContributionContext
): TBacklinks {
  const [state, setState] = useState<TBacklinks>(NO_BACKLINKS);

  const kind = ref?.kind ?? "";
  const id = ref?.id ?? "";
  const { workspaceSlug, isVisible } = ctx;

  useEffect(() => {
    if (!isVisible || !workspaceSlug || !kind || !id) {
      setState(NO_BACKLINKS);
      return;
    }

    let live = true;
    setState({ items: [], loading: true });

    void service
      .listReminders(workspaceSlug, { entity_kind: kind, entity_id: id })
      .then((response) => {
        if (!live) return;
        setState({
          loading: false,
          items: (response?.items ?? [])
            .filter((reminder) => reminder.state !== "dismissed")
            .map((reminder) => ({
              id: reminder.id,
              excerpt: reminder.note || "Reminder",
              href: `/${workspaceSlug}/operations?tab=reminders`,
              timestamp: Date.parse(reminder.remind_at) || 0,
            })),
        });
      })
      .catch(() => {
        if (live) setState(NO_BACKLINKS);
      });

    return () => {
      live = false;
    };
  }, [isVisible, workspaceSlug, kind, id]);

  return state;
}
