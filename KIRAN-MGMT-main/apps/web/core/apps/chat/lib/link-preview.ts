/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Link unfurling.
 *
 * Fetching Open Graph metadata has to happen server-side — the browser can't
 * read another origin's `<head>`, and doing it from the client would leak every
 * viewer's IP to every linked host. So this module does the half that belongs
 * on the client: extract URLs from a message and render whatever metadata the
 * message already carries. `resolvePreviews` is the injection point for the
 * server unfurler; the local implementation derives what it can from the URL
 * itself and is clearly marked as such.
 */

import type { LinkPreview } from "./chat-types";

// Deliberately conservative: no auth-looking URLs, no non-http schemes.
const URL_PATTERN = /\bhttps?:\/\/[^\s<>()[\]"']+/gi;

export function extractUrls(text: string): string[] {
  const found = text.match(URL_PATTERN) ?? [];
  const unique: string[] = [];
  for (const raw of found) {
    // Trailing punctuation is almost always sentence punctuation, not the URL.
    const cleaned = raw.replace(/[.,;:!?)]+$/, "");
    if (!unique.includes(cleaned)) unique.push(cleaned);
  }
  return unique.slice(0, 3);
}

/**
 * Only http(s) survives — this is what guards the rendered anchor's href, and
 * the reason a `javascript:` or `data:` URL pasted into a message cannot become
 * a clickable link. `@plane/utils` has no equivalent guard; do not replace this
 * with a looser URL check.
 */
export function isSafeHref(href: string): boolean {
  try {
    const url = new URL(href, "https://example.invalid");
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function titleFromUrl(url: URL): string {
  const segments = url.pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) return url.hostname.replace(/^www\./, "");
  return decodeURIComponent(last)
    .replace(/\.(html?|php|aspx?)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Builds the best preview available without a network call. A real deployment
 * replaces this with a server endpoint that fetches and caches OG tags; the
 * shape it returns is identical, so nothing downstream changes.
 */
export function derivePreview(href: string): LinkPreview | null {
  if (!isSafeHref(href)) return null;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const siteName = url.hostname.replace(/^www\./, "");
  return {
    url: href,
    title: titleFromUrl(url),
    siteName,
    description: url.pathname === "/" ? siteName : `${siteName}${url.pathname}`,
  };
}

export function derivePreviews(text: string): LinkPreview[] {
  return extractUrls(text)
    .map(derivePreview)
    .filter((preview): preview is LinkPreview => preview !== null);
}

/**
 * Server-backed unfurl hook. Swap the body for a call to the API's unfurl
 * endpoint and the stored `linkPreviews` become real Open Graph metadata.
 */
export async function resolvePreviews(text: string): Promise<LinkPreview[]> {
  return derivePreviews(text);
}
