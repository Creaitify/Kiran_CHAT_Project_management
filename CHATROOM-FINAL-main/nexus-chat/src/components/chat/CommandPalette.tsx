import { useMemo, useState } from "react";
import {
  Archive,
  Bookmark,
  Hash,
  LogOut,
  MessageCircle,
  Moon,
  Pin,
  Search,
  Sparkles,
  Sun,
  Users,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useChat } from "@/lib/chat-store";
import { previewText } from "@/lib/chat-types";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { SLASH_COMMANDS } from "@/lib/slash-commands";
import { useSlashActions } from "@/lib/use-slash-actions";
import { formatRelative } from "@/lib/time";
import { GroupAvatar, UserAvatar } from "./UserAvatar";

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSaved: () => void;
  onOpenPinned: () => void;
  onOpenInvite: () => void;
  onOpenShortcuts: () => void;
  onCreateGroup: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  onOpenSaved,
  onOpenPinned,
  onOpenInvite,
  onOpenShortcuts,
  onCreateGroup,
}: CommandPaletteProps) {
  const {
    visibleRooms,
    archivedRooms,
    roomTitle,
    setActiveRoom,
    users,
    currentUserId,
    openDirect,
    searchMessages,
    jumpToMessage,
    userById,
    activeRoom,
    plainText,
  } = useChat();
  const { t } = useI18n();
  const { resolved, setPreference } = useTheme();
  const slashActions = useSlashActions({
    openInvite: onOpenInvite,
    openShortcuts: onOpenShortcuts,
  });
  const [query, setQuery] = useState("");

  // Message search only kicks in past 2 characters — below that every message
  // matches and the list is noise.
  const messageHits = useMemo(
    () => (query.trim().length > 2 ? searchMessages(query).slice(0, 6) : []),
    [query, searchMessages],
  );

  const run = (action: () => void) => {
    action();
    onOpenChange(false);
    setQuery("");
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput value={query} onValueChange={setQuery} placeholder={t("palette.placeholder")} />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Conversations">
          {visibleRooms.map((room) => {
            const otherId = room.participantIds.find((id) => id !== currentUserId);
            return (
              <CommandItem
                key={room.id}
                value={`room ${roomTitle(room)}`}
                onSelect={() => run(() => setActiveRoom(room.id))}
              >
                {room.type === "direct" ? (
                  <UserAvatar user={userById(otherId ?? currentUserId)} size={20} />
                ) : (
                  <GroupAvatar
                    name={roomTitle(room)}
                    color={room.color}
                    photo={room.photo}
                    size={20}
                  />
                )}
                <span className="ml-2 truncate">{roomTitle(room)}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandGroup heading="People">
          {users
            .filter((user) => user.id !== currentUserId)
            .map((user) => (
              <CommandItem
                key={user.id}
                value={`person ${user.name} ${user.role}`}
                onSelect={() => run(() => openDirect(user.id))}
              >
                <UserAvatar user={user} size={20} showStatus />
                <span className="ml-2 truncate">{user.name}</span>
                <span className="ml-auto text-[11px] text-muted-foreground">{user.role}</span>
              </CommandItem>
            ))}
        </CommandGroup>

        {messageHits.length > 0 && (
          <CommandGroup heading="Messages">
            {messageHits.map((message) => (
              <CommandItem
                key={message.id}
                value={`message ${message.id} ${plainText(message.content)}`}
                onSelect={() => run(() => jumpToMessage(message.roomId, message.id))}
              >
                <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  <b className="font-medium">{userById(message.senderId).name.split(" ")[0]}:</b>{" "}
                  {plainText(previewText(message))}
                </span>
                <span
                  suppressHydrationWarning
                  className="ml-2 shrink-0 text-[10px] text-muted-foreground"
                >
                  {formatRelative(message.timestamp)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem value="action new group" onSelect={() => run(onCreateGroup)}>
            <Users className="mr-2 h-4 w-4" /> Create a group
          </CommandItem>
          <CommandItem value="action saved items" onSelect={() => run(onOpenSaved)}>
            <Bookmark className="mr-2 h-4 w-4" /> Saved items
          </CommandItem>
          <CommandItem value="action pinned messages" onSelect={() => run(onOpenPinned)}>
            <Pin className="mr-2 h-4 w-4" /> Pinned in this conversation
          </CommandItem>
          <CommandItem
            value="action theme toggle dark light"
            onSelect={() => run(() => setPreference(resolved === "dark" ? "light" : "dark"))}
          >
            {resolved === "dark" ? (
              <Sun className="mr-2 h-4 w-4" />
            ) : (
              <Moon className="mr-2 h-4 w-4" />
            )}
            Switch to {resolved === "dark" ? "light" : "dark"} theme
          </CommandItem>
          <CommandItem value="action keyboard shortcuts" onSelect={() => run(onOpenShortcuts)}>
            <Hash className="mr-2 h-4 w-4" /> Keyboard shortcuts
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Commands">
          {SLASH_COMMANDS.filter(
            (command) => !command.groupOnly || activeRoom.type === "group",
          ).map((command) => (
            <CommandItem
              key={command.name}
              value={`slash ${command.name} ${command.description}`}
              onSelect={() =>
                run(() => command.run({ roomId: activeRoom.id, args: "", actions: slashActions }))
              }
            >
              {command.name === "agent" || command.name === "summarize" ? (
                <Sparkles className="mr-2 h-4 w-4 text-ai" />
              ) : command.name === "leave" ? (
                <LogOut className="mr-2 h-4 w-4" />
              ) : command.name === "archive" ? (
                <Archive className="mr-2 h-4 w-4" />
              ) : (
                <MessageCircle className="mr-2 h-4 w-4" />
              )}
              /{command.name}
              <span className="ml-2 truncate text-[11px] text-muted-foreground">
                {command.description}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>

        {archivedRooms.length > 0 && (
          <CommandGroup heading="Archived">
            {archivedRooms.map((room) => (
              <CommandItem
                key={room.id}
                value={`archived ${roomTitle(room)}`}
                onSelect={() => run(() => setActiveRoom(room.id))}
              >
                <Archive className="mr-2 h-4 w-4 text-muted-foreground" />
                <span className="truncate">{roomTitle(room)}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
