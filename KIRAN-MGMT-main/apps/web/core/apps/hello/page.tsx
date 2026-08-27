/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// components
import { PageHead } from "@/components/core/page-title";
// apps
import { useApps } from "@/apps/use-apps";

/**
 * A receipt for the app registry.
 *
 * It renders what the shell currently believes about apps, so a regression in
 * registration, permission gating or active-app resolution is visible on one
 * screen instead of inferred from a rail icon that looks slightly wrong.
 */
export const HelloAppPage = observer(function HelloAppPage() {
  const { workspaceSlug } = useParams();
  const { apps, activeApp, hasMultipleApps } = useApps();

  const slug = workspaceSlug?.toString() ?? "";

  return (
    <>
      <PageHead title="Hello" />
      <div className="h-full w-full overflow-y-auto p-8">
        <div className="mx-auto flex max-w-2xl flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold text-primary">Hello App</h1>
            <p className="text-sm text-tertiary">
              This screen exists to prove the app registry works. It was added without touching the app rail, the
              router, the command palette or the permission plumbing.
            </p>
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-subtle p-4">
            <h2 className="text-sm font-medium text-secondary">Registered apps</h2>
            <ul className="flex flex-col gap-2">
              {apps.map((app) => (
                <li key={app.key} className="flex items-center gap-3 text-sm">
                  <span className="text-icon-tertiary">{app.icon}</span>
                  <span className="text-primary">{app.label}</span>
                  <code className="rounded bg-layer-transparent-hover px-1.5 py-0.5 text-11 text-tertiary">
                    {app.path(slug)}
                  </code>
                  {app.key === activeApp?.key && (
                    <span className="rounded bg-layer-transparent-selected px-1.5 py-0.5 text-11 text-secondary">
                      active
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <p className="text-11 text-tertiary">
            App rail visibility: {hasMultipleApps ? "on" : "off"} — the rail turns itself on once a second app is
            visible to you.
          </p>
        </div>
      </div>
    </>
  );
});
