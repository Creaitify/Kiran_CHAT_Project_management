/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Archive,
  AtSign,
  Clock,
  Hash,
  Lock,
  Paperclip,
  Send,
  Smile,
  Sparkles,
  VolumeX,
  X,
} from "lucide-react";
import { useChat } from "../store/chat-store";
import { previewText, type SharedMessage } from "../lib/chat-types";
import { activeMentionQuery, mentionCandidates } from "../lib/mentions";
import { commandSuggestions, findCommand, parseSlash } from "../lib/slash-commands";
import { useSlashActions } from "../lib/use-slash-actions";
import { useI18n } from "../lib/i18n";
import { formatDateTime } from "../lib/time";
import { UserAvatar } from "./UserAvatar";
import { EmojiPicker } from "./EmojiPicker";
import { ScheduleDialog } from "./ScheduleDialog";
import { cn } from "../lib/cn";

export interface ComposerProps {
  replyTo: SharedMessage | null;
  clearReply: () => void;
  /** Set when the composer is rendered inside the thread side panel. */
  threadRootId?: string | null;
  onOpenInvite?: () => void;
  onOpenShortcuts?: () => void;
  autoFocus?: boolean;
}

export function Composer({
  replyTo,
  clearReply,
  threadRootId = null,
  onOpenInvite,
  onOpenShortcuts,
  autoFocus = false,
}: ComposerProps) {
  const {
    activeRoom,
    currentUser,
    currentUserId,
    users,
    userGroups,
    canSend,
    sendMessage,
    sendAttachment,
    askAgent,
    scheduleMessage,
    scheduledMessages,
    cancelScheduled,
    userById,
    plainText,
    getDraft,
    saveDraft,
    clearDraft,
    online,
  } = useChat();
  const { t } = useI18n();
  const slashActions = useSlashActions({
    ...(onOpenInvite ? { openInvite: onOpenInvite } : {}),
    ...(onOpenShortcuts ? { openShortcuts: onOpenShortcuts } : {}),
  });

  const [value, setValue] = useState("");
  const [caret, setCaret] = useState(0);
  const [showEmoji, setShowEmoji] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Guards the draft restore from clobbering what the user is typing. */
  const loadedFor = useRef<string>("");

  const permission = canSend(activeRoom, currentUserId);
  const isAgent =
    /^@agent\b/i.test(value.trimStart()) || /^\/(agent|ai|ask)\b/i.test(value.trimStart());
  const queued = scheduledMessages(activeRoom.id);
  const pendingPreviews = useMemo(
    () => pendingFiles.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [pendingFiles],
  );

  useEffect(
    () => () => pendingPreviews.forEach((preview) => URL.revokeObjectURL(preview.url)),
    [pendingPreviews],
  );

  /* ---------------- drafts ---------------- */

  const draftScope = `${activeRoom.id}:${threadRootId ?? ""}`;
  useEffect(() => {
    if (loadedFor.current === draftScope) return;
    loadedFor.current = draftScope;
    setPendingFiles([]);
    const draft = getDraft(activeRoom.id, threadRootId);
    setValue(draft?.text ?? "");
    setCaret(draft?.text.length ?? 0);
  }, [draftScope, activeRoom.id, threadRootId, getDraft]);

  // Debounced so a fast typist doesn't write to storage on every keystroke.
  useEffect(() => {
    if (loadedFor.current !== draftScope) return;
    const timer = setTimeout(() => {
      saveDraft(
        activeRoom.id,
        { text: value, replyToId: replyTo?.id ?? null, threadRootId },
        threadRootId,
      );
    }, 400);
    return () => clearTimeout(timer);
  }, [value, draftScope, activeRoom.id, threadRootId, replyTo, saveDraft]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  /* ---------------- autocomplete ---------------- */

  const mention = useMemo(() => activeMentionQuery(value, caret), [value, caret]);
  const mentionOptions = useMemo(
    () =>
      mention
        ? mentionCandidates(
            mention.query,
            users,
            userGroups,
            currentUserId,
            activeRoom.participantIds,
          )
        : [],
    [mention, users, userGroups, currentUserId, activeRoom.participantIds],
  );
  const slashOptions = useMemo(
    () => commandSuggestions(value, activeRoom.type === "group"),
    [value, activeRoom.type],
  );
  const options = mentionOptions.length ? "mention" : slashOptions.length ? "slash" : null;
  const optionCount = mentionOptions.length || slashOptions.length;

  useEffect(() => setHighlight(0), [value]);

  const applyMention = useCallback(
    (token: string) => {
      if (!mention) return;
      const before = value.slice(0, mention.start);
      const after = value.slice(caret);
      const next = `${before}${token} ${after}`;
      setValue(next);
      const position = before.length + token.length + 1;
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(position, position);
        setCaret(position);
      });
    },
    [mention, value, caret],
  );

  const applyCommand = useCallback((name: string) => {
    const next = `/${name} `;
    setValue(next);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.length, next.length);
      setCaret(next.length);
    });
  }, []);

  /* ---------------- submit ---------------- */

  const reset = useCallback(() => {
    setValue("");
    setCaret(0);
    setPendingFiles([]);
    clearDraft(activeRoom.id, threadRootId);
    clearReply();
  }, [activeRoom.id, threadRootId, clearDraft, clearReply]);

  const submit = useCallback(() => {
    const text = value.trim();
    if (pendingFiles.length > 0) {
      pendingFiles.forEach((file, index) => {
        void sendAttachment(activeRoom.id, file, index === 0 ? text : "", {
          replyToId: replyTo?.id ?? null,
          threadRootId,
        });
      });
      reset();
      return;
    }
    if (!text) return;

    const slash = parseSlash(text);
    if (slash) {
      const command = findCommand(slash.name);
      if (!command) {
        slashActions.notifyInfo(`Unknown command: /${slash.name}`);
        return;
      }
      if (command.groupOnly && activeRoom.type !== "group") {
        slashActions.notifyInfo(`/${command.name} only works in group conversations.`);
        return;
      }
      command.run({ roomId: activeRoom.id, args: slash.args, actions: slashActions });
      reset();
      return;
    }

    if (/^@agent\b/i.test(text)) {
      const prompt = text.replace(/^@agent/i, "").trim();
      if (!prompt) return;
      void askAgent(activeRoom.id, prompt);
      reset();
      return;
    }

    sendMessage(activeRoom.id, text, {
      replyToId: replyTo?.id ?? null,
      threadRootId,
    });
    reset();
  }, [
    value,
    pendingFiles,
    activeRoom,
    slashActions,
    askAgent,
    sendMessage,
    sendAttachment,
    replyTo,
    threadRootId,
    reset,
  ]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (options && optionCount > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlight((index) => (index + 1) % optionCount);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlight((index) => (index - 1 + optionCount) % optionCount);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        if (options === "mention") {
          const option = mentionOptions[highlight];
          if (option) applyMention(option.token);
        } else {
          const option = slashOptions[highlight];
          if (option) applyCommand(option.name);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setValue((current) => current);
        setCaret(-1);
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
    if (event.key === "Escape" && replyTo) clearReply();
  };

  const syncCaret = (event: React.SyntheticEvent<HTMLTextAreaElement>) => {
    setCaret(event.currentTarget.selectionStart ?? 0);
  };

  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item, index) => {
        const file = item.getAsFile();
        if (!file || file.name) return file;
        const category = file.type.startsWith("video/") ? "video" : "image";
        const subtype = file.type.split("/")[1]?.split("+")[0] || "png";
        const extension = subtype === "jpeg" ? "jpg" : subtype;
        return new File([file], `Pasted ${category} ${Date.now()}-${index + 1}.${extension}`, {
          type: file.type,
          lastModified: Date.now(),
        });
      })
      .filter((file): file is File => Boolean(file));

    if (clipboardFiles.length > 0) {
      event.preventDefault();
      setPendingFiles((current) => [...current, ...clipboardFiles]);
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }

    const pastedText = event.clipboardData.getData("text/plain");
    if (!pastedText) return;
    if (/^data:(?:image|video)\/[a-z0-9.+-]+;base64,/i.test(pastedText)) {
      event.preventDefault();
      void fetch(pastedText)
        .then((response) => response.blob())
        .then((blob) => {
          const kind = blob.type.startsWith("video/") ? "video" : "image";
          const subtype = blob.type.split("/")[1]?.split("+")[0] || "bin";
          const extension = subtype === "jpeg" ? "jpg" : subtype;
          const file = new File([blob], `Copied ${kind} ${Date.now()}.${extension}`, {
            type: blob.type,
            lastModified: Date.now(),
          });
          setPendingFiles((current) => [...current, file]);
          requestAnimationFrame(() => inputRef.current?.focus());
        })
        .catch(() => toast.error("Could not paste the copied media"));
      return;
    }
    event.preventDefault();
    const target = event.currentTarget;
    const start = target.selectionStart ?? value.length;
    const end = target.selectionEnd ?? start;
    const next = `${value.slice(0, start)}${pastedText}${value.slice(end)}`;
    const position = start + pastedText.length;
    setValue(next);
    setCaret(position);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(position, position);
    });
  };

  /* ---------------- blocked states ---------------- */

  if (!permission.allowed) {
    if (permission.reason === "group") {
      return (
        <div className="composer-shell border-t border-border bg-surface-2 px-4 py-5 md:px-8">
          <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Lock className="h-4 w-4" /> Only admins can send messages
          </p>
        </div>
      );
    }

    return (
      <div className="composer-shell border-t border-border bg-surface px-4 py-5 md:px-8">
        <div className="mx-auto flex max-w-4xl items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm text-muted-foreground">
          {permission.reason === "archived" ? (
            <>
              <Archive className="h-4 w-4" /> {t("room.archived")}
            </>
          ) : (
            <>
              <VolumeX className="h-4 w-4" /> You have been muted by the group administrator.
            </>
          )}
          {permission.reason !== "archived" && (
            <span className="ml-auto flex items-center gap-1 text-xs text-ai">
              <Sparkles className="h-3 w-3" /> Private @agent still available
            </span>
          )}
        </div>
        {permission.reason !== "archived" && (
          <div className="mx-auto mt-2 max-w-4xl">
            <AgentOnlyInput roomId={activeRoom.id} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "composer-shell border-t border-border bg-surface px-4 py-4",
        !threadRootId && "md:px-8",
      )}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (!target.closest("button, a, input")) inputRef.current?.focus();
      }}
    >
      <div className="relative mx-auto max-w-4xl">
        {queued.length > 0 && !threadRootId && (
          <div className="mb-2 space-y-1">
            {queued.map((message) => (
              <div
                key={message.id}
                className="flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-1.5 text-[11px]"
              >
                <Clock className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate">{message.content}</span>
                <span suppressHydrationWarning className="shrink-0 text-muted-foreground">
                  {formatDateTime(message.scheduledFor ?? 0, { timeZone: currentUser.timeZone })}
                </span>
                <button
                  onClick={() => cancelScheduled(message.id)}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label="Cancel scheduled message"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {options === "mention" && (
          <ul
            role="listbox"
            aria-label="Mention suggestions"
            className="absolute bottom-full z-40 mb-2 w-80 animate-msg-in overflow-hidden rounded-xl border border-border bg-popover shadow-[var(--shadow-float)]"
          >
            <li className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Mention
            </li>
            {mentionOptions.map((option, index) => (
              <li key={option.key}>
                <button
                  role="option"
                  aria-selected={index === highlight}
                  onClick={() => applyMention(option.token)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
                    index === highlight ? "bg-secondary" : "hover:bg-secondary",
                  )}
                >
                  {option.kind === "agent" ? (
                    <Sparkles className="h-4 w-4 shrink-0 animate-ai-glow text-ai" />
                  ) : option.user ? (
                    <UserAvatar user={option.user} size={22} showStatus />
                  ) : (
                    <AtSign className="h-4 w-4 shrink-0 text-primary" />
                  )}
                  <span className="min-w-0">
                    <span
                      className={cn(
                        "block truncate text-sm font-medium",
                        option.kind === "agent" && "text-ai",
                      )}
                    >
                      {option.label}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {option.detail}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {options === "slash" && (
          <ul
            role="listbox"
            aria-label="Slash commands"
            className="absolute bottom-full z-40 mb-2 w-80 animate-msg-in overflow-hidden rounded-xl border border-border bg-popover shadow-[var(--shadow-float)]"
          >
            <li className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Commands
            </li>
            {slashOptions.map((command, index) => (
              <li key={command.name}>
                <button
                  role="option"
                  aria-selected={index === highlight}
                  onClick={() => applyCommand(command.name)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
                    index === highlight ? "bg-secondary" : "hover:bg-secondary",
                  )}
                >
                  <Hash className="h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      /{command.name} <span className="opacity-60">{command.hint}</span>
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {command.description}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {replyTo && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs">
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              Replying to <b className="text-foreground">{userById(replyTo.senderId).name}</b>:{" "}
              {plainText(previewText(replyTo)).slice(0, 60)}
            </span>
            <button
              onClick={clearReply}
              aria-label="Cancel reply"
              className="text-muted-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {!online && (
          <p className="mb-2 rounded-lg bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
            Offline — messages are queued and will send automatically.
          </p>
        )}

        {pendingPreviews.length > 0 && (
          <div className="mb-2 flex gap-2 overflow-x-auto rounded-xl border border-border bg-surface-2 p-2">
            {pendingPreviews.map(({ file, url }, index) => (
              <div
                key={`${file.name}-${file.lastModified}-${index}`}
                className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-border bg-background"
              >
                {file.type.startsWith("image/") ? (
                  <img src={url} alt={file.name} className="h-full w-full object-cover" />
                ) : file.type.startsWith("video/") ? (
                  <video
                    src={url}
                    muted
                    preload="metadata"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-1 p-2 text-center text-muted-foreground">
                    <Paperclip className="h-5 w-5" />
                    <span className="line-clamp-2 text-[10px]">{file.name}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setPendingFiles((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  aria-label={`Remove ${file.name}`}
                  className="absolute right-1 top-1 rounded-full bg-black/65 p-1 text-white transition-colors hover:bg-black/85"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            <div className="flex min-w-40 flex-1 flex-col justify-center px-2">
              <p className="text-xs font-semibold">
                {pendingFiles.length === 1 ? "Ready to send" : `${pendingFiles.length} items ready`}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Add a caption below, then press Send.
              </p>
            </div>
          </div>
        )}

        <div
          className={cn(
            "flex items-end gap-2 rounded-xl border bg-surface p-2 transition-[border-color,box-shadow]",
            isAgent ? "border-ai/40 ring-2 ring-ai/10" : "border-border shadow-sm",
          )}
        >
          {isAgent && (
            <span className="ml-1 flex items-center gap-1 self-center rounded-md bg-ai/10 px-2 py-1 text-xs font-semibold text-ai">
              <Sparkles className="h-3 w-3 animate-ai-glow" /> @agent
            </span>
          )}
          <textarea
            ref={inputRef}
            rows={1}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setCaret(event.target.selectionStart ?? 0);
            }}
            onKeyUp={syncCaret}
            onClick={syncCaret}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            aria-label={threadRootId ? "Reply in thread" : "Message"}
            placeholder={
              threadRootId
                ? "Reply in thread…"
                : isAgent
                  ? t("composer.agentPlaceholder")
                  : t("composer.placeholder")
            }
            className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground"
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
            multiple
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length > 0) setPendingFiles((current) => [...current, ...files]);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            aria-label="Attach photo, video, or file"
            onClick={() => fileRef.current?.click()}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          {!threadRootId && (
            <button
              type="button"
              aria-label="Schedule this message"
              disabled={!value.trim()}
              onClick={() => setScheduleOpen(true)}
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
            >
              <Clock className="h-4 w-4" />
            </button>
          )}
          <div className="relative">
            <button
              type="button"
              aria-label="Insert emoji"
              aria-expanded={showEmoji}
              onClick={() => setShowEmoji((open) => !open)}
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Smile className="h-4 w-4" />
            </button>
            {showEmoji && (
              <EmojiPicker
                onSelect={(emoji) => setValue((current) => current + emoji)}
                onClose={() => setShowEmoji(false)}
              />
            )}
          </div>
          <button
            onClick={submit}
            disabled={!value.trim() && pendingFiles.length === 0}
            aria-label="Send message"
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg text-primary-foreground shadow-sm transition-colors active:translate-y-px disabled:opacity-40",
              isAgent ? "bg-ai hover:bg-ai/90" : "bg-primary hover:bg-primary/90",
            )}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
          {isAgent ? (
            <span className="text-ai">{t("composer.agentHint")}</span>
          ) : (
            t("composer.hint")
          )}
        </p>
      </div>

      <ScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        timeZone={currentUser.timeZone}
        onConfirm={(when) => {
          scheduleMessage(activeRoom.id, value, when);
          reset();
          setScheduleOpen(false);
        }}
      />
    </div>
  );
}

function AgentOnlyInput({ roomId }: { roomId: string }) {
  const { askAgent } = useChat();
  const [value, setValue] = useState("");
  const send = () => {
    if (!value.trim()) return;
    void askAgent(roomId, value.replace(/^@agent/i, "").trim());
    setValue("");
  };
  return (
    <div className="flex items-center gap-2 rounded-xl border border-ai/35 bg-surface p-2 shadow-sm">
      <Sparkles className="ml-2 h-4 w-4 animate-ai-glow text-ai" />
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") send();
        }}
        aria-label="Ask the private AI assistant"
        placeholder="Ask the private AI assistant..."
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      <button
        onClick={send}
        aria-label="Send to AI assistant"
        className="flex h-9 w-9 items-center justify-center rounded-lg bg-ai text-ai-foreground shadow-sm active:translate-y-px"
      >
        <Send className="h-4 w-4" />
      </button>
    </div>
  );
}
