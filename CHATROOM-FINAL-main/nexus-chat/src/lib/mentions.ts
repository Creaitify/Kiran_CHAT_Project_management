/**
 * Mention parsing.
 *
 * Mentions are stored in the message text in a stable, unambiguous encoding —
 * `<@u2>` for a user, `<!engineering>` for a group, `<!channel>` / `<!here>`
 * for broadcasts — rather than as a display name. That means renaming a user
 * never breaks an old mention, and it removes the ambiguity of matching
 * free-text `@Priya` against a directory at render time. The composer converts
 * between the encoding and what the user sees.
 */

import type { GroupHandle, MessageMentions, User, UserGroup, UserId } from "./chat-types";

export const USER_TOKEN = /<@([a-zA-Z0-9_-]+)>/g;
export const SPECIAL_TOKEN = /<!([a-zA-Z0-9_-]+)>/g;

export const BROADCAST_HANDLES = ["channel", "here"] as const;
export type BroadcastHandle = (typeof BROADCAST_HANDLES)[number];

export function isBroadcast(handle: string): handle is BroadcastHandle {
  return (BROADCAST_HANDLES as readonly string[]).includes(handle);
}

/** Extracts the structured mention set stored alongside a message. */
export function parseMentions(text: string, groups: UserGroup[]): MessageMentions {
  const users = new Set<UserId>();
  const groupHandles = new Set<GroupHandle>();
  let broadcast: MessageMentions["broadcast"] = null;

  for (const match of text.matchAll(USER_TOKEN)) users.add(match[1]!);
  for (const match of text.matchAll(SPECIAL_TOKEN)) {
    const handle = match[1]!;
    if (isBroadcast(handle)) {
      // `@channel` outranks `@here` when both appear.
      if (handle === "channel" || broadcast === null) broadcast = handle;
      continue;
    }
    if (groups.some((group) => group.handle === handle)) groupHandles.add(handle);
  }

  return { users: [...users], groups: [...groupHandles], broadcast };
}

/**
 * Resolves a mention set to the users who should actually be notified.
 * `@here` deliberately narrows to online members — that is the whole point of
 * it existing next to `@channel`.
 */
export function resolveMentionTargets(
  mentions: MessageMentions | undefined,
  room: { participantIds: UserId[] },
  users: User[],
  groups: UserGroup[],
): UserId[] {
  if (!mentions) return [];
  const targets = new Set<UserId>();
  const isMember = (id: UserId) => room.participantIds.includes(id);

  for (const id of mentions.users) if (isMember(id)) targets.add(id);

  for (const handle of mentions.groups) {
    const group = groups.find((g) => g.handle === handle);
    if (!group) continue;
    for (const id of group.memberIds) if (isMember(id)) targets.add(id);
  }

  if (mentions.broadcast === "channel") {
    for (const id of room.participantIds) targets.add(id);
  } else if (mentions.broadcast === "here") {
    for (const id of room.participantIds) {
      if (users.find((u) => u.id === id)?.online) targets.add(id);
    }
  }

  return [...targets];
}

export function mentionsUser(
  mentions: MessageMentions | undefined,
  userId: UserId,
  room: { participantIds: UserId[] },
  users: User[],
  groups: UserGroup[],
): boolean {
  return resolveMentionTargets(mentions, room, users, groups).includes(userId);
}

/** Turns the stored encoding into readable text for search, previews and the AI context. */
export function toPlainText(text: string, users: User[], groups: UserGroup[]): string {
  return text
    .replace(USER_TOKEN, (_, id: string) => {
      const user = users.find((u) => u.id === id);
      return `@${user ? user.name : "unknown"}`;
    })
    .replace(SPECIAL_TOKEN, (_, handle: string) => {
      if (isBroadcast(handle)) return `@${handle}`;
      const group = groups.find((g) => g.handle === handle);
      return `@${group ? group.handle : handle}`;
    });
}

export interface MentionCandidate {
  key: string;
  /** What gets inserted into the message text. */
  token: string;
  /** What the user sees in the autocomplete list. */
  label: string;
  detail: string;
  kind: "user" | "group" | "broadcast" | "agent";
  user?: User;
}

/** Ranked autocomplete candidates for the text after an `@`. */
export function mentionCandidates(
  query: string,
  users: User[],
  groups: UserGroup[],
  currentUserId: UserId,
  roomParticipantIds: UserId[],
): MentionCandidate[] {
  const q = query.toLowerCase();
  const matches = (value: string) => value.toLowerCase().includes(q);
  const candidates: MentionCandidate[] = [];

  if (matches("agent")) {
    candidates.push({
      key: "agent",
      token: "@agent",
      label: "@agent",
      detail: "Ask the private AI assistant",
      kind: "agent",
    });
  }

  for (const user of users) {
    if (user.id === currentUserId) continue;
    if (!roomParticipantIds.includes(user.id)) continue;
    if (q && !matches(user.name)) continue;
    candidates.push({
      key: user.id,
      token: `<@${user.id}>`,
      label: user.name,
      detail: user.role,
      kind: "user",
      user,
    });
  }

  for (const group of groups) {
    if (q && !matches(group.handle) && !matches(group.name)) continue;
    candidates.push({
      key: group.id,
      token: `<!${group.handle}>`,
      label: `@${group.handle}`,
      detail: `${group.name} · ${group.memberIds.length} people`,
      kind: "group",
    });
  }

  for (const handle of BROADCAST_HANDLES) {
    if (q && !matches(handle)) continue;
    candidates.push({
      key: handle,
      token: `<!${handle}>`,
      label: `@${handle}`,
      detail:
        handle === "channel"
          ? "Notify everyone in this conversation"
          : "Notify everyone who is online",
      kind: "broadcast",
    });
  }

  return candidates.slice(0, 8);
}

/** Locates the `@…` fragment the caret currently sits in, if any. */
export function activeMentionQuery(
  text: string,
  caret: number,
): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const match = /(?:^|\s)@([\w-]*)$/.exec(before);
  if (!match) return null;
  return { query: match[1]!.toLowerCase(), start: caret - match[1]!.length - 1 };
}
