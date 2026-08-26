/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { Pin } from "lucide-react";
import { useChat } from "../store/chat-store";
import { previewText } from "../lib/chat-types";

export function PinnedMessageBanner({ onViewAll }: { onViewAll: () => void }) {
  const { activeRoom, pinnedMessages, plainText, userById, jumpToMessage } = useChat();
  const pinned = pinnedMessages(activeRoom.id);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex(0);
  }, [activeRoom.id]);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, pinned.length - 1)));
  }, [pinned.length]);

  const message = pinned[activeIndex];
  if (!message) return null;

  const sender = userById(message.senderId).name.split(" ")[0];
  const text = plainText(previewText(message));

  return (
    <div className="flex h-[54px] shrink-0 items-stretch border-b border-border bg-surface px-3 shadow-sm md:px-5">
      <button
        type="button"
        onClick={() => {
          jumpToMessage(message.roomId, message.id);
          if (pinned.length > 1) {
            setActiveIndex((index) => (index + 1) % pinned.length);
          }
        }}
        className="group flex min-w-0 flex-1 items-center gap-3 text-left"
        aria-label={`Jump to pinned message ${activeIndex + 1} of ${pinned.length} from ${sender}: ${text}`}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
          <Pin className="h-3.5 w-3.5 fill-current" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-[11px] font-semibold text-primary">
            Pinned message
            {pinned.length > 1 && (
              <span className="font-normal text-muted-foreground">
                {activeIndex + 1} of {pinned.length}
              </span>
            )}
          </span>
          <span className="block truncate text-xs text-foreground">
            <b>{sender}:</b> {text}
          </span>
        </span>
      </button>

      <div className="ml-2 flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onViewAll}
          className="hidden rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:block"
        >
          View all
        </button>
      </div>
    </div>
  );
}
