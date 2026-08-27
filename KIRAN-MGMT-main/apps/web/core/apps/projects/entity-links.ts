/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Work items, made referenceable from other apps.
 *
 * Projects gets nothing out of this on its own. It is what lets a work-item URL
 * pasted into a chat message render as `KIR-42` in a chip — with chat having no
 * idea what a project identifier is, and this file having no idea chat exists.
 *
 * ---------------------------------------------------------------------------
 * Why `/browse/KIR-42` and not the uuid route
 * ---------------------------------------------------------------------------
 * `generateWorkItemLink` produces `/:workspaceSlug/browse/:identifier-:sequence/`
 * for an ordinary work item, and that is the URL a person copies out of the
 * address bar. It is also the better identifier: `KIR-42` is stable, readable,
 * and survives being moved between views, whereas the uuid form
 * (`/projects/:uuid/issues/:uuid`) is neither readable nor the thing people
 * share.
 *
 * So the ref's `id` is the human identifier. That is a deliberate choice about
 * what a work item *is* to the rest of the product, and it is exactly the kind
 * of decision the contract keeps inside the owning app: nobody else parses it.
 */

import type { TEntityLinkSpec, TEntityRef } from "../links";

export const WORK_ITEM_KIND = "work-item";

/**
 * `KIR-42`, `AB1-7`. Uppercase letters and digits, a hyphen, a number.
 *
 * Anchored, because a partial match would claim `/browse/KIR-42/comments` — a
 * screen about the work item rather than the work item — and referencing a
 * screen state is not a thing this contract does.
 */
const BROWSE_PATH = /^\/([^/]+)\/browse\/([A-Za-z0-9]+-\d+)\/?$/;

export const workItemEntityLinks: TEntityLinkSpec = {
  parse: (pathname, workspaceSlug): TEntityRef | null => {
    const match = BROWSE_PATH.exec(pathname);
    if (!match) return null;

    // The link has to belong to the workspace being viewed. A link to another
    // workspace is a real link to a real thing, but resolving it here would
    // render a chip the reader cannot open.
    const [, slug, identifier] = match;
    if (slug !== workspaceSlug) return null;

    return { appKey: "projects", kind: WORK_ITEM_KIND, id: identifier!.toUpperCase() };
  },

  href: (ref, workspaceSlug) => {
    if (ref.kind !== WORK_ITEM_KIND) return null;
    return `/${workspaceSlug}/browse/${ref.id}/`;
  },

  // The identifier is the label. A work item's title would read better and is
  // not available here -- it needs a store this file has no business reaching
  // into, and a chip that shows a title it had to fetch is a chip that flickers.
  label: (ref) => ref.id,
};
