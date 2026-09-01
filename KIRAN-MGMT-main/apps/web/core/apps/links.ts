/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Cross-app references.
 *
 * Stage 4's third question: can two apps reference each other's objects without
 * either one knowing the other exists? A chat message pointing at a work item;
 * a work item listing the conversations about it. If that needs
 * `import { … } from "../chat"`, the module system did not work.
 *
 * ---------------------------------------------------------------------------
 * The shape
 * ---------------------------------------------------------------------------
 * Two halves, and an app can implement either without the other.
 *
 * **Owning an entity** (`entityLinks` on the manifest). An app says how to
 * recognise its own URLs and how one of its objects should read when another
 * app renders it. Projects owns `work-item`; chat does not need to know that the
 * string is a project identifier, only that *somebody* claimed the URL and
 * handed back a label.
 *
 * **Referencing an entity** (`useBacklinks` on the manifest). An app answers
 * "what do I hold that points at this?" for a ref it did not mint. Chat answers
 * with messages. Projects never asks chat — it asks the registry, and the
 * registry asks whoever registered.
 *
 * ---------------------------------------------------------------------------
 * Why the ref is three opaque strings
 * ---------------------------------------------------------------------------
 * `{appKey, kind, id}` and nothing else. No title, no URL, no type union naming
 * every entity in the product — because the moment this file enumerates
 * `"work-item" | "room"`, adding an app means editing the shell, which is the
 * failure the registry exists to prevent. The owner resolves it; everyone else
 * passes it around.
 */

import { useMemo } from "react";
import { useParams } from "next/navigation";
// local imports
import { getRegisteredApps } from "./registry";
import type { TAppContributionContext, TAppKey } from "./types";
import { useApps } from "./use-apps";

/** A pointer to one object in one app. Opaque to every app but its owner. */
export type TEntityRef = {
  appKey: TAppKey;
  /** App-scoped entity type, e.g. `"work-item"`. Meaningful only to the owner. */
  kind: string;
  /** App-owned identifier. Never parsed by anyone else. */
  id: string;
};

/** What an app registers so its objects can be referenced from elsewhere. */
export type TEntityLinkSpec = {
  /**
   * Recognise one of this app's URLs. Return null for anything not yours --
   * every app is offered every link, and silence is the normal answer.
   *
   * Given a pathname only. A matcher that needs a query string is describing a
   * screen state rather than an object, and screen states are not referenceable.
   */
  parse: (pathname: string, workspaceSlug: string) => TEntityRef | null;
  /** The canonical URL for a ref this app owns. */
  href: (ref: TEntityRef, workspaceSlug: string) => string | null;
  /** How the ref should read inline in someone else's UI. Keep it short. */
  label: (ref: TEntityRef) => string;
  /**
   * This app's objects of `kind`, offered so another app can point at one.
   *
   * `parse`/`href`/`label` all answer questions about a ref somebody already
   * has. This is the question that comes before them: *which* refs are there?
   * Without it the only way for chat to offer "attach this conversation to a
   * department" is to import the operations service, which is the coupling the
   * registry exists to prevent -- and the coupling would be real, because chat
   * would then also have to know that a department has a `code`.
   *
   * A hook rather than a function, because listing means fetching. Return
   * `{options: [], loading: false}` for any kind you do not own; the caller
   * offers every kind to every app the same way `parse` is offered every URL.
   *
   * Called for hidden apps too, for the Rules-of-Hooks reason in
   * `contributions.ts` -- gate the fetch on `ctx.isVisible`.
   */
  useOptions?: (kind: string, ctx: TAppContributionContext) => TEntityOptions;
};

/** One of an app's objects, as offered to an app that wants to reference it. */
export type TEntityOption = {
  ref: TEntityRef;
  /** How it reads in a picker. The owning app decides; nobody else can. */
  label: string;
  /** Secondary line, when the label alone is ambiguous. */
  hint?: string;
};

export type TEntityOptions = {
  options: TEntityOption[];
  /** True until the first answer. Distinct from `options: []`, which means none. */
  loading: boolean;
};

/** One thing in some app that points at the ref you asked about. */
export type TBacklink = {
  /** Unique within the providing app. */
  id: string;
  /** One line of context: a message excerpt, a title. Plain text, not markup. */
  excerpt: string;
  href: string;
  timestamp: number;
  /** Display name, when the reference has an author. */
  author?: string;
};

export type TBacklinks = {
  items: TBacklink[];
  /** True until the first answer. Distinct from `items: []`, which means none. */
  loading: boolean;
};

/* -------------------------------------------------------------------------- */
/* Resolving a link to a ref                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Which app, if any, claims this URL.
 *
 * Pure, so anything can call it -- a markdown renderer mid-render, a paste
 * handler, a test. Offers the path to every registered app in rail order and
 * takes the first claim; a URL claimed by two apps is a registry bug, and rail
 * order at least makes the outcome deterministic rather than arbitrary.
 *
 * Accepts a full URL or a bare path. A link to another origin is nobody's.
 */
export function parseEntityRef(href: string, workspaceSlug: string): TEntityRef | null {
  if (!href || !workspaceSlug) return null;

  let pathname = href;
  if (/^https?:\/\//i.test(href)) {
    try {
      const url = new URL(href);
      // Only same-origin links can be KIRAN entities. In SSR there is no
      // `location` to compare against, so nothing resolves -- which is correct:
      // the chip is a client-side enhancement of a link that already works.
      if (typeof window === "undefined" || url.origin !== window.location.origin) return null;
      pathname = url.pathname;
    } catch {
      return null;
    }
  }

  if (!pathname.startsWith("/")) return null;

  for (const app of getRegisteredApps()) {
    const ref = app.entityLinks?.parse(pathname, workspaceSlug) ?? null;
    if (ref) return ref;
  }
  return null;
}

/** The owning app's label for a ref, or null if nobody owns it. */
export function entityLabel(ref: TEntityRef | null): string | null {
  if (!ref) return null;
  const owner = getRegisteredApps().find((app) => app.key === ref.appKey);
  return owner?.entityLinks?.label(ref) ?? null;
}

/** The owning app's canonical URL for a ref. */
export function entityHref(ref: TEntityRef | null, workspaceSlug: string): string | null {
  if (!ref) return null;
  const owner = getRegisteredApps().find((app) => app.key === ref.appKey);
  return owner?.entityLinks?.href(ref, workspaceSlug) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Backlinks                                                                  */
/* -------------------------------------------------------------------------- */

export type TBacklinkGroup = {
  appKey: TAppKey;
  /** The providing app's label, for the section heading. */
  appLabel: string;
} & TBacklinks;

/**
 * Everything, in every app, that points at this ref.
 *
 * Calls every registered app's provider in a fixed order, for the same
 * Rules-of-Hooks reason `contributions.ts` does -- see that file's header. A
 * provider whose app is hidden is called and discarded, so gate real work on
 * `ctx.isVisible`.
 *
 * Never asks the owning app about its own entity: a work item is not a backlink
 * to itself, and a provider that returned one would put the thing you are
 * looking at inside the list of things that mention it.
 */
export function useEntityBacklinks(ref: TEntityRef | null): TBacklinkGroup[] {
  const { workspaceSlug } = useParams();
  const { apps } = useApps();

  const slug = workspaceSlug?.toString() ?? "";
  const visible = useMemo(() => new Set(apps.map((app) => app.key)), [apps]);

  const groups: TBacklinkGroup[] = [];

  for (const app of getRegisteredApps()) {
    const isVisible = visible.has(app.key) && app.key !== ref?.appKey;
    const ctx: TAppContributionContext = { workspaceSlug: slug, isVisible };
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const result = app.useBacklinks?.(isVisible ? ref : null, ctx);
    if (!result || !isVisible) continue;
    groups.push({ appKey: app.key, appLabel: app.label, ...result });
  }

  return groups;
}

/* -------------------------------------------------------------------------- */
/* Offering an app's objects to another app                                   */
/* -------------------------------------------------------------------------- */

const NO_OPTIONS: TEntityOptions = { options: [], loading: false };

/**
 * Everything in the product that is a `kind`, whoever owns it.
 *
 * The mirror of `useEntityBacklinks`: that one asks "who points at this?", this
 * one asks "what is there to point at?". Chat uses it to fill the department
 * picker in a conversation's settings without importing operations, knowing
 * what a department is, or being edited when a fourth app starts owning
 * something else a room can belong to.
 *
 * Every registered app is asked, in the registry's fixed order, and the answers
 * are concatenated. A kind owned by two apps is a registry bug in the same way a
 * URL claimed by two apps is; concatenating at least renders both rather than
 * silently dropping one.
 */
export function useEntityOptions(kind: string): TEntityOptions {
  const { workspaceSlug } = useParams();
  const { apps } = useApps();

  const slug = workspaceSlug?.toString() ?? "";
  const visible = useMemo(() => new Set(apps.map((app) => app.key)), [apps]);

  const collected: TEntityOption[] = [];
  let loading = false;

  for (const app of getRegisteredApps()) {
    const isVisible = visible.has(app.key);
    const ctx: TAppContributionContext = { workspaceSlug: slug, isVisible };
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const result = app.entityLinks?.useOptions?.(isVisible ? kind : "", ctx) ?? NO_OPTIONS;
    if (!isVisible) continue;
    if (result.loading) loading = true;
    collected.push(...result.options);
  }

  return { options: collected, loading };
}

/* -------------------------------------------------------------------------- */
/* Acting on another app's object                                             */
/* -------------------------------------------------------------------------- */

/** Something one app offers to do to an object it does not own. */
export type TEntityAction = {
  /** Unique within the providing app. */
  id: string;
  /** Imperative, and short enough for a context menu. "Remind me in an hour". */
  label: string;
  /** Grouping label, so a menu can head a run of actions with the app's name. */
  appLabel: string;
  /** Fires it. Reports its own success or failure -- the caller only closes. */
  run: () => void | Promise<void>;
};

/**
 * A ref plus how its owner wants it to read, for a provider that has to store
 * the label rather than resolve it.
 *
 * `entityLabel(ref)` is pure and synchronous, so the best it can say about a
 * chat message is "Message". A reminder that reads "Message" in a list of
 * reminders is a reminder nobody can act on, so the caller -- which is holding
 * the object -- supplies the line. It is still the owner's text: chat writes
 * the excerpt, operations stores it verbatim and never parses it.
 */
export type TEntityTarget = {
  ref: TEntityRef;
  /** One line, plain text, written by the ref's owner. */
  label: string;
};

const NO_ACTIONS: TEntityAction[] = [];

/**
 * Everything any app offers to do to this object.
 *
 * The write-side mirror of `useEntityBacklinks`. That one asks "who already
 * points at this?"; this asks "who would like to". Operations offers to set a
 * reminder on a chat message, and the two apps meet the same way they do
 * everywhere else -- through three opaque strings and the registry. Chat never
 * learns what a reminder is, operations never learns what a message is, and
 * neither file imports the other.
 *
 * The owning app is never asked about its own object. An app's actions on its
 * own objects are just its UI, and routing them through here would put "Reply"
 * in the same menu as "Remind me", sourced from a registry, for no reason.
 *
 * Fixed iteration order and every provider called on every render, for the
 * Rules-of-Hooks reason in `contributions.ts`. Gate work on `ctx.isVisible`.
 */
export function useEntityActions(target: TEntityTarget | null): TEntityAction[] {
  const { workspaceSlug } = useParams();
  const { apps } = useApps();

  const slug = workspaceSlug?.toString() ?? "";
  const visible = useMemo(() => new Set(apps.map((app) => app.key)), [apps]);

  const collected: TEntityAction[] = [];

  for (const app of getRegisteredApps()) {
    const isVisible = visible.has(app.key) && app.key !== target?.ref.appKey;
    const ctx: TAppContributionContext = { workspaceSlug: slug, isVisible };
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const result = app.useEntityActions?.(isVisible ? target : null, ctx) ?? NO_ACTIONS;
    if (!isVisible) continue;
    collected.push(...result);
  }

  return collected;
}
