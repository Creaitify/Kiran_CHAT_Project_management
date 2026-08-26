import { memo, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Bookmark,
  BookmarkCheck,
  Check,
  CheckCheck,
  ChevronRight,
  Clock,
  Copy,
  CornerUpRight,
  Download,
  File,
  Link2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Reply,
  Share2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "./UserAvatar";
import { UserProfileDialog } from "./UserProfileDialog";
import { MediaAttachment } from "./MediaAttachment";
import { copyAttachmentToClipboard, isMediaAttachment } from "@/lib/attachments";
import { MarkdownContent } from "./MarkdownContent";
import { useChat } from "@/lib/chat-store";
import { isTombstoned, type SharedMessage, type User } from "@/lib/chat-types";
import { formatTime } from "@/lib/time";
import { useI18n } from "@/lib/i18n";
import { isSafeHref } from "@/lib/link-preview";
import { cn } from "@/lib/utils";

const QUICK_REACTIONS = ["👍", "🎉", "❤️", "👀"];

export interface MessageItemProps {
  message: SharedMessage;
  onReply: (message: SharedMessage) => void;
  onOpenThread: (rootId: string) => void;
  onForward: (message: SharedMessage) => void;
  /** True while a permalink jump is highlighting this row. */
  highlighted?: boolean;
  /** Thread replies render more compactly and hide the thread footer. */
  compact?: boolean;
}

function MessageItemImpl({
  message,
  onReply,
  onOpenThread,
  onForward,
  highlighted = false,
  compact = false,
}: MessageItemProps) {
  const {
    currentUserId,
    userById,
    users,
    userGroups,
    messages,
    activeRoom,
    isAdmin,
    toggleReaction,
    editMessage,
    deleteMessage,
    retryMessage,
    discardMessage,
    togglePin,
    toggleSave,
    isSaved,
    permalinkFor,
    threadCount,
    threadParticipants,
    readersOf,
    plainText,
  } = useChat();
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [profileUser, setProfileUser] = useState<User | null>(null);
  const [editValue, setEditValue] = useState(message.content);
  const editRef = useRef<HTMLTextAreaElement>(null);

  const mine = message.senderId === currentUserId;
  const sender = userById(message.senderId);
  const sharedProfile = message.sharedProfileUserId ? userById(message.sharedProfileUserId) : null;
  const deleted = isTombstoned(message);
  const canEdit = mine && !deleted && !message.sharedProfileUserId;
  const canDelete = (mine || isAdmin(activeRoom, currentUserId)) && !deleted;
  const replyTo = message.replyToId
    ? messages.find((item) => item.id === message.replyToId)
    : undefined;
  const replies = compact ? 0 : threadCount(message.id);
  const readers = mine ? readersOf(message) : [];

  useEffect(() => {
    if (editing) {
      editRef.current?.focus();
      editRef.current?.setSelectionRange(editValue.length, editValue.length);
    }
    // Only refocus when entering edit mode, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const copyText = (text: string, label: string) => {
    void navigator.clipboard.writeText(text);
    toast.success(label);
  };

  const copyAttachment = async () => {
    if (!message.attachment) return;
    try {
      const result = await copyAttachmentToClipboard(message.attachment);
      toast.success(result === "binary" ? "Attachment copied" : "Attachment copied for chat");
    } catch {
      toast.error("Could not copy attachment");
    }
  };

  const commitEdit = () => {
    const next = editValue.trim();
    if (!next) {
      toast.error("Delete the message instead of clearing it.");
      return;
    }
    if (next !== message.content) editMessage(message.id, next);
    setEditing(false);
  };

  if (message.system) {
    return (
      <div className="animate-msg-in self-center py-1" role="status">
        <span className="rounded-full border border-border bg-surface px-3 py-1 text-[11px] text-muted-foreground shadow-sm">
          {message.content}
        </span>
      </div>
    );
  }

  return (
    <article
      id={`msg-${message.id}`}
      tabIndex={0}
      aria-label={`Message from ${sender.name} at ${formatTime(message.timestamp)}`}
      className={cn(
        "group flex animate-msg-in items-end gap-2.5 rounded-xl px-1 py-0.5 transition-colors",
        mine && "flex-row-reverse",
        highlighted && "bg-primary/10 ring-2 ring-primary/40",
      )}
    >
      {!mine && (
        <button
          onClick={() => setProfileUser(sender)}
          aria-label={`View ${sender.name}'s profile`}
          className="rounded-full transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
        >
          <UserAvatar user={sender} size={32} showStatus />
        </button>
      )}

      <div className={cn("min-w-0 max-w-[78%]", mine && "items-end")}>
        {!mine && (
          <button
            onClick={() => setProfileUser(sender)}
            className="mb-1 pl-1 text-[11px] font-semibold text-muted-foreground hover:text-primary hover:underline"
          >
            {sender.name}
          </button>
        )}

        <div
          className={cn(
            "rounded-xl px-4 py-2.5 text-sm shadow-[var(--shadow-soft)]",
            mine
              ? "message-bubble-mine rounded-br-sm bg-primary text-primary-foreground"
              : "message-bubble-other rounded-bl-sm border border-border bg-surface text-foreground",
            deleted && "opacity-70",
            message.delivery === "failed" && "ring-1 ring-destructive/50",
          )}
        >
          {message.pinnedBy && !deleted && (
            <p
              className={cn(
                "mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide",
                mine ? "text-primary-foreground/75" : "text-muted-foreground",
              )}
            >
              <Pin className="h-3 w-3" /> {t("message.pinned")} by{" "}
              {userById(message.pinnedBy).name.split(" ")[0]}
            </p>
          )}

          {message.forwardedFrom && (
            <p
              className={cn(
                "mb-1 flex items-center gap-1 text-[10px] italic",
                mine ? "text-primary-foreground/75" : "text-muted-foreground",
              )}
            >
              <CornerUpRight className="h-3 w-3" /> Forwarded from{" "}
              {userById(message.forwardedFrom.senderId).name}
            </p>
          )}

          {replyTo && (
            <button
              onClick={() => {
                document
                  .getElementById(`msg-${replyTo.id}`)
                  ?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
              className={cn(
                "mb-1.5 block w-full truncate rounded-lg border-l-2 px-2 py-1 text-left text-[11px]",
                mine
                  ? "border-background/50 bg-background/15"
                  : "border-primary/60 bg-background/25 text-muted-foreground",
              )}
            >
              {userById(replyTo.senderId).name}:{" "}
              {isTombstoned(replyTo) ? t("message.deleted") : plainText(replyTo.content)}
            </button>
          )}

          {message.sharedFromAi && (
            <p
              className={cn(
                "mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide",
                mine ? "text-primary-foreground/70" : "text-ai",
              )}
            >
              <Sparkles className="h-3 w-3" /> Shared from AI Agent
            </p>
          )}

          {deleted ? (
            <p className="flex items-center gap-1.5 text-sm italic opacity-80">
              <Trash2 className="h-3.5 w-3.5" /> {t("message.deleted")}
            </p>
          ) : editing ? (
            <div className="min-w-60">
              <textarea
                ref={editRef}
                value={editValue}
                onChange={(event) => setEditValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    commitEdit();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setEditValue(message.content);
                    setEditing(false);
                  }
                }}
                aria-label="Edit message"
                className={cn(
                  "max-h-40 min-h-16 w-full resize-none rounded-lg border p-2 text-sm outline-none",
                  mine
                    ? "border-primary-foreground/30 bg-background/15 text-primary-foreground placeholder:text-primary-foreground/50"
                    : "border-border bg-surface-2",
                )}
              />
              <div className="mt-1.5 flex items-center gap-2 text-[11px]">
                <button
                  onClick={commitEdit}
                  className={cn(
                    "rounded-md px-2 py-1 font-medium",
                    mine ? "bg-background/25" : "bg-primary text-primary-foreground",
                  )}
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setEditValue(message.content);
                    setEditing(false);
                  }}
                  className="rounded-md px-2 py-1 opacity-80 hover:opacity-100"
                >
                  Cancel
                </button>
                <span className="opacity-70">Esc to cancel</span>
              </div>
            </div>
          ) : (
            message.content &&
            !message.sharedProfileUserId && (
              <MarkdownContent
                content={message.content}
                users={users}
                groups={userGroups}
                currentUserId={currentUserId}
                onPrimary={mine}
              />
            )
          )}

          {!deleted && sharedProfile && (
            <button
              onClick={() => setProfileUser(sharedProfile)}
              className={cn(
                "mt-1 flex w-full min-w-64 items-center gap-3 rounded-xl border p-3 text-left transition-colors",
                mine
                  ? "border-primary-foreground/25 bg-background/10 hover:bg-background/20"
                  : "border-border bg-surface-2 hover:bg-secondary",
              )}
            >
              <UserAvatar user={sharedProfile} size={42} showStatus />
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] font-semibold uppercase tracking-wide opacity-70">
                  Shared contact
                </span>
                <span className="block truncate text-sm font-semibold">{sharedProfile.name}</span>
                <span className="block truncate text-[11px] opacity-75">{sharedProfile.role}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 opacity-70" />
            </button>
          )}

          {!deleted && message.attachment && isMediaAttachment(message.attachment) && (
            <MediaAttachment
              attachment={message.attachment}
              mine={mine}
              onForward={() => onForward(message)}
            />
          )}

          {!deleted && message.attachment && !isMediaAttachment(message.attachment) && (
            <a
              href={message.attachment.dataUrl}
              download={message.attachment.name}
              className={cn(
                "mt-2 flex items-center gap-2 rounded-lg border px-3 py-2",
                mine
                  ? "border-primary-foreground/20 bg-background/10"
                  : "border-border bg-surface-2",
              )}
            >
              <File className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">
                {message.attachment.name}
              </span>
              <Download className="h-3.5 w-3.5 shrink-0" />
            </a>
          )}

          {!deleted &&
            message.linkPreviews?.map((preview) =>
              isSafeHref(preview.url) ? (
                <a
                  key={preview.url}
                  href={preview.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow ugc"
                  className={cn(
                    "mt-2 block rounded-lg border-l-2 px-3 py-2",
                    mine
                      ? "border-primary-foreground/40 bg-background/12"
                      : "border-primary/50 bg-surface-2",
                  )}
                >
                  <span className="block text-[10px] uppercase tracking-wide opacity-70">
                    {preview.siteName}
                  </span>
                  <span className="block truncate text-xs font-semibold">{preview.title}</span>
                  {preview.description && (
                    <span className="mt-0.5 block truncate text-[11px] opacity-75">
                      {preview.description}
                    </span>
                  )}
                </a>
              ) : null,
            )}

          <p
            suppressHydrationWarning
            className={cn(
              "mt-1 flex items-center justify-end gap-1 text-[10px]",
              mine ? "text-primary-foreground/70" : "text-muted-foreground",
            )}
          >
            {message.editedAt && <span className="italic">({t("message.edited")})</span>}
            {formatTime(message.timestamp)}
            {mine && !deleted && <DeliveryIcon message={message} readerCount={readers.length} />}
          </p>
        </div>

        {message.delivery === "failed" && mine && (
          <div className="mt-1 flex items-center gap-2 text-[11px] text-destructive">
            <AlertCircle className="h-3.5 w-3.5" />
            <span>{message.failureReason ?? t("message.failed")}</span>
            <button onClick={() => retryMessage(message.id)} className="font-semibold underline">
              {t("message.retry")}
            </button>
            <button
              onClick={() => discardMessage(message.id)}
              className="opacity-70 hover:opacity-100"
            >
              Discard
            </button>
          </div>
        )}

        {replies > 0 && (
          <button
            onClick={() => onOpenThread(message.id)}
            className={cn(
              "mt-1 flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1 text-[11px] font-medium text-primary shadow-sm transition-colors hover:bg-secondary",
              mine && "ml-auto",
            )}
          >
            <span className="flex -space-x-1.5">
              {threadParticipants(message.id)
                .slice(0, 3)
                .map((user) => (
                  <UserAvatar key={user.id} user={user} size={16} />
                ))}
            </span>
            {t("thread.replies", { count: replies })}
          </button>
        )}

        {/* Reactions + hover actions */}
        <div className={cn("mt-1 flex items-center gap-1", mine ? "justify-end" : "justify-start")}>
          {Object.entries(message.reactions ?? {}).map(([emoji, list]) => (
            <button
              key={emoji}
              onClick={() => toggleReaction(message.id, emoji)}
              aria-pressed={list.includes(currentUserId)}
              aria-label={`${emoji} reaction, ${list.length}`}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] shadow-sm transition-colors",
                list.includes(currentUserId)
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-surface hover:bg-secondary",
              )}
            >
              {emoji} {list.length}
            </button>
          ))}

          {!deleted && (
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 group-focus:opacity-100">
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => toggleReaction(message.id, emoji)}
                  aria-label={`React with ${emoji}`}
                  className="rounded-full px-1 text-xs transition-transform hover:scale-125"
                >
                  {emoji}
                </button>
              ))}
              {!compact && (
                <IconAction
                  icon={MessageSquare}
                  label={t("message.reply")}
                  onClick={() => onOpenThread(message.id)}
                />
              )}
              <IconAction icon={Reply} label="Quote reply" onClick={() => onReply(message)} />
              {canEdit && (
                <IconAction
                  icon={Pencil}
                  label="Edit message"
                  onClick={() => {
                    setEditValue(message.content);
                    setEditing(true);
                  }}
                />
              )}
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="More message actions"
                  className="rounded-full p-1 text-muted-foreground hover:text-foreground"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align={mine ? "end" : "start"} className="w-52">
                  <DropdownMenuItem onClick={() => toggleSave(message.id)}>
                    {isSaved(message.id) ? (
                      <BookmarkCheck className="mr-2 h-4 w-4" />
                    ) : (
                      <Bookmark className="mr-2 h-4 w-4" />
                    )}
                    {isSaved(message.id) ? "Remove from saved" : "Save for later"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => togglePin(message.id)}>
                    {message.pinnedBy ? (
                      <PinOff className="mr-2 h-4 w-4" />
                    ) : (
                      <Pin className="mr-2 h-4 w-4" />
                    )}
                    {message.pinnedBy ? "Unpin" : "Pin to conversation"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onForward(message)}>
                    <Share2 className="mr-2 h-4 w-4" /> Forward…
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {message.content && (
                    <DropdownMenuItem
                      onClick={() => copyText(plainText(message.content), "Message copied")}
                    >
                      <Copy className="mr-2 h-4 w-4" /> Copy text
                    </DropdownMenuItem>
                  )}
                  {message.attachment && (
                    <DropdownMenuItem onClick={() => void copyAttachment()}>
                      <Copy className="mr-2 h-4 w-4" /> Copy attachment
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => copyText(permalinkFor(message), "Link copied")}>
                    <Link2 className="mr-2 h-4 w-4" /> Copy link to message
                  </DropdownMenuItem>
                  {canDelete && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => deleteMessage(message.id)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" /> Delete message
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        {mine && readers.length > 0 && !compact && (
          <p className={cn("mt-0.5 text-[10px] text-muted-foreground", mine && "text-right")}>
            Seen by {readers.map((user) => user.name.split(" ")[0]).join(", ")}
          </p>
        )}
      </div>
      <UserProfileDialog
        user={profileUser ?? sender}
        open={Boolean(profileUser)}
        onOpenChange={(open) => !open && setProfileUser(null)}
      />
    </article>
  );
}

function DeliveryIcon({ message, readerCount }: { message: SharedMessage; readerCount: number }) {
  if (message.delivery === "sending") {
    return <Clock className="h-3 w-3 animate-pulse" aria-label="Sending" />;
  }
  if (message.delivery === "failed") {
    return <X className="h-3 w-3 text-destructive" aria-label="Failed to send" />;
  }
  if (readerCount > 0) {
    return <CheckCheck className="h-3 w-3 text-sky-300" aria-label="Read" />;
  }
  if (message.delivery === "delivered") {
    return <CheckCheck className="h-3 w-3" aria-label="Delivered" />;
  }
  return <Check className="h-3 w-3" aria-label="Sent" />;
}

function IconAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Reply;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-full p-1 text-muted-foreground hover:text-foreground"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

/**
 * Rows are re-rendered often (every store update touches `messages`), so this
 * memo compares only the fields that actually change what is drawn.
 */
export const MessageItem = memo(MessageItemImpl, (prev, next) => {
  const a = prev.message;
  const b = next.message;
  return (
    a.id === b.id &&
    a.content === b.content &&
    a.delivery === b.delivery &&
    a.editedAt === b.editedAt &&
    a.deletedAt === b.deletedAt &&
    a.pinnedBy === b.pinnedBy &&
    a.reactions === b.reactions &&
    a.timestamp === b.timestamp &&
    a.failureReason === b.failureReason &&
    a.sharedProfileUserId === b.sharedProfileUserId &&
    prev.highlighted === next.highlighted &&
    prev.compact === next.compact
  );
});
