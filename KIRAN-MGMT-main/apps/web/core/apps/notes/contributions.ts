/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * What Notes puts on the shell's shared surfaces.
 *
 * Deliberately only one of the two available contributions. Notes has no badge
 * — a count of things you wrote yourself is not a notification, and a rail that
 * shows a number for every app teaches people that numbers mean nothing. Leaving
 * `useBadge` off is also the test: an app must be able to take one contribution
 * and skip the other without the shell noticing.
 *
 * The palette source is local state, not a fetch, which is the shape chat could
 * not test. If `usePowerKCommands` had accidentally been designed around
 * something asynchronous, this is where it would show.
 */

import { useMemo } from "react";
import { StickyNoteIcon } from "lucide-react";
// components
import type { TPowerKCommandConfig } from "@/components/power-k/core/types";
import { handlePowerKNavigate } from "@/components/power-k/utils/navigation";
// apps
import type { TAppContributionContext } from "../types";
// local imports
import { noteTitle } from "./store";
import { useNotes } from "./use-notes";

export function useNotesPowerKCommands(ctx: TAppContributionContext): TPowerKCommandConfig[] {
  const { notes } = useNotes(ctx.isVisible);

  return useMemo(
    () =>
      notes.slice(0, 25).map<TPowerKCommandConfig>((note) => ({
        id: `note_${note.id}`,
        type: "action",
        group: "navigation",
        // Not an i18n key: `t()` echoes back anything that is not a dotted key
        // path, so a note's own first line reaches the palette untranslated,
        // which is correct — it is the user's text.
        i18n_title: noteTitle(note),
        i18n_description: "Note",
        icon: StickyNoteIcon,
        keywords: ["note", "notes", "scratch"],
        action: (commandCtx) => {
          const workspaceSlug = commandCtx.params.workspaceSlug?.toString();
          if (!workspaceSlug) return;
          handlePowerKNavigate(commandCtx, [`/${workspaceSlug}/notes?note=${note.id}`]);
        },
        isEnabled: (commandCtx) => Boolean(commandCtx.params.workspaceSlug?.toString()),
        isVisible: (commandCtx) => Boolean(commandCtx.params.workspaceSlug?.toString()),
        closeOnSelect: true,
      })),
    [notes]
  );
}
