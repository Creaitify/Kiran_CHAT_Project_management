/**
 * Slash command registry.
 *
 * Commands are data, not a switch statement in the composer: each entry
 * declares its own argument hint and handler, so the composer, the command
 * palette and the help listing all read from one source.
 */

export interface SlashContext {
  roomId: string;
  /** Raw argument string after the command name. */
  args: string;
  actions: SlashActions;
}

export interface SlashActions {
  sendMessage: (roomId: string, text: string) => void;
  askAgent: (roomId: string, prompt: string) => void;
  summarizeRoom: (roomId: string) => void;
  setTopic: (roomId: string, topic: string) => void;
  renameRoom: (roomId: string, name: string) => void;
  leaveRoom: (roomId: string) => void;
  archiveRoom: (roomId: string) => void;
  toggleNotifications: (roomId: string) => void;
  openInvite: () => void;
  openShortcuts: () => void;
  notifyInfo: (text: string) => void;
}

export interface SlashCommand {
  name: string;
  aliases?: string[];
  hint: string;
  description: string;
  /** Commands that mutate the room are hidden in DMs. */
  groupOnly?: boolean;
  run: (ctx: SlashContext) => void;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "me",
    hint: "<action>",
    description: "Post a message in the third person",
    run: ({ roomId, args, actions }) => {
      if (args.trim()) actions.sendMessage(roomId, `_${args.trim()}_`);
    },
  },
  {
    name: "shrug",
    hint: "[message]",
    description: "Append ¯\\_(ツ)_/¯",
    run: ({ roomId, args, actions }) => {
      actions.sendMessage(roomId, `${args.trim()} ¯\\_(ツ)_/¯`.trim());
    },
  },
  {
    name: "agent",
    aliases: ["ai", "ask"],
    hint: "<question>",
    description: "Ask the private AI assistant",
    run: ({ roomId, args, actions }) => {
      if (args.trim()) actions.askAgent(roomId, args.trim());
    },
  },
  {
    name: "summarize",
    aliases: ["catchup"],
    hint: "",
    description: "Catch me up on what I missed here",
    run: ({ roomId, actions }) => actions.summarizeRoom(roomId),
  },
  {
    name: "topic",
    hint: "<text>",
    description: "Set the conversation topic",
    groupOnly: true,
    run: ({ roomId, args, actions }) => actions.setTopic(roomId, args.trim()),
  },
  {
    name: "rename",
    hint: "<name>",
    description: "Rename this conversation",
    groupOnly: true,
    run: ({ roomId, args, actions }) => {
      if (args.trim()) actions.renameRoom(roomId, args.trim());
    },
  },
  {
    name: "invite",
    hint: "",
    description: "Open the invite link settings",
    groupOnly: true,
    run: ({ actions }) => actions.openInvite(),
  },
  {
    name: "mute",
    aliases: ["unmute"],
    hint: "",
    description: "Toggle notifications for this conversation",
    run: ({ roomId, actions }) => actions.toggleNotifications(roomId),
  },
  {
    name: "archive",
    hint: "",
    description: "Archive this conversation",
    groupOnly: true,
    run: ({ roomId, actions }) => actions.archiveRoom(roomId),
  },
  {
    name: "leave",
    hint: "",
    description: "Leave this conversation",
    groupOnly: true,
    run: ({ roomId, actions }) => actions.leaveRoom(roomId),
  },
  {
    name: "shortcuts",
    aliases: ["keys", "help"],
    hint: "",
    description: "Show keyboard shortcuts",
    run: ({ actions }) => actions.openShortcuts(),
  },
];

export function findCommand(name: string): SlashCommand | undefined {
  const lower = name.toLowerCase();
  return SLASH_COMMANDS.find(
    (command) => command.name === lower || command.aliases?.includes(lower),
  );
}

/** Parses `/name rest…`. Returns null when the text isn't a command. */
export function parseSlash(text: string): { name: string; args: string } | null {
  const match = /^\/([a-zA-Z][\w-]*)\s*([\s\S]*)$/.exec(text.trim());
  if (!match) return null;
  return { name: match[1]!.toLowerCase(), args: match[2] ?? "" };
}

export function commandSuggestions(text: string, isGroup: boolean): SlashCommand[] {
  const match = /^\/([a-zA-Z-]*)$/.exec(text.trimStart());
  if (!match) return [];
  const query = match[1]!.toLowerCase();
  return SLASH_COMMANDS.filter((command) => {
    if (command.groupOnly && !isGroup) return false;
    if (!query) return true;
    return (
      command.name.startsWith(query) ||
      (command.aliases ?? []).some((alias) => alias.startsWith(query))
    );
  }).slice(0, 6);
}
