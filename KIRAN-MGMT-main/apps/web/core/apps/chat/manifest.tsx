/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { MessageSquareIcon } from "lucide-react";
import type { TAppManifest } from "../types";
import { useChatBadge, useChatPowerKCommands } from "./contributions";

/**
 * Chat -- the first app ported in under the registry rather than built on it.
 *
 * It claims `/:workspaceSlug/chat` and everything beneath, which includes the
 * invite-join screen. That screen has to live inside the app rather than beside
 * it: joining a room is a chat operation, and a person who follows an invite
 * link should land in the app they were invited to with the rail already
 * showing them where they are.
 *
 * No `isAvailable` gate. Chat is for everyone in the workspace, including
 * Guests -- gating it on role would mean a Guest could be added to a room and
 * then be unable to open it, which is worse than no gate at all. Room-level
 * authority is enforced per room by `ChatRoomMember.role`, which is the level
 * the question actually belongs at.
 */
export const chatAppManifest: TAppManifest = {
  key: "chat",
  label: "Chat",
  icon: <MessageSquareIcon className="size-5" />,
  path: (workspaceSlug) => `/${workspaceSlug}/chat`,
  matches: (pathname, workspaceSlug) => pathname.startsWith(`/${workspaceSlug}/chat`),
  order: 200,
  keySequence: "ac",
  keywords: ["messages", "conversations", "dm", "rooms", "inbox"],
  // Contributions to shared shell surfaces. Both are hooks the shell calls; see
  // `apps/contributions.ts` for why they are called for every registered app
  // rather than only the visible ones, and `./contributions.ts` for what chat
  // does with the visibility flag it is handed.
  useBadge: useChatBadge,
  usePowerKCommands: useChatPowerKCommands,
};
