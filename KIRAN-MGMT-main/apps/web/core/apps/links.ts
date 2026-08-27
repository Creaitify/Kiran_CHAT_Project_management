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
