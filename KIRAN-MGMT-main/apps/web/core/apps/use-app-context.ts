/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Everything an app is entitled to know about the shell it is running in.
 *
 * An app reads this instead of importing `useUser`, `useWorkspace`,
 * `useTranslation` and `useAppRouter` separately. The difference is not
 * convenience -- it is that this hook is a contract with a stable shape, while
 * those four are shell internals that get refactored. When the workspace store
 * moves, this file changes and no app does.
 *
 * Apps are not forbidden from reaching past it. Chat will need issue detail,
 * file uploads and workspace members, and inventing a facade for each would be
 * a full second API surface maintained by hand. The rule is narrower and
 * enforceable: *identity, workspace, locale and navigation come from here*,
 * because those four are what every app needs and what the shell most wants
 * freedom to change.
 */

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useTranslation } from "@plane/i18n";
import type { IUser, IWorkspace } from "@plane/types";
// hooks
import { useUser } from "@/hooks/store/user";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useAppRouter } from "@/hooks/use-app-router";

export type TAppContext = {
  /** The signed-in user. Null only during the first render after boot. */
  currentUser: IUser | undefined;
  /** The workspace the app is mounted in. Null while the store is loading it. */
  workspace: IWorkspace | null;
  /** Present whenever the app is mounted; apps only render inside a workspace. */
  workspaceSlug: string;
  /** Translate. Strings that are not dotted key paths pass through unchanged. */
  t: (key: string, params?: Record<string, unknown>) => string;
  /** Navigate within the shell. Use this rather than `window.location`. */
  router: ReturnType<typeof useAppRouter>;
};

export const useAppContext = (): TAppContext => {
  const { workspaceSlug } = useParams();
  const { data: currentUser } = useUser();
  const { currentWorkspace } = useWorkspace();
  const { t } = useTranslation();
  const router = useAppRouter();

  const slug = workspaceSlug?.toString() ?? "";

  return useMemo(
    () => ({
      currentUser,
      workspace: currentWorkspace,
      workspaceSlug: slug,
      t,
      router,
    }),
    [currentUser, currentWorkspace, slug, t, router]
  );
};
