/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Bookmark, Pin } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { useChat } from "../store/chat-store";
import { previewText, type SharedMessage } from "../lib/chat-types";
import { formatRelative } from "../lib/time";
import { useI18n } from "../lib/i18n";
import { UserAvatar } from "./UserAvatar";

export type SavedPinnedMode = "saved" | "pinned" | null;

export function SavedPinnedDialog({
  mode,
  onClose,
}: {
  mode: SavedPinnedMode;
  onClose: () => void;
}) {
  const {
    savedMessages,
    pinnedMessages,
    activeRoom,
    roomTitle,
    rooms,
    userById,
    jumpToMessage,
    plainText,
  } = useChat();
  const { t } = useI18n();

  const items: SharedMessage[] =
    mode === "saved" ? savedMessages() : mode === "pinned" ? pinnedMessages(activeRoom.id) : [];

  return (
    <Dialog open={mode !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg rounded-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "saved" ? (
              <>
                <Bookmark className="h-4 w-4" /> Saved items
              </>
            ) : (
              <>
                <Pin className="h-4 w-4" /> Pinned in {roomTitle(activeRoom)}
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-96 space-y-2 overflow-y-auto">
          {items.length === 0 && (
            <p className="py-10 text-center text-xs text-muted-foreground">
              {mode === "saved" ? t("saved.empty") : t("pinned.empty")}
            </p>
          )}
          {items.map((message) => {
            const room = rooms.find((r) => r.id === message.roomId);
            return (
              <button
                key={message.id}
                onClick={() => {
                  jumpToMessage(message.roomId, message.id);
                  onClose();
                }}
                className="flex w-full items-start gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:bg-secondary"
              >
                <UserAvatar user={userById(message.senderId)} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <b className="truncate text-xs font-semibold">
                      {userById(message.senderId).name}
                    </b>
                    {room && mode === "saved" && (
                      <span className="truncate rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {roomTitle(room)}
                      </span>
                    )}
                    <span
                      suppressHydrationWarning
                      className="ml-auto shrink-0 text-[10px] text-muted-foreground"
                    >
                      {formatRelative(message.timestamp)}
                    </span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                    {plainText(previewText(message))}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
