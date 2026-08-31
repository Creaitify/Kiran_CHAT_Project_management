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
// plane imports
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
// components
import type { TPowerKCommandConfig } from "@/components/power-k/core/types";
import { handlePowerKNavigate } from "@/components/power-k/utils/navigation";
// apps
import type {
  TBacklinks,
  TEntityAction,
  TEntityLinkSpec,
  TEntityOptions,
  TEntityRef,
  TEntityTarget,
} from "../links";
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

/* -------------------------------------------------------------------------- */
/* Entity links — offering departments to whoever wants to point at one       */
/* -------------------------------------------------------------------------- */

const NO_OPTIONS: TEntityOptions = { options: [], loading: false };

/**
 * Departments, as things another app can attach itself to.
 *
 * Chat calls this through `useEntityOptions("department")` to fill the picker in
 * a conversation's settings. It is the only way that picker can exist without
 * chat importing this file — and the import would not be cosmetic, because chat
 * would then also have to know that a department is `{code, name}` and which of
 * the two goes in the label.
 *
 * Fetched once per mount and not polled. A picker is opened deliberately and
 * read once; departments change on the order of months.
 */
export function useOperationsEntityOptions(kind: string, ctx: TAppContributionContext): TEntityOptions {
  const [state, setState] = useState<TEntityOptions>(NO_OPTIONS);
  const { workspaceSlug, isVisible } = ctx;
  const wanted = kind === "department";

  useEffect(() => {
    if (!wanted || !isVisible || !workspaceSlug) {
      setState(NO_OPTIONS);
      return;
    }

    let live = true;
    setState({ options: [], loading: true });

    void service
      .listDepartments(workspaceSlug)
      .then((departments: TDepartment[]) => {
        if (!live) return;
        setState({
          loading: false,
          options: departments.map((department) => ({
            ref: { appKey: "operations", kind: "department", id: department.id },
            // The code leads because it is what the chip in a room list shows;
            // the name is there so the picker is readable to somebody who has
            // not memorised the codes.
            label: department.code,
            hint: department.name,
          })),
        });
      })
      .catch(() => {
        // A picker that offers nothing is a picker somebody closes. One that
        // throws takes the settings dialog with it.
        if (live) setState(NO_OPTIONS);
      });

    return () => {
      live = false;
    };
  }, [wanted, isVisible, workspaceSlug]);

  return state;
}

/**
 * Operations' side of the entity contract.
 *
 * Deliberately asymmetric: `href` produces a link to a department, `parse` never
 * recognises one. A department's screen is `?tab=departments&department=<id>` —
 * query string, not path — and `parse` is given a pathname on purpose, because a
 * matcher that needs a query is describing a screen state rather than an object.
 * So an operations link pasted into chat stays an ordinary link, which is the
 * right answer until departments get a path of their own.
 *
 * `label` cannot do better than the kind. It is pure and synchronous and the id
 * is a uuid; the readable name arrives through `useOptions`, and anybody who
 * stores a department stores the code alongside it rather than resolving one
 * every render.
 */
export const operationsEntityLinks: TEntityLinkSpec = {
  parse: () => null,
  href: (ref, workspaceSlug) =>
    ref.kind === "department"
      ? `/${workspaceSlug}/operations?tab=departments&department=${encodeURIComponent(ref.id)}`
      : null,
  label: (ref) => (ref.kind === "department" ? "Department" : ref.kind),
  useOptions: useOperationsEntityOptions,
};

/* -------------------------------------------------------------------------- */
/* Entity actions — setting a reminder on anybody's object                    */
/* -------------------------------------------------------------------------- */

/**
 * Presets rather than a picker.
 *
 * An action's `run` is fired from inside somebody else's component tree, so it
 * cannot open a dialog of its own without operations shipping a dialog into
 * chat's DOM and chat agreeing to host it. Three fixed offsets need no UI at
 * all, and they cover what a reminder set from a conversation is actually for:
 * "not now", "after lunch", "tomorrow".
 *
 * Anything more deliberate than this belongs on the reminders screen, which has
 * the room for a date picker and is one click away.
 */
const REMINDER_PRESETS: { id: string; label: string; at: (now: Date) => Date }[] = [
  {
    id: "1h",
    label: "Remind me in an hour",
    at: (now) => new Date(now.getTime() + 60 * 60 * 1000),
  },
  {
    id: "3h",
    label: "Remind me in three hours",
    at: (now) => new Date(now.getTime() + 3 * 60 * 60 * 1000),
  },
  {
    id: "tomorrow",
    label: "Remind me tomorrow morning",
    // 09:00 local, which is the reader's own clock -- the server stores the
    // instant, so a reminder set at 23:00 in one zone still lands at breakfast.
    at: (now) => {
      const next = new Date(now);
      next.setDate(next.getDate() + 1);
      next.setHours(9, 0, 0, 0);
      return next;
    },
  },
];

/** The longest an entity label may be before it is trimmed for storage. */
const MAX_LABEL = 240;

/**
 * "Remind me about this", offered on any object in the product.
 *
 * The whole of operations' knowledge of the thing being reminded about is the
 * three opaque strings in the ref and one line of text its owner wrote. That is
 * the test: chat's message menu grows an operations feature, and neither app's
 * source mentions the other.
 */
export function useOperationsEntityActions(
  target: TEntityTarget | null,
  ctx: TAppContributionContext
): TEntityAction[] {
  const { workspaceSlug, isVisible } = ctx;

  return useMemo(() => {
    if (!isVisible || !workspaceSlug || !target) return [];

    return REMINDER_PRESETS.map<TEntityAction>((preset) => ({
      id: `operations_reminder_${preset.id}`,
      label: preset.label,
      appLabel: "Operations",
      run: async () => {
        try {
          await service.createReminder(workspaceSlug, {
            entity_kind: target.ref.kind,
            entity_id: target.ref.id,
            entity_label: target.label.slice(0, MAX_LABEL),
            // `new Date()` at fire time, not at render time: a menu left open
            // for ten minutes must not set a reminder ten minutes in the past.
            remind_at: preset.at(new Date()).toISOString(),
          });
          // The rail badge counts due reminders and is on a slow poll; this one
          // is not due yet, but the list behind the badge is now stale.
          refreshDueReminders(workspaceSlug);
          setToast({
            type: TOAST_TYPE.SUCCESS,
            title: "Reminder set",
            message: preset.label.replace("Remind me ", "We will remind you "),
          });
        } catch {
          setToast({
            type: TOAST_TYPE.ERROR,
            title: "Could not set that reminder",
            message: "Try again from the Operations screen.",
          });
        }
      },
    }));
  }, [isVisible, workspaceSlug, target?.ref.kind, target?.ref.id, target?.label]);
}
