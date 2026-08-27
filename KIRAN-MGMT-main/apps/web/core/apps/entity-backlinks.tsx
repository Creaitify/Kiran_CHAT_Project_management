/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * "Referenced in" — the other half of a cross-app link, as a droppable panel.
 *
 * An app puts this on a detail screen and gets every other app's references to
 * that object, without naming any of them. Today the only provider is chat, so
 * the panel renders conversations; if a fourth app registers a provider
 * tomorrow, its section appears here and this file does not change.
 *
 * Renders nothing at all when there is nothing to show. A permanently empty
 * "Referenced in chat — none" block on every work item is worse than no block:
 * it is a claim about chat's contents that most work items should not be making.
 */

import { observer } from "mobx-react";
import { MessageSquareIcon } from "lucide-react";
// local imports
import { useEntityBacklinks, type TEntityRef } from "./links";

function relativeTime(timestamp: number): string {
  if (!timestamp) return "";
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export const EntityBacklinks = observer(function EntityBacklinks({ entity }: { entity: TEntityRef | null }) {
  const groups = useEntityBacklinks(entity);
  const populated = groups.filter((group) => group.items.length > 0);

  // Loading is deliberately silent. This panel is secondary to whatever screen
  // it sits on, and a skeleton that resolves to nothing -- the common case --
  // is a flash of furniture for no reason.
  if (populated.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {populated.map((group) => (
        <section key={group.appKey} className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-11 font-medium uppercase tracking-wide text-tertiary">
            <MessageSquareIcon className="size-3.5" />
            Referenced in {group.appLabel}
          </h3>
          <ul className="flex flex-col gap-1">
            {group.items.map((item) => (
              <li key={item.id}>
                <a
                  href={item.href}
                  rel="noopener"
                  className="flex flex-col gap-0.5 rounded-md border border-subtle px-3 py-2 transition-colors hover:bg-layer-transparent-hover"
                >
                  <span className="flex items-baseline gap-2">
                    {item.author && <span className="text-11 font-medium text-secondary">{item.author}</span>}
                    <span className="text-11 text-tertiary">{relativeTime(item.timestamp)}</span>
                  </span>
                  <span className="line-clamp-2 text-13 text-primary">{item.excerpt}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
});
