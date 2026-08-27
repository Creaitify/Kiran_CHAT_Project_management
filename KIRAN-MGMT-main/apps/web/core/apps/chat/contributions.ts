/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * What chat puts on the shell's shared surfaces.
 *
 * Both hooks answer a question the shell asks; neither reaches into the shell to
 * push anything. That direction is the whole point of the contract — the rail
 * and the palette have no idea what a room is, and chat has no idea they exist
 * beyond the two types it returns.
 *
 * Both are driven by `useChatOverview`, which shares one slow poll between them.
 * Neither can use the chat store: the store lives inside `ChatProvider`, which
 * is mounted only while the chat app is open, which is precisely when a badge
 * telling you about chat stops being useful.
 */

import { useMemo } from "react";
import { MessageSquareIcon } from "lucide-react";
// components
import type { TPowerKCommandConfig } from "@/components/power-k/core/types";
// apps
import type { TAppBadge, TAppContributionContext } from "../types";
// local imports
import { useChatOverview } from "./services/overview";

/**
 * Unread messages on the rail icon, emphasised when any of them mention you.
 *
 * The emphasis is the point of the badge, not decoration. "Eleven unread" and
 * "one of these is addressed to you by name" are different facts, and a rail
 * that renders them identically teaches people to ignore both.
 */
export function useChatBadge(ctx: TAppContributionContext): TAppBadge | undefined {
  const overview = useChatOverview(ctx.workspaceSlug, ctx.isVisible);

  return useMemo(() => {
    if (!overview || overview.unread.total === 0) return undefined;

    const { total, mentions } = overview.unread;
    return {
      count: total,
      emphasis: mentions > 0,
      label: mentions
        ? `${total} unread, ${mentions} mentioning you`
        : `${total} unread message${total === 1 ? "" : "s"}`,
    };
  }, [overview]);
}

/**
 * One palette entry per conversation.
 *
 * The registry already generates "Go to Chat"; this is the layer below it —
 * Power-K lands you *in* the conversation rather than at chat's front door,
 * which is the difference between the palette being a switcher and being a jump
 * list.
 *
 * No `keySequence`: those are a scarce, hand-curated namespace and rooms are
 * neither. These are found by typing the room's name, which is what the palette
 * search is for.
 */
export function useChatPowerKCommands(ctx: TAppContributionContext): TPowerKCommandConfig[] {
  const overview = useChatOverview(ctx.workspaceSlug, ctx.isVisible);

  return useMemo(() => {
    if (!overview) return [];

    return overview.rooms.map<TPowerKCommandConfig>((room) => ({
      id: `chat_room_${room.id}`,
      type: "action",
      group: "navigation",
      // Not an i18n key: `t()` echoes back anything that is not a dotted key
      // path, so a room's own name reaches the palette without a locale file.
      i18n_title: room.title,
      i18n_description: room.unread
        ? `Chat · ${room.unread} unread${room.mentions ? `, ${room.mentions} mentioning you` : ""}`
        : "Chat",
      // `icon` rather than `iconNode`: this file is plain TypeScript with no
      // JSX, and `icon` is the field that takes a component.
      icon: MessageSquareIcon,
      keywords: ["chat", "conversation", "message", room.title.toLowerCase()],
      action: (commandCtx) => {
        const workspaceSlug = commandCtx.params.workspaceSlug?.toString();
        if (!workspaceSlug) return;
        // `?room=` is the deep link chat's own permalinks already use, so a
        // palette jump and a pasted link land the same way.
        //
        // `router.push` directly rather than `handlePowerKNavigate`: that helper
        // runs its result through `joinUrlPath`, which normalises by returning
        // `new URL(...).pathname` -- and a pathname has no query string. Every
        // command that ships one today is path-only, so the helper has never had
        // to care; routed through it, this would silently drop the room and land
        // on whichever conversation chat opens by default.
        commandCtx.router.push(`/${workspaceSlug}/chat?room=${room.id}`);
      },
      isEnabled: (commandCtx) => Boolean(commandCtx.params.workspaceSlug?.toString()),
      isVisible: (commandCtx) => Boolean(commandCtx.params.workspaceSlug?.toString()),
      closeOnSelect: true,
    }));
  }, [overview]);
}
