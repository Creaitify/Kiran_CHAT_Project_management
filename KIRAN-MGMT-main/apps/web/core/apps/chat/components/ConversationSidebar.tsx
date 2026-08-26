/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import {
  Archive,
  AtSign,
  Bell,
  BellOff,
  MessageSquarePlus,
  PanelLeftClose,
  Pencil,
  Search,
  Users,
} from "lucide-react";
import { Input } from "../ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { GroupAvatar, UserAvatar } from "./UserAvatar";
import { useChat } from "../store/chat-store";
import { previewText, type Room } from "../lib/chat-types";
import { formatTime, formatRelative } from "../lib/time";
import { useI18n } from "../lib/i18n";
import { cn } from "../lib/cn";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";

export function ConversationSidebar({
  onCreateGroup,
  onClose,
  onSelect,
}: {
  onCreateGroup: () => void;
  onClose?: () => void;
  onSelect?: () => void;
}) {
  const {
    visibleRooms,
    archivedRooms,
    activeRoom,
    setActiveRoom,
    roomTitle,
    lastMessage,
    userById,
    unreadFor,
    currentUser,
    users,
    openDirect,
    notifications,
    markNotificationsRead,
    unreadNotificationCount,
    currentUserId,
    getDraft,
    notificationLevel,
    jumpToMessage,
    plainText,
  } = useChat();
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const filtered = useMemo(
    () =>
      visibleRooms.filter((room) => roomTitle(room).toLowerCase().includes(query.toLowerCase())),
    [visibleRooms, roomTitle, query],
  );
  const groups = filtered.filter((room) => room.type === "group");
  const directs = filtered.filter((room) => room.type !== "group");
  const people = query
    ? users.filter(
        (user) =>
          user.id !== currentUserId && user.name.toLowerCase().includes(query.toLowerCase()),
      )
    : [];

  const renderRoom = (room: Room) => {
    const last = lastMessage(room.id);
    const other = room.participantIds.find((id) => id !== currentUserId);
    const active = room.id === activeRoom?.id;
    const unread = unreadFor(room.id);
    const draft = getDraft(room.id);
    const level = notificationLevel(room.id);
    const memberCount = room.participantIds.length;
    const onlineCount = room.participantIds.map(userById).filter((user) => user.online).length;

    const roomButton = (
      <button
        onClick={() => {
          setActiveRoom(room.id);
          onSelect?.();
        }}
        aria-current={active ? "true" : undefined}
        className={cn(
          "group flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors duration-150",
          active
            ? "border-primary/20 bg-primary/10 text-accent-foreground"
            : "border-transparent hover:bg-secondary",
        )}
      >
        {room.type === "direct" ? (
          <UserAvatar user={userById(other ?? currentUserId)} size={38} showStatus />
        ) : (
          <GroupAvatar name={roomTitle(room)} color={room.color} photo={room.photo} size={38} />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span
              className={cn("truncate text-sm", unread.total > 0 ? "font-bold" : "font-semibold")}
            >
              {roomTitle(room)}
            </span>
            {room.groupMuted && <BellOff className="h-3 w-3 shrink-0 text-muted-foreground" />}
            {level === "none" && <BellOff className="h-3 w-3 shrink-0 text-muted-foreground" />}
            <span
              suppressHydrationWarning
              className="ml-auto shrink-0 text-[10px] text-muted-foreground"
            >
              {last ? formatTime(last.timestamp, { timeZone: currentUser.timeZone }) : ""}
            </span>
          </span>
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {draft ? (
                <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <Pencil className="h-3 w-3 shrink-0" />
                  <span className="truncate">{draft.text}</span>
                </span>
              ) : last ? (
                `${room.type !== "direct" ? `${userById(last.senderId).name.split(" ")[0]}: ` : ""}${plainText(previewText(last))}`
              ) : (
                "No messages yet"
              )}
            </span>
            {unread.mentions > 0 && (
              <span
                aria-label={`${unread.mentions} mentions`}
                className="flex shrink-0 items-center gap-0.5 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold text-destructive-foreground"
              >
                <AtSign className="h-2.5 w-2.5" />
                {unread.mentions}
              </span>
            )}
            {unread.total > 0 && (
              <span
                aria-label={`${unread.total} unread messages`}
                className="min-w-5 shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-center text-[10px] font-semibold text-primary-foreground"
              >
                {unread.total}
              </span>
            )}
          </span>
        </span>
      </button>
    );

    if (room.type !== "group") return roomButton;

    return (
      <Tooltip key={room.id}>
        <TooltipTrigger asChild>{roomButton}</TooltipTrigger>
        <TooltipContent side="top" align="start" sideOffset={8} className="w-64 p-3">
          <div className="flex items-center gap-2.5">
            <GroupAvatar name={roomTitle(room)} color={room.color} photo={room.photo} size={36} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{roomTitle(room)}</p>
              {room.topic && (
                <p className="truncate text-[11px] text-primary-foreground/85">{room.topic}</p>
              )}
            </div>
          </div>
          {room.description && (
            <p className="mt-2 text-xs leading-relaxed text-primary-foreground/90">
              {room.description}
            </p>
          )}
          <p className="mt-2 text-[11px] text-primary-foreground/80">
            {memberCount} members · {onlineCount} online
          </p>
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <TooltipProvider delayDuration={250}>
      <aside
        aria-label="Conversations"
        className="conversation-rail flex h-full w-full flex-col border-r border-border bg-surface"
      >
        <div className="flex h-16 items-center gap-2 border-b border-border px-4">
          <UserAvatar user={currentUser} size={36} showStatus />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{currentUser.name}</p>
            <p className="truncate text-[11px] text-muted-foreground">{currentUser.role}</p>
          </div>
          <DropdownMenu onOpenChange={(open) => open && markNotificationsRead()}>
            <DropdownMenuTrigger
              aria-label={`Notifications${unreadNotificationCount ? `, ${unreadNotificationCount} unread` : ""}`}
              className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Bell className="h-4 w-4" />
              {unreadNotificationCount > 0 && (
                <span className="absolute right-1 top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
                  {unreadNotificationCount}
                </span>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>Notifications</DropdownMenuLabel>
              {notifications.length === 0 && (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                  No notifications
                </p>
              )}
              {notifications.slice(0, 12).map((notification) => (
                <DropdownMenuItem
                  key={notification.id}
                  className="flex-col items-start gap-0.5 text-xs"
                  onClick={() => {
                    if (notification.roomId && notification.messageId) {
                      jumpToMessage(notification.roomId, notification.messageId);
                    } else if (notification.roomId) {
                      setActiveRoom(notification.roomId);
                    }
                  }}
                >
                  <span className="flex w-full items-center gap-1.5">
                    {notification.kind === "mention" && (
                      <AtSign className="h-3 w-3 shrink-0 text-destructive" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{notification.text}</span>
                  </span>
                  <span suppressHydrationWarning className="text-[10px] text-muted-foreground">
                    {formatRelative(notification.timestamp)}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close conversation sidebar"
              title="Close conversations"
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="relative px-4 pt-4">
          <Search className="absolute left-7 top-[calc(50%+0.5rem)] h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("search.placeholder")}
            aria-label={t("search.placeholder")}
            className="h-10 border-border bg-surface-2 pl-9 text-sm shadow-none"
          />
        </div>

        <div className="flex gap-2 px-4 py-3">
          <DropdownMenu>
            <DropdownMenuTrigger className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface py-2 text-xs font-medium text-secondary-foreground shadow-sm transition-colors hover:bg-secondary">
              <MessageSquarePlus className="h-3.5 w-3.5" /> New Chat
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Start a direct message</DropdownMenuLabel>
              {users
                .filter((user) => user.id !== currentUserId)
                .map((user) => (
                  <DropdownMenuItem
                    key={user.id}
                    onClick={() => openDirect(user.id)}
                    className="gap-2"
                  >
                    <UserAvatar user={user} size={22} showStatus /> {user.name}
                  </DropdownMenuItem>
                ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onCreateGroup}>
                <Users className="mr-2 h-4 w-4" /> New group…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            onClick={onCreateGroup}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 active:translate-y-px"
          >
            <Users className="h-3.5 w-3.5" /> Create Group
          </button>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-6 pt-1">
          <section>
            <p className="px-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Groups
            </p>
            <div className="space-y-1 px-2">{groups.map(renderRoom)}</div>
          </section>
          <section>
            <p className="px-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Direct Messages
            </p>
            <div className="space-y-1 px-2">{directs.map(renderRoom)}</div>
          </section>

          {people.length > 0 && (
            <section>
              <p className="px-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                People
              </p>
              <div className="space-y-1 px-2">
                {people.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => openDirect(user.id)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-secondary"
                  >
                    <UserAvatar user={user} size={34} showStatus />
                    <span className="text-sm font-medium">{user.name}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {archivedRooms.length > 0 && (
            <section>
              <button
                onClick={() => setShowArchived((open) => !open)}
                aria-expanded={showArchived}
                className="flex w-full items-center gap-1.5 px-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
                <Archive className="h-3 w-3" /> Archived · {archivedRooms.length}
              </button>
              {showArchived && (
                <div className="space-y-1 px-2">{archivedRooms.map(renderRoom)}</div>
              )}
            </section>
          )}

          {filtered.length === 0 && people.length === 0 && query && (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">
              No chats or people found.
            </p>
          )}
        </nav>
      </aside>
    </TooltipProvider>
  );
}
