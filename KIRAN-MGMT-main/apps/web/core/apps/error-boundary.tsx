/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { isRouteErrorResponse } from "react-router";
import { Button } from "@plane/propel/button";
// hooks
import { useAppRouter } from "@/hooks/use-app-router";

/**
 * Contains a crashing app inside its own pane.
 *
 * React Router bubbles a render error to the nearest route module that exports
 * `ErrorBoundary`. Without one per app that is `app/root.tsx`, whose boundary
 * replaces the entire document -- so a bug in Chat would take the app rail, the
 * top bar and Projects down with it, and the user's only route out would be a
 * page reload.
 *
 * Every app's layout route must re-export this:
 *
 *   export { AppErrorBoundary as ErrorBoundary } from "@/apps/error-boundary";
 *
 * The shell cannot enforce that -- React Router reads the export off the route
 * module, and there is no hook to inject one. It is a convention, and
 * MODULES.md names it as a required step.
 *
 * The error is not rendered. In development the console and the Vite overlay
 * already carry the stack with source maps, and putting a raw message on screen
 * in production leaks internals to whoever triggered it.
 */
export function AppErrorBoundary({ error }: { error: unknown }) {
  const router = useAppRouter();

  // A 404 inside an app is a wrong URL, not a crash; say the smaller thing.
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.error("[app-error-boundary] An app crashed and was contained.", error);
  }

  return (
    <div className="flex h-full w-full items-center justify-center rounded-lg border border-subtle bg-surface-1 p-8">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <h2 className="text-base font-semibold text-primary">
          {isNotFound ? "This page doesn't exist" : "Something broke in this app"}
        </h2>
        <p className="text-sm text-tertiary">
          {isNotFound
            ? "The address is wrong, or whatever was here has been removed."
            : "The rest of KIRAN is still running — switch apps from the rail, or reload to try this one again."}
        </p>
        <div className="mt-1 flex items-center gap-2">
          {/* `router.refresh()` is a full page reload in the next/navigation
              shim. That is the honest recovery here: React Router keeps a
              route's error state until something remounts the tree, so a
              softer retry would show this same pane again. */}
          <Button variant="secondary" size="sm" onClick={() => router.refresh()}>
            Reload
          </Button>
        </div>
      </div>
    </div>
  );
}
