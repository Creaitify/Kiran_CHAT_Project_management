/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * shadcn's `cn`, which KIRAN already has.
 *
 * `@plane/utils` exports a byte-identical `twMerge(clsx(inputs))`. Vendoring a
 * second copy would mean apps/web carrying `tailwind-merge` twice and two
 * class-merge implementations that could drift. The chat components import
 * `../lib/cn` because that is what a self-contained app directory looks like;
 * this file is the one line that makes it true.
 */
export { cn } from "@plane/utils";
