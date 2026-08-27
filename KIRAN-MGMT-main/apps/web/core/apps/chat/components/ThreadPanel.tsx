/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef } from "react";
import { Bell, BellOff, X } from "lucide-react";
import { useChat } from "../store/chat-store";
import type { SharedMessage } from "../lib/chat-types";
import { useI18n } from "../lib/i18n";
import { MessageItem } from "./MessageItem";
import { Composer } from "./Composer";
import { cn } from "../lib/cn";

export interface ThreadPanelProps {
  rootId: string;
  onClose: () => void;
  onForward: (message: SharedMessage) => void;
}

export function ThreadPanel({ rootId, onClose, onForward }: ThreadPanelProps) {
  const { messageById, threadReplies, threadCount, isFollowingThread, toggleFollowThread } =
    useChat();
  const { t } = useI18n();
  const root = messageById(rootId);
  const replies = threadReplies(rootId);
  const bottomRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [replies.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (!root) return null;
  const following = isFollowingThread(rootId);

  return (
    <aside
      ref={panelRef}
      role="complementary"
      aria-label={t("thread.title")}
      className="flex h-full w-full flex-col border-l border-border bg-surface"
    >
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border px-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{t("thread.title")}</h2>
          <p className="truncate text-[11px] text-muted-foreground">
            {t("thread.replies", { count: threadCount(rootId) })}
          </p>
        </div>
        <button
          onClick={() => toggleFollowThread(rootId)}
          aria-pressed={following}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
            following
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-border bg-surface hover:bg-secondary",
          )}
        >
          {following ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
          {following ? t("thread.unfollow") : t("thread.follow")}
        </button>
        <button
          onClick={onClose}
          aria-label="Close thread"
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <MessageItem
          message={root}
          onReply={() => {}}
          onOpenThread={() => {}}
          onForward={onForward}
          compact
        />
        <div className="flex items-center gap-2">
          <span className="h-px flex-1 bg-border" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {replies.length === 0
              ? t("thread.empty")
              : t("thread.replies", { count: replies.length })}
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>
        {replies.map((reply) => (
          <MessageItem
            key={reply.id}
            message={reply}
            onReply={() => {}}
            onOpenThread={() => {}}
            onForward={onForward}
            compact
          />
        ))}
        <div ref={bottomRef} />
      </div>

      <Composer replyTo={null} clearReply={() => {}} threadRootId={rootId} autoFocus />
    </aside>
  );
}
