/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { BarChart3, CheckCircle2, FolderKanban, LayoutGrid, Users } from "lucide-react";
// KCMS imports
import { Logo } from "@plane/propel/emoji-icon-picker";
import { cn } from "@plane/utils";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { useProject } from "@/hooks/store/use-project";

type TStat = {
  key: string;
  label: string;
  value: number | string;
  icon: React.ReactNode;
  accent: string;
};

function StatTile({ stat }: { stat: TStat }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-subtle bg-layer-1 px-4 py-3.5">
      <div className="flex items-center gap-2">
        <span className={cn("flex size-6 items-center justify-center rounded-md", stat.accent)}>{stat.icon}</span>
        <span className="text-11 font-medium tracking-wide text-tertiary uppercase">{stat.label}</span>
      </div>
      <span className="font-heading text-24 leading-none font-semibold text-primary">{stat.value}</span>
    </div>
  );
}

export const WorkspaceOverview = observer(function WorkspaceOverview() {
  const { workspaceSlug } = useParams();
  const { joinedProjectIds, getProjectById, getProjectAnalyticsCountById, fetchProjectAnalyticsCount } = useProject();
  const {
    workspace: { workspaceMemberIds },
  } = useMember();

  const slug = workspaceSlug?.toString();

  useSWR(
    slug ? `WORKSPACE_OVERVIEW_COUNTS_${slug}` : null,
    slug
      ? () =>
          fetchProjectAnalyticsCount(slug, {
            fields: "total_issues,completed_issues,cancelled_issues,total_members,total_cycles,total_modules",
          })
      : null,
    { revalidateOnFocus: false }
  );

  if (!slug || joinedProjectIds.length === 0) return null;

  const projects = joinedProjectIds.map((id) => getProjectById(id)).filter(Boolean);

  let totalIssues = 0;
  // `completed_issues` from the API means "closed", i.e. completed + cancelled.
  let closedIssues = 0;
  let cancelledIssues = 0;
  for (const id of joinedProjectIds) {
    const counts = getProjectAnalyticsCountById(id);
    totalIssues += counts?.total_issues ?? 0;
    closedIssues += counts?.completed_issues ?? 0;
    cancelledIssues += counts?.cancelled_issues ?? 0;
  }
  // Open = still actionable: neither finished nor cancelled.
  const openIssues = Math.max(totalIssues - closedIssues, 0);
  const completedIssues = Math.max(closedIssues - cancelledIssues, 0);

  const stats: TStat[] = [
    {
      key: "projects",
      label: "Projects",
      value: joinedProjectIds.length,
      icon: <FolderKanban className="size-3.5 text-accent-primary" />,
      accent: "bg-accent-primary/15",
    },
    {
      key: "work-items",
      label: "Work items",
      value: totalIssues,
      icon: <LayoutGrid className="size-3.5 text-accent-primary" />,
      accent: "bg-accent-primary/15",
    },
    {
      key: "open",
      label: "Open",
      value: openIssues,
      icon: <BarChart3 className="size-3.5 text-warning-primary" />,
      accent: "bg-warning-primary/15",
    },
    {
      key: "completed",
      label: "Completed",
      value: completedIssues,
      icon: <CheckCircle2 className="size-3.5 text-success-primary" />,
      accent: "bg-success-primary/15",
    },
    {
      key: "members",
      label: "Team",
      value: workspaceMemberIds?.length ?? 0,
      icon: <Users className="size-3.5 text-accent-primary" />,
      accent: "bg-accent-primary/15",
    },
  ];

  return (
    <div className="flex flex-col gap-6 pt-2 pb-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((stat) => (
          <StatTile key={stat.key} stat={stat} />
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-14 font-semibold text-tertiary">Your projects</h2>
          <Link href={`/${slug}/projects/`} className="text-12 font-medium text-accent-primary hover:underline">
            View all
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {projects.map((project) => {
            if (!project) return null;
            const counts = getProjectAnalyticsCountById(project.id);
            const cancelled = counts?.cancelled_issues ?? 0;
            // Cancelled work is neither done nor outstanding, so drop it from both
            // sides of the ratio rather than scoring it as progress.
            const total = Math.max((counts?.total_issues ?? 0) - cancelled, 0);
            const done = Math.max((counts?.completed_issues ?? 0) - cancelled, 0);
            const percent = total > 0 ? Math.round((done / total) * 100) : 0;

            return (
              <Link
                key={project.id}
                href={`/${slug}/projects/${project.id}/issues/`}
                className="group flex flex-col gap-3 rounded-lg border border-subtle bg-layer-1 px-4 py-3.5 transition-colors hover:border-strong hover:bg-layer-1-hover"
              >
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex size-7 flex-shrink-0 items-center justify-center rounded-md bg-layer-2">
                    <Logo logo={project.logo_props} size={16} />
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-heading text-14 font-semibold text-primary">{project.name}</span>
                    <span className="text-11 font-medium text-tertiary">
                      {project.identifier} · {counts?.total_members ?? 0} members
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-11 text-tertiary">
                    <span>
                      {done} of {total} done
                    </span>
                    <span className="font-medium text-secondary">{percent}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-layer-2">
                    <div
                      className="h-full rounded-full bg-accent-primary transition-all"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
});
