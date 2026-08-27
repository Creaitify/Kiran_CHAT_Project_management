/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useSearchParams } from "next/navigation";
import { Plus, StickyNote, Trash2 } from "lucide-react";
// components
import { PageHead } from "@/components/core/page-title";
// apps
import { useAppContext } from "../use-app-context";
// local imports
import { noteTitle } from "./store";
import { useNotes } from "./use-notes";

/**
 * List on the left, editor on the right.
 *
 * Everything is written on change and read back from `localStorage`; there is no
 * save button because there is nothing to save to. The `?note=` parameter is the
 * deep link the palette uses, read once on mount so a jump lands on the right
 * note without the URL then fighting the user's clicks.
 */
export const NotesAppPage = observer(function NotesAppPage() {
  const { t } = useAppContext();
  const searchParams = useSearchParams();
  const { notes, createNote, updateNote, deleteNote, ready } = useNotes();

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Deep link from the command palette. Runs when the parameter changes rather
  // than only on mount, because jumping between two notes from the palette does
  // not remount this component.
  const requested = searchParams.get("note");
  useEffect(() => {
    if (requested) setSelectedId(requested);
  }, [requested]);

  // Keep a selection pointing at something that exists: deleting the open note,
  // or arriving with a stale `?note=`, must not leave an empty editor pane.
  useEffect(() => {
    if (!ready) return;
    if (selectedId && notes.some((note) => note.id === selectedId)) return;
    setSelectedId(notes[0]?.id ?? null);
  }, [ready, notes, selectedId]);

  const selected = notes.find((note) => note.id === selectedId) ?? null;

  return (
    <>
      <PageHead title={t("Notes")} />
      <div className="flex h-full w-full overflow-hidden">
        {/* ------------------------------------------------------ list */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-subtle">
          <div className="flex items-center justify-between gap-2 border-b border-subtle px-4 py-3">
            <h1 className="text-sm font-medium text-secondary">Notes</h1>
            <button
              type="button"
              onClick={() => setSelectedId(createNote())}
              aria-label="New note"
              className="flex size-7 items-center justify-center rounded-md text-icon-tertiary transition-colors hover:bg-layer-transparent-hover hover:text-icon-secondary"
            >
              <Plus className="size-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {!ready ? null : notes.length === 0 ? (
              <p className="px-2 py-8 text-center text-11 text-tertiary">
                Nothing yet. Notes are private to you and stay on this device.
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {notes.map((note) => (
                  <li key={note.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(note.id)}
                      className={`flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left transition-colors ${
                        note.id === selectedId
                          ? "bg-layer-transparent-selected"
                          : "hover:bg-layer-transparent-hover"
                      }`}
                    >
                      <span className="truncate text-13 text-primary">{noteTitle(note)}</span>
                      <span className="truncate text-11 text-tertiary">
                        {note.body.trim().split("\n")[0] || "Empty"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* ---------------------------------------------------- editor */}
        <section className="flex flex-1 flex-col overflow-hidden">
          {selected ? (
            <>
              <div className="flex items-center gap-2 border-b border-subtle px-6 py-3">
                <input
                  value={selected.title}
                  onChange={(event) => updateNote(selected.id, { title: event.target.value })}
                  placeholder={noteTitle(selected)}
                  aria-label="Note title"
                  className="flex-1 bg-transparent text-16 font-medium text-primary outline-none placeholder:text-placeholder"
                />
                <button
                  type="button"
                  onClick={() => deleteNote(selected.id)}
                  aria-label="Delete note"
                  className="flex size-7 items-center justify-center rounded-md text-icon-tertiary transition-colors hover:bg-danger-transparent hover:text-danger-primary"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <textarea
                value={selected.body}
                onChange={(event) => updateNote(selected.id, { body: event.target.value })}
                placeholder="Start typing…"
                aria-label="Note body"
                className="flex-1 resize-none bg-transparent px-6 py-5 text-14 leading-relaxed text-primary outline-none placeholder:text-placeholder"
              />
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-tertiary">
              <StickyNote className="size-8" />
              <p className="text-13">Select a note, or create one.</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
});
