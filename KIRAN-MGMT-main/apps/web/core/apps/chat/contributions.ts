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

import { useEffect, useMemo, useState } from "react";
import { MessageSquareIcon } from "lucide-react";
// components
import type { TPowerKCommandConfig } from "@/components/power-k/core/types";
import { handlePowerKNavigate } from "@/components/power-k/utils/navigation";
// apps
import type { TBacklinks, TEntityLinkSpec, TEntityRef } from "../links";
import type { TAppBadge, TAppContributionContext } from "../types";
// local imports
import { ChatService } from "./services/chat.service";
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
        // palette jump and a pasted link land the same way. The helper used to
        // drop the query -- that was a shell defect, and it is fixed in the
        // shell rather than worked around here.
        handlePowerKNavigate(commandCtx, [`/${workspaceSlug}/chat?room=${room.id}`]);
      },
      isEnabled: (commandCtx) => Boolean(commandCtx.params.workspaceSlug?.toString()),
      isVisible: (commandCtx) => Boolean(commandCtx.params.workspaceSlug?.toString()),
      closeOnSelect: true,
    }));
  }, [overview]);
}

/* -------------------------------------------------------------------------- */
/* Backlinks                                                                  */
/* -------------------------------------------------------------------------- */

const service = new ChatService();

const EMPTY: TBacklinks = { items: [], loading: false };

/**
 * Which conversations mention somebody else's object.
 *
 * The ref arrives as three opaque strings and leaves as three opaque strings —
 * this hook never asks what `kind` means, and the endpoint behind it does not
 * either. That is the whole test: projects renders a list of chat messages about
 * a work item, and neither app imports the other.
 *
 * Fetched per ref with no cache. A work item's panel is opened deliberately and
 * read once; the thirty-second poll that keeps the rail badge current would be
 * the wrong shape here, and caching a list nobody is watching change is worse
 * than re-asking.
 */
export function useChatBacklinks(ref: TEntityRef | null, ctx: TAppContributionContext): TBacklinks {
  const [state, setState] = useState<TBacklinks>(EMPTY);

  const kind = ref?.kind ?? "";
  const id = ref?.id ?? "";
  const { workspaceSlug, isVisible } = ctx;

  useEffect(() => {
    if (!isVisible || !workspaceSlug || !kind || !id) {
      setState(EMPTY);
      return;
    }

    let live = true;
    setState({ items: [], loading: true });

    void service
      .fetchReferences(workspaceSlug, kind, id)
      .then((response) => {
        if (!live) return;
        setState({
          loading: false,
          items: (response?.items ?? []).map((item) => ({
            id: item.id,
            excerpt: item.excerpt,
            // `?room=` and `&msg=` are chat's own permalink shape, so a click
            // from a work item lands exactly where a pasted link would.
            href: `/${workspaceSlug}/chat?room=${item.room_id}&msg=${item.id}`,
            timestamp: Date.parse(item.created_at) || 0,
            ...(item.author ? { author: item.author } : {}),
          })),
        });
      })
      .catch(() => {
        // A panel that says "no conversations" when chat is down is wrong but
        // harmless; one that throws takes the work item's screen with it.
        if (live) setState(EMPTY);
      });

    return () => {
      live = false;
    };
  }, [isVisible, workspaceSlug, kind, id]);

  return state;
}

/* -------------------------------------------------------------------------- */
/* Entity links — chat's messages, as things other apps can point at          */
/* -------------------------------------------------------------------------- */

/**
 * A message, as a referenceable object.
 *
 * Registered so that an operations reminder set on a message can be clicked
 * back to the message. Operations stores the ref and never looks inside it;
 * resolving it to a URL is this file's job and only this file's.
 *
 * **The id is `roomId:messageId`.** A permalink needs both -- chat opens a room
 * and then scrolls -- and the contract is explicit that an app's id is opaque
 * and never parsed by anyone else, so packing two into one string is the
 * intended way to do this rather than a workaround. Nothing outside this file
 * splits it.
 *
 * `parse` never claims anything, deliberately. Chat's permalinks are
 * `?room=&msg=`, and `parse` is given a pathname on purpose: a matcher that
 * needs a query string is describing a screen state rather than an object. So a
 * chat link pasted into a work item stays an ordinary link. The asymmetry is
 * real and the alternative -- giving every message a path -- is a routing change
 * nobody has asked for.
 */
export const chatEntityLinks: TEntityLinkSpec = {
  parse: () => null,
  href: (ref, workspaceSlug) => {
    if (ref.kind !== "message") return null;
    const separator = ref.id.indexOf(":");
    if (separator <= 0) return null;
    const roomId = ref.id.slice(0, separator);
    const messageId = ref.id.slice(separator + 1);
    if (!roomId || !messageId) return null;
    return `/${workspaceSlug}/chat?room=${encodeURIComponent(roomId)}&msg=${encodeURIComponent(messageId)}`;
  },
  // Pure and synchronous, so it cannot reach the text. Anything that needs the
  // excerpt is handed one at the call site -- see `TEntityTarget` in links.ts.
  label: (ref) => (ref.kind === "message" ? "Message" : ref.kind),
};
