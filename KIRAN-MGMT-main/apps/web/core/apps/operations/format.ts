/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Rendering minutes and money.
 *
 * The only place in the app that divides. Everything upstream — the API, the
 * service, the store — carries integer minutes and integer minor units, so the
 * single rounding step happens here, once, at the moment a number becomes a
 * string a person reads.
 */

/**
 * `450` → `"7h 30m"`.
 *
 * Not "7.5h". A decimal hour is a number people have to convert in their head
 * before it means anything, and the conversion is where mistakes enter a
 * timesheet.
 */
export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0m";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  if (!rest) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/**
 * `123456` in INR → `"₹1,234.56"`.
 *
 * `Intl.NumberFormat` owns the separators and the symbol, because "₹1,23,456"
 * is correct in en-IN and "₹123,456" is correct in en-GB, and hand-rolling that
 * is how a finance screen ends up wrong for half its readers.
 *
 * The division by 100 assumes a two-decimal currency. That is true of INR, USD,
 * EUR and GBP; it is false of JPY and KWD, and this is the line to change when
 * one of those turns up rather than a reason to store floats now.
 */
export function formatMoney(amountMinor: number, currency = "INR", locale?: string): string {
  const safe = Number.isFinite(amountMinor) ? amountMinor : 0;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(safe / 100);
  } catch {
    // An unrecognised currency code should degrade to a readable number rather
    // than throwing inside a render.
    return `${currency} ${(safe / 100).toFixed(2)}`;
  }
}

/** `"2026-08-24"` → `"24 Aug"`. Compact, for dense tables. */
export function formatDay(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** An ISO date string for `n` days before today, for range defaults. */
export function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * `"7h 30m"`, `"7.5"`, `"90"` → minutes.
 *
 * The composer accepts all three because people type all three. A bare number is
 * read as minutes, not hours: "30" almost always means half an hour, and reading
 * it as thirty hours would sail past the 14-hour guard as a plausible-looking
 * mistake.
 */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;

  const hm = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/.exec(text);
  if (hm && (hm[1] || hm[2])) {
    return Number(hm[1] ?? 0) * 60 + Number(hm[2] ?? 0);
  }

  const decimalHours = /^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)$/.exec(text);
  if (decimalHours) return Math.round(Number(decimalHours[1]) * 60);

  const bare = /^(\d+(?:\.\d+)?)$/.exec(text);
  if (bare) return Math.round(Number(bare[1]));

  return null;
}
