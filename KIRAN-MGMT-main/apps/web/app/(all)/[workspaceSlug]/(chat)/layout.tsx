/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// Route files stay thin: React Router needs a module at this path, but the app
// itself lives in `core/apps/chat` so it is one self-contained directory.
export { ChatAppShell as default } from "@/apps/chat/shell";

// Required of every app. Without it a crash inside this app bubbles to the root
// boundary and replaces the whole shell -- rail included. See MODULES.md.
export { AppErrorBoundary as ErrorBoundary } from "@/apps/error-boundary";
