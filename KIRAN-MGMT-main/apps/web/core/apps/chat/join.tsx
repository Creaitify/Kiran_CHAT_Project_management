/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, Clock, Sparkles, Users } from "lucide-react";
import { PageHead } from "@/components/core/page-title";
import { Button } from "./ui/button";
import { GroupAvatar, UserAvatar } from "./components/UserAvatar";
import { useChat } from "./store/chat-store";
import { formatUntil } from "./lib/time";

/**
 * The invite-join screen.
 *
 * Ported from the standalone app's `src/routes/join.$code.tsx`. It now renders
 * inside the workspace shell rather than as a full-page takeover, so the
 * standalone `min-h-screen` became `min-h-full` -- the shell's content area
 * clips overflow, and a viewport-height child inside it would scroll the
 * conversation out of reach rather than centre the card.
 */
export function ChatJoinPage() {
  const { code: codeParam, workspaceSlug } = useParams();
  const code = codeParam?.toString() ?? "";
  const slug = workspaceSlug?.toString() ?? "";
  const router = useRouter();
  const { roomByCode, joinByCode, userById, currentUser, inviteStatus, roomTitle } = useChat();
  const [error, setError] = useState<string | null>(null);

  const room = roomByCode(code);
  const status = inviteStatus(room?.invite);
  const alreadyMember = room?.participantIds.includes(currentUser.id) ?? false;
  const usable = Boolean(room) && (status === "active" || alreadyMember);

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-background px-4">
      <PageHead title="Join a group" />
      <div className="ambient-orb -top-20 left-1/3 h-96 w-96 bg-primary" />
      <div className="ambient-orb bottom-0 right-1/4 h-80 w-80 bg-ai" />
      <div className="glass relative w-full max-w-md rounded-xl p-8 text-center shadow-[var(--shadow-float)]">
        <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
          <Sparkles className="h-5 w-5" />
        </span>

        {room && usable ? (
          <>
            <p className="mt-5 text-xs uppercase tracking-widest text-muted-foreground">
              You've been invited to
            </p>
            <div className="mt-4 flex flex-col items-center gap-3">
              <GroupAvatar name={roomTitle(room)} color={room.color} photo={room.photo} size={68} />
              <h1 className="text-xl font-semibold">{roomTitle(room)}</h1>
              {room.description && (
                <p className="text-xs text-muted-foreground">{room.description}</p>
              )}
              <div className="flex -space-x-2">
                {room.participantIds.slice(0, 6).map((id) => (
                  <UserAvatar key={id} user={userById(id)} size={30} />
                ))}
              </div>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="h-3.5 w-3.5" /> {room.participantIds.length} members
              </p>
              {room.invite?.expiresAt && !alreadyMember && (
                <p
                  suppressHydrationWarning
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                >
                  <Clock className="h-3 w-3" /> Link expires {formatUntil(room.invite.expiresAt)}
                  {room.invite.maxUses
                    ? ` · ${room.invite.maxUses - room.invite.uses} uses left`
                    : ""}
                </p>
              )}
            </div>

            {error && <p className="mt-4 text-xs text-destructive">{error}</p>}

            <Button
              className="mt-6 w-full rounded-lg"
              onClick={async () => {
                // Redeeming an invite is a server call now -- the client cannot
                // be the authority on whether a link is still valid.
                const result = await joinByCode(code);
                if (result.error) {
                  setError(result.error);
                  return;
                }
                // The standalone app dropped you on the workspace root and let
                // the store's own active-room fallback decide where you landed.
                // Here the room is addressable, so say which one.
                const joined = result.room;
                router.push(joined ? `/${slug}/chat?room=${joined.id}` : `/${slug}/chat`);
              }}
            >
              {alreadyMember ? "Open group" : "Join group"}
            </Button>
          </>
        ) : (
          <>
            <span className="mx-auto mt-5 flex h-9 w-9 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="h-4 w-4" />
            </span>
            <h1 className="mt-3 text-lg font-semibold">
              {status === "expired"
                ? "This invite link has expired"
                : status === "exhausted"
                  ? "This invite link is fully used"
                  : "Invite link is no longer valid"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {status === "expired"
                ? "Ask a group admin to generate a fresh link."
                : status === "exhausted"
                  ? "It reached its usage limit. Ask an admin for a new one."
                  : "This invite was revoked or regenerated by the group admin."}
            </p>
            <Button
              variant="secondary"
              className="mt-6 w-full rounded-lg"
              onClick={() => router.push(`/${slug}/chat`)}
            >
              Back to workspace
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
