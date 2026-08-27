/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Outlet } from "react-router";
import { ChatProvider } from "./store/chat-store";
import { I18nProvider } from "./lib/i18n";
import { Toaster } from "./ui/sonner";

/**
 * The Chat app's frame.
 *
 * This is what the standalone app's `__root.tsx` reduces to once the shell owns
 * the document. Gone: the `<html>/<head>/<body>` shell component, the head/meta
 * block, the font and stylesheet <link> tags, the 404 and error components
 * (the route file re-exports `AppErrorBoundary` instead), the `ThemeProvider`
 * (KIRAN owns light/dark for everything) and the `QueryClientProvider` -- chat
 * never called a single react-query hook, the provider was scaffolding.
 *
 * What survives is chat's own state: the conversation store, chat's locale
 * context, and its toaster.
 *
 * `kiran-chat-app` is load-bearing. `core/apps/chat/styles.css` scopes the
 * vendored shadcn custom properties to that class precisely so they cannot
 * leak into the rest of the shell; without it every chat component renders
 * against KIRAN's tokens instead of its own.
 *
 * The rounded, bordered container matches Hello and Projects because that
 * border is the shell's content area, not chat's chrome.
 */
export function ChatAppShell() {
  return (
    <div className="kiran-chat-app relative flex h-full w-full flex-col overflow-hidden rounded-lg border border-subtle">
      <I18nProvider>
        <ChatProvider>
          <main className="relative flex h-full w-full min-h-0 flex-col overflow-hidden">
            {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
            <Outlet />
          </main>
          <Toaster position="top-right" closeButton />
        </ChatProvider>
      </I18nProvider>
    </div>
  );
}
