/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Invite validity, kept as a pure function so both the store and the join page
 * apply exactly the same rule — and so it can be tested without React.
 *
 * This is optimistic UI only. It runs on data the client already holds, so it
 * cannot be the authority: `ChatRoomInvite` must re-check expiry and use count
 * when a code is actually redeemed, or an expired link is one devtools edit
 * away from working.
 */

import type { Invite } from "./chat-types";

export type InviteState = "active" | "expired" | "exhausted" | "none";

export function inviteIsUsable(
  invite: Invite | null | undefined,
  now: number = Date.now()
): InviteState {
  if (!invite) return "none";
  // A null limit means "no limit", not "zero".
  if (invite.expiresAt !== null && invite.expiresAt <= now) return "expired";
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) return "exhausted";
  return "active";
}

/** Default lifetime for a newly generated link: a week, capped at 50 uses. */
export const DEFAULT_INVITE = { expiresInMs: 7 * 86_400_000, maxUses: 50 } as const;
