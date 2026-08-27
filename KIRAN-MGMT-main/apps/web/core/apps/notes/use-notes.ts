/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * The notes list, shared between the page and the palette.
 *
 * Module-scope rather than a React context, for the same reason chat's overview
 * cache is: the palette is mounted in the shell, outside this app, and a context
 * would have to live above both — which means the shell hosting a notes-shaped
 * provider. The contract exists to prevent exactly that.
 *
 * Subscribers are notified on every write, so the page and the palette never
 * disagree about what exists.
 */

import { useCallback, useEffect, useState } from "react";
// apps
import { useAppContext } from "../use-app-context";
// local imports
import { newNoteId, readNotes, writeNotes, type TNote } from "./store";

type TListener = (notes: TNote[]) => void;

const listeners = new Set<TListener>();
/** Keyed `slug:userId`, matching the storage key. */
const cache = new Map<string, TNote[]>();

function scopeKey(workspaceSlug: string, userId: string): string {
  return `${workspaceSlug}:${userId}`;
}

function load(workspaceSlug: string, userId: string): TNote[] {
  const key = scopeKey(workspaceSlug, userId);
  let notes = cache.get(key);
  if (!notes) {
    notes = readNotes(workspaceSlug, userId);
    cache.set(key, notes);
  }
  return notes;
}

function commit(workspaceSlug: string, userId: string, notes: TNote[]): void {
  cache.set(scopeKey(workspaceSlug, userId), notes);
  writeNotes(workspaceSlug, userId, notes);
  for (const listener of listeners) listener(notes);
}

export type TUseNotes = {
  notes: TNote[];
  /** Returns the new note's id so the caller can focus it. */
  createNote: () => string;
  updateNote: (id: string, patch: Partial<Pick<TNote, "title" | "body">>) => void;
  deleteNote: (id: string) => void;
  /** False until the first read, so the page can tell "empty" from "not yet". */
  ready: boolean;
};

/**
 * @param enabled pass `false` from a contribution hook whose app is hidden —
 * the hook still runs (see `apps/contributions.ts`) and must do nothing.
 */
export function useNotes(enabled = true): TUseNotes {
  const { currentUser, workspaceSlug } = useAppContext();
  const userId = currentUser?.id ?? "";

  // localStorage is not available during SSR, so the first client render has to
  // match the server's empty one. Reading in an effect rather than in the
  // initialiser is what keeps hydration from mismatching.
  const [notes, setNotes] = useState<TNote[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled || !workspaceSlug || !userId) {
      setReady(false);
      return;
    }
    setNotes(load(workspaceSlug, userId));
    setReady(true);

    listeners.add(setNotes);
    return () => {
      listeners.delete(setNotes);
    };
  }, [enabled, workspaceSlug, userId]);

  const createNote = useCallback(() => {
    const note: TNote = { id: newNoteId(), title: "", body: "", updatedAt: Date.now() };
    commit(workspaceSlug, userId, [note, ...load(workspaceSlug, userId)]);
    return note.id;
  }, [workspaceSlug, userId]);

  const updateNote = useCallback(
    (id: string, patch: Partial<Pick<TNote, "title" | "body">>) => {
      const next = load(workspaceSlug, userId)
        .map((note) => (note.id === id ? { ...note, ...patch, updatedAt: Date.now() } : note))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      commit(workspaceSlug, userId, next);
    },
    [workspaceSlug, userId]
  );

  const deleteNote = useCallback(
    (id: string) => {
      commit(
        workspaceSlug,
        userId,
        load(workspaceSlug, userId).filter((note) => note.id !== id)
      );
    },
    [workspaceSlug, userId]
  );

  return { notes, createNote, updateNote, deleteNote, ready };
}
