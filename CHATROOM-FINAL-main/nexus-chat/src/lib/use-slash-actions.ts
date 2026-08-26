/**
 * Binds the slash-command registry to the live store, so commands, the command
 * palette and the composer all execute through one implementation.
 */

import { useMemo } from "react";
import { toast } from "sonner";
import { useChat } from "./chat-store";
import type { SlashActions } from "./slash-commands";

export interface SlashActionOverrides {
  openInvite?: () => void;
  openShortcuts?: () => void;
}

export function useSlashActions(overrides: SlashActionOverrides = {}): SlashActions {
  const {
    sendMessage,
    askAgent,
    summarizeRoom,
    setRoomTopic,
    renameRoom,
    leaveRoom,
    setArchived,
    toggleRoomNotifications,
  } = useChat();

  const { openInvite, openShortcuts } = overrides;

  return useMemo<SlashActions>(
    () => ({
      sendMessage: (roomId, text) => sendMessage(roomId, text),
      askAgent: (roomId, prompt) => void askAgent(roomId, prompt),
      summarizeRoom: (roomId) => void summarizeRoom(roomId),
      setTopic: (roomId, topic) => setRoomTopic(roomId, topic),
      renameRoom: (roomId, name) => renameRoom(roomId, name),
      leaveRoom: (roomId) => leaveRoom(roomId),
      archiveRoom: (roomId) => setArchived(roomId, true),
      toggleNotifications: (roomId) => toggleRoomNotifications(roomId),
      openInvite: () => openInvite?.(),
      openShortcuts: () => openShortcuts?.(),
      notifyInfo: (text) => toast.info(text),
    }),
    [
      sendMessage,
      askAgent,
      summarizeRoom,
      setRoomTopic,
      renameRoom,
      leaveRoom,
      setArchived,
      toggleRoomNotifications,
      openInvite,
      openShortcuts,
    ],
  );
}
