/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Timestamp formatting.
 *
 * Everything here takes an explicit locale and IANA time zone instead of
 * relying on the host default, so a message renders identically on the server
 * (SSR) and in the browser, and so "their local time" can be shown for a
 * teammate in another region.
 *
 * `@plane/utils` already has `renderFormattedTime` and `calculateTimeAgo`, but
 * neither is zone-aware and neither buckets by day, which is what the message
 * list's separators need — hence this module rather than a re-export.
 */

const DAY = 86_400_000;

export interface TimeOptions {
  locale?: string;
  timeZone?: string;
  hour12?: boolean;
}

function opts(o: TimeOptions | undefined) {
  return {
    locale: o?.locale ?? "en-US",
    timeZone: o?.timeZone,
    hour12: o?.hour12 ?? true,
  };
}

/** Detects the viewer's zone, falling back to UTC where Intl is unavailable. */
export function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function formatTime(timestamp: number, options?: TimeOptions) {
  const { locale, timeZone, hour12 } = opts(options);
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12,
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(timestamp));
}

export function formatDate(timestamp: number, options?: TimeOptions) {
  const { locale, timeZone } = opts(options);
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(timestamp));
}

export function formatDateTime(timestamp: number, options?: TimeOptions) {
  const { locale, timeZone, hour12 } = opts(options);
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12,
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(timestamp));
}

/**
 * Day separator label: "Today" / "Yesterday" / a weekday for the last week /
 * an absolute date beyond that. Compared in the target zone so a message sent
 * at 11pm local doesn't land under the wrong heading.
 *
 * TODO(i18n): "Today" and "Yesterday" are hardcoded English. They belong in
 * `packages/i18n` under the `chat.` namespace alongside the rest of the app's
 * strings; every other label here already comes out of `Intl` in the caller's
 * locale.
 */
export function formatDayLabel(timestamp: number, options?: TimeOptions, now = Date.now()) {
  const { locale, timeZone } = opts(options);
  const key = (ts: number) =>
    new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...(timeZone ? { timeZone } : {}),
    }).format(new Date(ts));

  const target = key(timestamp);
  if (target === key(now)) return "Today";
  if (target === key(now - DAY)) return "Yesterday";
  if (now - timestamp < DAY * 6) {
    return new Intl.DateTimeFormat(locale, {
      weekday: "long",
      ...(timeZone ? { timeZone } : {}),
    }).format(new Date(timestamp));
  }
  return formatDate(timestamp, options);
}

/** Stable day bucket key, used to group messages under separators. */
export function dayKey(timestamp: number, timeZone?: string) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(timestamp));
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000_000],
  ["month", 2_592_000_000],
  ["week", 604_800_000],
  ["day", DAY],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

export function formatRelative(timestamp: number, options?: TimeOptions, now = Date.now()) {
  const { locale } = opts(options);
  const delta = timestamp - now;
  const abs = Math.abs(delta);
  if (abs < 45_000) return "just now";
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (abs >= ms) return formatter.format(Math.round(delta / ms), unit);
  }
  return formatter.format(Math.round(delta / 60_000), "minute");
}

/** "2:15 PM" in someone else's zone, for the profile card. */
export function localTimeFor(timeZone: string, locale = "en-US", now = Date.now()) {
  return formatTime(now, { locale, timeZone });
}

/** Short duration label for the scheduled-send picker: "in 2 hours". */
export function formatUntil(timestamp: number, options?: TimeOptions, now = Date.now()) {
  return formatRelative(timestamp, options, now);
}
