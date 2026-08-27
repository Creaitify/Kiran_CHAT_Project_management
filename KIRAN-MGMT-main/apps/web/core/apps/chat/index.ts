/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * The Chat app's public surface.
 *
 * Everything outside `core/apps/chat/` should import from here rather than
 * reaching into the directory: the components, store, lib and vendored shadcn
 * primitives are chat's internals and are free to move.
 *
 * `routes.ts` is deliberately NOT re-exported. It is a build-time module that
 * React Router's Node-side config loader evaluates before a browser exists,
 * and pulling it through a barrel that also exports JSX would drag components
 * into that evaluation. `core/apps/routes.ts` imports it by its own path.
 */
export { ChatAppShell } from "./shell";
export { ChatWorkspacePage } from "./workspace";
export { ChatJoinPage } from "./join";
export { chatAppManifest } from "./manifest";
