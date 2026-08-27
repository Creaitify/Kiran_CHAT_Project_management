/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Notes, kept entirely in the browser.
 *
 * There is no API behind this file and that is the point of the app. Stage 2's
 * constraint said "the contract must not assume a module has a backend, since
 * some will not", and nothing had ever tested it — `hello` has no backend but
 * also no state, and chat has one of the heaviest backends in the product. This
 * is the case in between: real state, real persistence, zero server.
 *
 * Scoped per workspace *and* per user. Two people on one machine sharing a
 * notes list would be a surprise, and the same person's notes following them
 * between workspaces would be a different one.
 *
 * Reads never throw. A private window, disabled storage, or a value someone
 * hand-edited all degrade to "no notes" rather than to a blank screen — losing
 * notes is bad, failing to mount is worse, and this app is also the shell's
 * canary for lazy-loading and error boundaries.
 */

const KEY_PREFIX = "kiran-notes-v1";

export type TNote = {
  id: string;
  title: string;
  body: string;
  updatedAt: number;
};

function storageKey(workspaceSlug: string, userId: string): string {
  return `${KEY_PREFIX}:${workspaceSlug}:${userId}`;
}

function isNote(value: unknown): value is TNote {
  if (typeof value !== "object" || value === null) return false;
  const note = value as Partial<TNote>;
  return (
    typeof note.id === "string" &&
    typeof note.title === "string" &&
    typeof note.body === "string" &&
    typeof note.updatedAt === "number"
  );
}

export function readNotes(workspaceSlug: string, userId: string): TNote[] {
  if (typeof window === "undefined" || !workspaceSlug || !userId) return [];
  try {
    const raw = window.localStorage.getItem(storageKey(workspaceSlug, userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Filtered rather than trusted: this value survives deploys, so a shape from
    // an older version of this file is a normal thing to find here.
    return parsed.filter(isNote).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function writeNotes(workspaceSlug: string, userId: string, notes: TNote[]): void {
  if (typeof window === "undefined" || !workspaceSlug || !userId) return;
  try {
    window.localStorage.setItem(storageKey(workspaceSlug, userId), JSON.stringify(notes));
  } catch {
    // Quota, or storage disabled. The note stays on screen and is lost on
    // reload, which is the honest outcome and better than an alert nobody can
    // act on.
  }
}

/** Stable enough for a client-only id. */
export function newNoteId(): string {
  return `n_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

/** First line, or a placeholder. What the palette and the list both show. */
export function noteTitle(note: TNote): string {
  const fromTitle = note.title.trim();
  if (fromTitle) return fromTitle;
  const firstLine = note.body.trim().split("\n")[0]?.trim();
  return firstLine || "Untitled note";
}
