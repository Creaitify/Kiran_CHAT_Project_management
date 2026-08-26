/**
 * Invite validity, kept as a pure function so both the store and the join page
 * apply exactly the same rule — and so it can be tested without React.
 */

import type { Invite } from "./chat-types";

export type InviteState = "active" | "expired" | "exhausted" | "none";

export function inviteIsUsable(
  invite: Invite | null | undefined,
  now: number = Date.now(),
): InviteState {
  if (!invite) return "none";
  // A null limit means "no limit", not "zero".
  if (invite.expiresAt !== null && invite.expiresAt <= now) return "expired";
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) return "exhausted";
  return "active";
}

/** Default lifetime for a newly generated link: a week, capped at 50 uses. */
export const DEFAULT_INVITE = { expiresInMs: 7 * 86_400_000, maxUses: 50 } as const;
