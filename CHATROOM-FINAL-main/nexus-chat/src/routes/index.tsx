import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import {
  Bell,
  BellOff,
  Bookmark,
  Info,
  ImagePlus,
  Languages,
  Menu,
  Monitor,
  Moon,
  MoreVertical,
  PanelLeftOpen,
  Pin,
  Search,
  Settings,
  Sparkles,
  Sun,
  UserRound,
  Users,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { ConversationSidebar } from "@/components/chat/ConversationSidebar";
import { MessageThread } from "@/components/chat/MessageThread";
import { Composer } from "@/components/chat/Composer";
import { ContextPanel } from "@/components/chat/ContextPanel";
import { CreateGroupDialog } from "@/components/chat/CreateGroupDialog";
import { ThreadPanel } from "@/components/chat/ThreadPanel";
import { CommandPalette } from "@/components/chat/CommandPalette";
import { ForwardDialog } from "@/components/chat/ForwardDialog";
import { RoomSettingsDialog } from "@/components/chat/RoomSettingsDialog";
import { SavedPinnedDialog, type SavedPinnedMode } from "@/components/chat/SavedPinnedDialog";
import { ShortcutsDialog } from "@/components/chat/ShortcutsDialog";
import { GroupAvatar, UserAvatar } from "@/components/chat/UserAvatar";
import { UserProfileDialog } from "@/components/chat/UserProfileDialog";
import { GroupProfileDialog } from "@/components/chat/GroupProfileDialog";
import { PinnedMessageBanner } from "@/components/chat/PinnedMessageBanner";
import { useChat } from "@/lib/chat-store";
import { previewText, type SharedMessage, type User, type UserId } from "@/lib/chat-types";
import { LOCALES, useI18n, type LocaleCode } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { formatRelative } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface WorkspaceSearch {
  room?: string;
  msg?: string;
}

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): WorkspaceSearch => ({
    ...(typeof search["room"] === "string" ? { room: search["room"] } : {}),
    ...(typeof search["msg"] === "string" ? { msg: search["msg"] } : {}),
  }),
  head: () => ({
    meta: [
      { title: "KIRANOS — AI-Powered Team Chat Workspace" },
      {
        name: "description",
        content:
          "KIRANOS is a premium real-time collaboration workspace with group chats, private DMs and a private @agent AI assistant inside every conversation.",
      },
      { property: "og:title", content: "KIRANOS — AI-Powered Team Chat Workspace" },
      {
        property: "og:description",
        content:
          "Group chat, private messaging, group controls and a private AI assistant in one enterprise-ready workspace.",
      },
    ],
  }),
  component: Workspace,
});

function Workspace() {
  const search = useSearch({ from: "/" });
  const navigate = useNavigate();

  const [groupOpen, setGroupOpen] = useState(false);
  const [preselected, setPreselected] = useState<UserId[]>([]);
  const [replyTo, setReplyTo] = useState<SharedMessage | null>(null);
  const [threadRootId, setThreadRootId] = useState<string | null>(null);
  const [forwarding, setForwarding] = useState<SharedMessage | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobilePanel, setMobilePanel] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [msgQuery, setMsgQuery] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"about" | "members" | "invite" | "appearance">(
    "about",
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savedMode, setSavedMode] = useState<SavedPinnedMode>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [headerProfile, setHeaderProfile] = useState<User | null>(null);
  const [groupProfileOpen, setGroupProfileOpen] = useState(false);

  const {
    activeRoom,
    roomTitle,
    userById,
    users,
    currentUser,
    setCurrentUserId,
    currentUserId,
    visibleRooms,
    setActiveRoom,
    searchMessages,
    jumpToMessage,
    summarizeRoom,
    online,
    setOnline,
    outbox,
    connectorStatus,
    plainText,
    unreadFor,
    isAdmin,
    toggleGroupMute,
    notificationLevel,
    setNotificationLevel,
  } = useChat();
  const { resolved, preference, setPreference } = useTheme();
  const { locale, setLocale } = useI18n();

  const openCreateGroup = useCallback((ids: UserId[] = []) => {
    setPreselected(ids);
    setGroupOpen(true);
  }, []);

  const openSettings = useCallback(
    (tab: "about" | "members" | "invite" | "appearance" = "about") => {
      setSettingsTab(tab);
      setSettingsOpen(true);
    },
    [],
  );

  /* -------------------- permalink handling -------------------- */

  useEffect(() => {
    if (!search.room || !search.msg) return;
    jumpToMessage(search.room, search.msg);
    // Clear the params so a refresh doesn't re-trigger the jump.
    void navigate({ to: "/", search: {}, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.room, search.msg]);

  /* -------------------- global keyboard shortcuts -------------------- */

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      return (
        element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;

      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (meta && event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        setSavedMode("saved");
        return;
      }
      if (meta && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setSavedMode("pinned");
        return;
      }
      if (meta && event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        setPreference(resolved === "dark" ? "light" : "dark");
        return;
      }
      if (meta && event.key.toLowerCase() === "f" && !isTypingTarget(event.target)) {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        const index = visibleRooms.findIndex((room) => room.id === activeRoom.id);
        const next =
          event.key === "ArrowUp"
            ? (index - 1 + visibleRooms.length) % visibleRooms.length
            : (index + 1) % visibleRooms.length;
        const target = visibleRooms[next];
        if (target) setActiveRoom(target.id);
        return;
      }
      if (event.key === "Escape") {
        if (searchOpen) setSearchOpen(false);
        else if (threadRootId) setThreadRootId(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    visibleRooms,
    activeRoom.id,
    setActiveRoom,
    resolved,
    setPreference,
    searchOpen,
    threadRootId,
  ]);

  /* -------------------- derived -------------------- */

  const participants = activeRoom.participantIds.map(userById);
  const onlineCount = participants.filter((user) => user.online).length;
  const otherId = activeRoom.participantIds.find((id) => id !== currentUserId);
  const results = useMemo(
    () => (msgQuery.trim() ? searchMessages(msgQuery, activeRoom.id) : []),
    [msgQuery, searchMessages, activeRoom.id],
  );
  const unread = unreadFor(activeRoom.id);

  return (
    <div className="workspace-shell flex h-screen flex-col overflow-hidden bg-background text-[13px]">
      <a
        href="#composer"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to message composer
      </a>

      {/* Top bar */}
      <header className="app-topbar flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 md:px-5">
        <button
          aria-label="Open conversation list"
          className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-secondary hover:text-foreground lg:hidden"
          onClick={() => setMobileNav(true)}
        >
          <Menu className="h-4 w-4" />
        </button>
        <div className="brand-logo-shell" aria-label="KIRANOS workspace">
          <span className="brand-logo-mark" aria-hidden="true">
            <img src="/kiranos-logo.png" alt="" />
          </span>
          <span className="brand-logo-word">KIRAN</span>
        </div>

        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Open conversation sidebar"
            title="Open conversations"
            className="hidden h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground lg:inline-flex"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        )}

        <button
          onClick={() => setPaletteOpen(true)}
          className="ml-3 hidden items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary md:flex"
        >
          <Search className="h-3.5 w-3.5" /> Search or jump to…
          <kbd className="rounded border border-border bg-surface px-1 font-mono text-[10px]">
            ⌘K
          </kbd>
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          {outbox.length > 0 && (
            <span className="hidden rounded-full bg-amber-500/12 px-2 py-1 text-[10px] font-medium text-amber-700 dark:text-amber-300 sm:inline">
              {outbox.length} queued
            </span>
          )}
          <button
            onClick={() => setOnline(!online)}
            aria-label={online ? "Simulate going offline" : "Reconnect"}
            title={[
              online ? "Connected — click to simulate offline" : "Offline — click to reconnect",
              // Where this session's data actually lives. Kept in the tooltip
              // rather than on screen: it matters when something is wrong with
              // the connector and never otherwise.
              connectorStatus
                ? `Data: ${connectorStatus.detail}${connectorStatus.ready ? "" : " (unavailable)"}`
                : null,
            ]
              .filter(Boolean)
              .join("\n")}
            className={cn(
              "rounded-lg p-2 transition-colors hover:bg-secondary",
              online ? "text-online" : "text-destructive",
            )}
          >
            {online ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Appearance and language"
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {resolved === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Theme</DropdownMenuLabel>
              {(
                [
                  ["light", Sun, "Light"],
                  ["dark", Moon, "Dark"],
                  ["system", Monitor, "System"],
                ] as const
              ).map(([value, Icon, label]) => (
                <DropdownMenuItem
                  key={value}
                  onClick={() => setPreference(value)}
                  className={cn("gap-2", preference === value && "text-primary")}
                >
                  <Icon className="h-4 w-4" /> {label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="flex items-center gap-1.5">
                <Languages className="h-3.5 w-3.5" /> Language
              </DropdownMenuLabel>
              {(Object.keys(LOCALES) as LocaleCode[]).map((code) => (
                <DropdownMenuItem
                  key={code}
                  onClick={() => setLocale(code)}
                  className={cn(locale === code && "text-primary")}
                >
                  {LOCALES[code].label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs shadow-sm transition-colors hover:bg-secondary">
              <UserAvatar user={currentUser} size={22} />
              <span className="hidden sm:inline">Viewing as {currentUser.name.split(" ")[0]}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => setHeaderProfile(currentUser)} className="gap-2">
                <UserRound className="h-4 w-4" /> My profile
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Demo: switch user</DropdownMenuLabel>
              {users.map((user) => (
                <DropdownMenuItem
                  key={user.id}
                  onClick={() => setCurrentUserId(user.id)}
                  className="gap-2"
                >
                  <UserAvatar user={user} size={22} showStatus /> {user.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setSavedMode("saved")}>
                <Bookmark className="mr-2 h-4 w-4" /> Saved items
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShortcutsOpen(true)}>
                Keyboard shortcuts
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Conversation rail */}
        <div
          className={cn(
            "hidden shrink-0 overflow-hidden transition-[width] duration-300 ease-out lg:block",
            sidebarOpen ? "w-[292px]" : "w-0",
          )}
        >
          <ConversationSidebar
            onCreateGroup={() => openCreateGroup([])}
            onClose={() => setSidebarOpen(false)}
          />
        </div>
        {mobileNav && (
          <div className="fixed inset-0 z-50 flex lg:hidden">
            <div className="w-[85%] max-w-sm animate-msg-in bg-surface">
              <ConversationSidebar
                onCreateGroup={() => {
                  setMobileNav(false);
                  openCreateGroup([]);
                }}
                onSelect={() => setMobileNav(false)}
              />
            </div>
            <div
              className="flex-1 bg-slate-950/25"
              role="button"
              tabIndex={0}
              aria-label="Close conversation list"
              onClick={() => setMobileNav(false)}
              onKeyDown={(event) => event.key === "Enter" && setMobileNav(false)}
            />
          </div>
        )}

        {/* Chat */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="chat-header flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 md:px-6">
            {activeRoom.type === "direct" ? (
              <button
                type="button"
                onClick={() => setHeaderProfile(userById(otherId ?? currentUserId))}
                aria-label={`View ${userById(otherId ?? currentUserId).name}'s profile`}
                className="rounded-full transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <UserAvatar user={userById(otherId ?? currentUserId)} size={40} showStatus />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setGroupProfileOpen(true)}
                aria-label={`View ${roomTitle(activeRoom)} group information`}
                className="rounded-lg transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <GroupAvatar
                  name={roomTitle(activeRoom)}
                  color={activeRoom.color}
                  photo={activeRoom.photo}
                  size={40}
                />
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                activeRoom.type === "direct"
                  ? setHeaderProfile(userById(otherId ?? currentUserId))
                  : setGroupProfileOpen(true)
              }
              className="min-w-0 rounded-md text-left transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <span className="flex items-center gap-2 truncate text-sm font-semibold">
                {roomTitle(activeRoom)}
                {activeRoom.archived && (
                  <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">
                    Archived
                  </span>
                )}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {activeRoom.topic
                  ? activeRoom.topic
                  : activeRoom.type === "direct"
                    ? userById(otherId ?? currentUserId).online
                      ? "Online"
                      : "Offline"
                    : `${participants.length} members • ${onlineCount} online`}
              </span>
            </button>
            <div className="ml-auto flex items-center gap-1">
              {unread.total > 0 && (
                <button
                  onClick={() => void summarizeRoom(activeRoom.id)}
                  className="hidden items-center gap-1.5 rounded-lg border border-ai/30 bg-ai/10 px-2.5 py-1.5 text-[11px] font-medium text-ai transition-colors hover:bg-ai/15 sm:flex"
                >
                  <Sparkles className="h-3.5 w-3.5" /> Catch me up
                </button>
              )}
              <button
                onClick={() => setSavedMode("pinned")}
                aria-label="Pinned messages"
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <Pin className="h-4 w-4" />
              </button>
              <button
                onClick={() => setSearchOpen((open) => !open)}
                aria-label="Search in conversation"
                aria-expanded={searchOpen}
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <Search className="h-4 w-4" />
              </button>
              <button
                onClick={() => setMobilePanel(true)}
                aria-label="Conversation info"
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground xl:hidden"
              >
                <Info className="h-4 w-4" />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="Conversation actions"
                  className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <MoreVertical className="h-4 w-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Notifications</DropdownMenuLabel>
                  <DropdownMenuCheckboxItem
                    checked={notificationLevel(activeRoom.id) === "all"}
                    onSelect={() => setNotificationLevel(activeRoom.id, "all")}
                  >
                    <Bell className="mr-2 h-4 w-4" /> All messages
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={notificationLevel(activeRoom.id) === "mentions"}
                    onSelect={() => setNotificationLevel(activeRoom.id, "mentions")}
                  >
                    <Bell className="mr-2 h-4 w-4" /> Mentions only
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={notificationLevel(activeRoom.id) === "none"}
                    onSelect={() => setNotificationLevel(activeRoom.id, "none")}
                  >
                    <BellOff className="mr-2 h-4 w-4" /> Nothing
                  </DropdownMenuCheckboxItem>
                  {activeRoom.type === "group" && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuCheckboxItem
                        checked={Boolean(activeRoom.groupMuted)}
                        disabled={!isAdmin(activeRoom, currentUserId)}
                        onSelect={() => toggleGroupMute(activeRoom.id)}
                      >
                        <BellOff className="mr-2 h-4 w-4" /> Mute group
                      </DropdownMenuCheckboxItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => openSettings("about")}>
                    <Settings className="mr-2 h-4 w-4" /> Conversation settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openSettings("members")}>
                    <Users className="mr-2 h-4 w-4" /> Manage members
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openSettings("appearance")}>
                    <ImagePlus className="mr-2 h-4 w-4" /> Chat wallpaper
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openCreateGroup(activeRoom.participantIds)}>
                    <Users className="mr-2 h-4 w-4" /> Create group with members
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void summarizeRoom(activeRoom.id)}>
                    <Sparkles className="mr-2 h-4 w-4 text-ai" /> Catch me up
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setMobilePanel(true)}>
                    <Info className="mr-2 h-4 w-4" /> Conversation info
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <PinnedMessageBanner onViewAll={() => setSavedMode("pinned")} />

          {searchOpen && (
            <div className="animate-msg-in border-b border-border bg-surface px-4 py-3 md:px-8">
              <Input
                autoFocus
                value={msgQuery}
                onChange={(event) => setMsgQuery(event.target.value)}
                onKeyDown={(event) => event.key === "Escape" && setSearchOpen(false)}
                placeholder="Search in this conversation…"
                aria-label="Search in this conversation"
                className="h-9 border-border bg-surface text-sm"
              />
              {msgQuery && (
                <div className="mt-2 max-h-44 space-y-1 overflow-y-auto text-xs">
                  {results.length === 0 && <p className="text-muted-foreground">No matches</p>}
                  {results.map((message) => (
                    <button
                      key={message.id}
                      onClick={() => {
                        jumpToMessage(message.roomId, message.id);
                        setSearchOpen(false);
                        setMsgQuery("");
                      }}
                      className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-left transition-colors hover:bg-secondary"
                    >
                      <b className="shrink-0">{userById(message.senderId).name.split(" ")[0]}:</b>
                      <span className="min-w-0 flex-1 truncate">
                        {plainText(previewText(message))}
                      </span>
                      <span
                        suppressHydrationWarning
                        className="shrink-0 text-[10px] text-muted-foreground"
                      >
                        {formatRelative(message.timestamp)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <MessageThread
            onReply={setReplyTo}
            onOpenThread={setThreadRootId}
            onForward={setForwarding}
          />
          <div id="composer">
            <Composer
              replyTo={replyTo}
              clearReply={() => setReplyTo(null)}
              onOpenInvite={() => openSettings("invite")}
              onOpenShortcuts={() => setShortcutsOpen(true)}
            />
          </div>
        </main>

        {/* Thread panel replaces the context panel while open */}
        {threadRootId ? (
          <div className="hidden w-[380px] shrink-0 xl:block">
            <ThreadPanel
              rootId={threadRootId}
              onClose={() => setThreadRootId(null)}
              onForward={setForwarding}
            />
          </div>
        ) : null}

        {threadRootId && (
          <div className="fixed inset-0 z-50 flex justify-end xl:hidden">
            <div
              className="flex-1 bg-slate-950/25"
              role="button"
              tabIndex={0}
              aria-label="Close thread"
              onClick={() => setThreadRootId(null)}
              onKeyDown={(event) => event.key === "Enter" && setThreadRootId(null)}
            />
            <div className="w-[92%] max-w-md animate-msg-in bg-surface">
              <ThreadPanel
                rootId={threadRootId}
                onClose={() => setThreadRootId(null)}
                onForward={setForwarding}
              />
            </div>
          </div>
        )}

        {mobilePanel && (
          <div className="fixed inset-0 z-50 flex justify-end xl:hidden">
            <div
              className="flex-1 bg-slate-950/25"
              role="button"
              tabIndex={0}
              aria-label="Close panel"
              onClick={() => setMobilePanel(false)}
              onKeyDown={(event) => event.key === "Enter" && setMobilePanel(false)}
            />
            <div className="relative w-[90%] max-w-sm animate-msg-in overflow-y-auto border-l border-border bg-surface">
              <button
                onClick={() => setMobilePanel(false)}
                aria-label="Close panel"
                className="absolute right-3 top-3 rounded-lg border border-border bg-surface p-2 hover:bg-secondary"
              >
                <X className="h-4 w-4" />
              </button>
              <ContextPanel
                onCreateGroup={(ids) => {
                  setMobilePanel(false);
                  openCreateGroup(ids);
                }}
                onOpenSettings={(tab) => {
                  setMobilePanel(false);
                  openSettings(tab);
                }}
              />
            </div>
          </div>
        )}
      </div>

      <CreateGroupDialog open={groupOpen} onOpenChange={setGroupOpen} preselected={preselected} />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onOpenSaved={() => setSavedMode("saved")}
        onOpenPinned={() => setSavedMode("pinned")}
        onOpenInvite={() => openSettings("invite")}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onCreateGroup={() => openCreateGroup([])}
      />
      <ForwardDialog message={forwarding} onClose={() => setForwarding(null)} />
      <RoomSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialTab={settingsTab}
      />
      <SavedPinnedDialog mode={savedMode} onClose={() => setSavedMode(null)} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <UserProfileDialog
        user={headerProfile ?? currentUser}
        open={Boolean(headerProfile)}
        onOpenChange={(open) => !open && setHeaderProfile(null)}
      />
      <GroupProfileDialog
        open={groupProfileOpen}
        onOpenChange={setGroupProfileOpen}
        onOpenSettings={() => openSettings("about")}
      />
    </div>
  );
}
