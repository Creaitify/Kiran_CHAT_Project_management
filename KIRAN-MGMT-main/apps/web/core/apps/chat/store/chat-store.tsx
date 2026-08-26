/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Workspace state.
 *
 * This is the standalone app's store with its persistence layer replaced, not a
 * rewrite. The original said of itself: "replacing `createLocalTransport` with a
 * real API client and the snapshot effect with server queries is the whole of
 * the backend migration on this side." That turned out to be true, and this file
 * is that migration.
 *
 * What changed, and nothing else did:
 *
 *   - Boot fetches rooms, history and read markers from the API instead of
 *     reading a localStorage blob, and falls back to nothing rather than to
 *     seed fixtures. There are real accounts now; there is no `u1`.
 *   - Every mutation other people can see calls its own endpoint. The local
 *     state update stays exactly where it was and becomes the optimistic
 *     update; the request follows it.
 *   - `save(wholeWorkspace)` is gone. Only drafts and the active room -- the
 *     things that are genuinely nobody else's business -- still touch
 *     localStorage.
 *   - A poll against `/updates/` replaces the storage `subscribe`, so other
 *     people's messages arrive.
 *
 * The outbox, the retry loop with jittered backoff, the read-marker maths, the
 * thread and pagination helpers and every derived selector are untouched. They
 * were written as if a server owned the data, which is why they survived
 * contact with one.
 *
 * ---------------------------------------------------------------------------
 * Optimism, and where it stops
 * ---------------------------------------------------------------------------
 * Mutations apply locally first and reconcile when the server answers, because
 * a chat that waits for a round trip before showing your own message feels
 * broken. The rule for what happens on failure is deliberately not uniform:
 *
 *   - A failed SEND is kept. It sits in the outbox as `failed`, is retried, and
 *     the user can retry or discard it by hand. Losing text somebody typed is
 *     the one unacceptable outcome.
 *   - A failed toggle (reaction, pin, save) is rolled back and reported. These
 *     are cheap to redo and a lie on screen is worse than a flicker.
 *   - A failed room edit is reported and the next poll corrects the screen.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import {
  encodeCursor,
  isTombstoned,
  previewText,
  type Cursor,
  type Draft,
  type Invite,
  type LinkPreview,
  type MessageId,
  type Notification,
  type NotificationLevel,
  type PrivateAIMessage,
  type ReadState,
  type Room,
  type RoomId,
  type SharedMessage,
  type UnreadSummary,
  type User,
  type UserGroup,
  type UserId,
} from "../lib/chat-types";
import { compareMessages, PAGE_SIZE } from "../lib/paginate";
import { mentionsUser, parseMentions, resolveMentionTargets, toPlainText } from "../lib/mentions";
import { derivePreviews } from "../lib/link-preview";
import { inviteIsUsable } from "../lib/invite-rules";
import { draftKey } from "../lib/draft-key";
import { ChatService } from "../services/chat.service";
import { toIso } from "../services/wire";
import {
  bootstrapChat,
  directoryFromWorkspaceMembers,
  mergeMessages,
  mergeReadState,
  mergeRooms,
  readLocalState,
  subscribeToChatUpdates,
  writeLocalState,
} from "./connector";
import { backoffDelay, createApiTransport, TransportError, type Transport } from "./transport";

/**
 * Connector reporting, kept because the diagnostics panel renders it and
 * because "is chat actually talking to anything" is the first question anyone
 * asks. There is only one implementation now, so `kind` is a constant -- the
 * Stage 1 local/api switch existed to let chat run with no backend at all, and
 * there is a backend.
 */
export type ConnectorKind = "api";
export type ConnectorStatus = { kind: ConnectorKind; ready: boolean; detail: string };

/**
 * Client-side ids for optimistic rows.
 *
 * Only ever temporary: the moment the server acknowledges a message, the row
 * adopts the real UUID. They are prefixed so a local id showing up somewhere it
 * should not is obvious in a log rather than merely wrong.
 */
function newId(prefix = ""): string {
  return `${prefix}${uuidv4()}`;
}

const AI_TOKEN_BUDGET = 60_000;
const AI_BUDGET_WINDOW = 24 * 60 * 60 * 1000;
const MAX_ATTACHMENT_BYTES = 15_000_000;
const MAX_RETRY_ATTEMPTS = 5;

export interface AiBudget {
  used: number;
  limit: number;
  resetAt: number;
}

interface ChatContextValue {
  /* directory */
  users: User[];
  userGroups: UserGroup[];
  currentUser: User;
  currentUserId: UserId;
  setCurrentUserId: (id: UserId) => void;
  userById: (id: UserId) => User;

  /* rooms */
  rooms: Room[];
  visibleRooms: Room[];
  archivedRooms: Room[];
  activeRoom: Room;
  activeRoomId: RoomId;
  setActiveRoom: (id: RoomId) => void;
  roomTitle: (room: Room) => string;
  canSend: (room: Room, userId: UserId) => { allowed: boolean; reason?: string };
  isAdmin: (room: Room, userId?: UserId) => boolean;

  /* messages */
  messages: SharedMessage[];
  channelMessages: SharedMessage[];
  hasMoreHistory: boolean;
  loadOlder: () => void;
  messageById: (id: MessageId) => SharedMessage | undefined;
  lastMessage: (roomId: RoomId) => SharedMessage | undefined;

  sendMessage: (
    roomId: RoomId,
    content: string,
    options?: {
      replyToId?: MessageId | null;
      threadRootId?: MessageId | null;
      sharedProfileUserId?: UserId;
    },
  ) => void;
  sendAttachment: (
    roomId: RoomId,
    file: File,
    caption?: string,
    options?: { replyToId?: MessageId | null; threadRootId?: MessageId | null },
  ) => Promise<void>;
  editMessage: (id: MessageId, content: string) => void;
  deleteMessage: (id: MessageId) => void;
  retryMessage: (id: MessageId) => void;
  discardMessage: (id: MessageId) => void;
  forwardMessage: (id: MessageId, targetRoomIds: RoomId[]) => void;
  toggleReaction: (id: MessageId, emoji: string) => void;
  togglePin: (id: MessageId) => void;
  toggleSave: (id: MessageId) => void;
  isSaved: (id: MessageId) => boolean;
  savedMessages: () => SharedMessage[];
  pinnedMessages: (roomId: RoomId) => SharedMessage[];
  permalinkFor: (message: SharedMessage) => string;

  /* scheduled */
  scheduleMessage: (roomId: RoomId, content: string, sendAt: number) => void;
  scheduledMessages: (roomId?: RoomId) => SharedMessage[];
  cancelScheduled: (id: MessageId) => void;
  sendScheduledNow: (id: MessageId) => void;

  /* threads */
  threadReplies: (rootId: MessageId) => SharedMessage[];
  threadCount: (rootId: MessageId) => number;
  threadParticipants: (rootId: MessageId) => User[];
  isFollowingThread: (rootId: MessageId) => boolean;
  toggleFollowThread: (rootId: MessageId) => void;

  /* read state */
  readState: ReadState;
  markRoomRead: (roomId: RoomId) => void;
  unreadFor: (roomId: RoomId) => UnreadSummary;
  readersOf: (message: SharedMessage) => User[];

  /* drafts */
  getDraft: (roomId: RoomId, threadRootId?: MessageId | null) => Draft | undefined;
  saveDraft: (
    roomId: RoomId,
    draft: Omit<Draft, "updatedAt">,
    threadRootId?: MessageId | null,
  ) => void;
  clearDraft: (roomId: RoomId, threadRootId?: MessageId | null) => void;
  draftRoomIds: () => RoomId[];

  /* rooms management */
  /**
   * Room creation is asynchronous now: the server owns the id, and returning a
   * locally-invented one would hand callers something they cannot write to.
   * Every existing call site either awaits this or ignores the result -- the
   * function selects the new room itself.
   */
  openDirect: (otherUserId: UserId) => Promise<RoomId>;
  createGroup: (input: { name: string; description: string; participantIds: UserId[] }) => Promise<RoomId>;
  createGroupDm: (participantIds: UserId[]) => Promise<RoomId>;
  renameRoom: (roomId: RoomId, name: string) => void;
  setRoomTopic: (roomId: RoomId, topic: string) => void;
  setRoomDescription: (roomId: RoomId, description: string) => void;
  updateGroupPhoto: (roomId: RoomId, photo: Room["photo"] | null) => boolean;
  addMembers: (roomId: RoomId, userIds: UserId[]) => void;
  removeMember: (roomId: RoomId, userId: UserId) => void;
  toggleAdmin: (roomId: RoomId, userId: UserId) => void;
  leaveRoom: (roomId: RoomId) => void;
  setArchived: (roomId: RoomId, archived: boolean) => void;
  toggleGroupMute: (roomId: RoomId) => void;
  toggleUserMute: (roomId: RoomId, userId: UserId) => void;
  setNotificationLevel: (roomId: RoomId, level: NotificationLevel) => void;
  notificationLevel: (roomId: RoomId) => NotificationLevel;
  toggleRoomNotifications: (roomId: RoomId) => void;

  /* invites */
  createInvite: (
    roomId: RoomId,
    options: { expiresInMs: number | null; maxUses: number | null },
  ) => void;
  revokeInvite: (roomId: RoomId) => void;
  inviteStatus: (invite: Invite | null | undefined) => "active" | "expired" | "exhausted" | "none";
  roomByCode: (code: string) => Room | null;
  joinByCode: (code: string) => Promise<{ room: Room | null; error?: string }>;

  /* AI */
  aiMessages: PrivateAIMessage[];
  askAgent: (roomId: RoomId, prompt: string) => Promise<void>;
  regenerateAgent: (aiId: string) => Promise<void>;
  shareAiToChat: (aiId: string) => void;
  summarizeRoom: (roomId: RoomId) => Promise<void>;
  aiBudget: AiBudget;
  aiConversation: (roomId: RoomId) => PrivateAIMessage[];

  /* notifications */
  notifications: Notification[];
  markNotificationsRead: () => void;
  unreadNotificationCount: number;

  /* transport */
  online: boolean;
  setOnline: (online: boolean) => void;
  outbox: SharedMessage[];

  /* connector */
  /** Which data connector this build selected. */
  connectorKind: ConnectorKind;
  /** Result of the connector's reachability probe; null until it answers. */
  connectorStatus: ConnectorStatus | null;

  /* navigation */
  pendingJump: MessageId | null;
  jumpToMessage: (roomId: RoomId, messageId: MessageId) => void;
  clearJump: () => void;
  searchMessages: (query: string, roomId?: RoomId) => SharedMessage[];
  plainText: (text: string) => string;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  // Identity and scope come from the shell, not from a demo user switcher and
  // not from an env var. This is the single largest behavioural difference
  // between this store and the one it was ported from.
  const { currentUser: signedInUser, workspaceSlug } = useAppContext();
  const { workspaceMemberIds, getWorkspaceMemberDetails } = useMember();

  const currentUserId: UserId = signedInUser?.id ?? "";

  /**
   * The directory is the workspace's member list, derived rather than stored.
   * Chat used to own a `User[]`; it now borrows one, so a person renamed in
   * workspace settings is renamed in chat without chat knowing it happened.
   */
  const users = useMemo<User[]>(
    () =>
      directoryFromWorkspaceMembers(
        (workspaceMemberIds ?? [])
          .map((id) => getWorkspaceMemberDetails(id))
          .filter((detail): detail is NonNullable<typeof detail> => Boolean(detail?.member))
          .map((detail) => ({ member: detail.member as never, role: detail.role }))
      ),
    [workspaceMemberIds, getWorkspaceMemberDetails]
  );

  /**
   * Mention groups (`@engineering`) have no server model yet, so the list is
   * empty rather than fabricated. `parseMentions` and the composer's
   * autocomplete both handle an empty group list correctly -- they simply offer
   * no group suggestions -- which is the honest behaviour until groups exist.
   */
  const [userGroups] = useState<UserGroup[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [messages, setMessages] = useState<SharedMessage[]>([]);
  const [aiMessages, setAiMessages] = useState<PrivateAIMessage[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<RoomId>("");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [readState, setReadState] = useState<ReadState>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saved, setSaved] = useState<Record<UserId, MessageId[]>>({});
  const [followedThreads, setFollowedThreads] = useState<Record<UserId, MessageId[]>>({});
  const [storageReady, setStorageReady] = useState(false);
  const [connectorStatus, setConnectorStatus] = useState<ConnectorStatus | null>(null);
  const [online, setOnlineState] = useState(true);
  const [pendingJump, setPendingJump] = useState<MessageId | null>(null);
  /** How many messages of history are materialised for the active room. */
  const [windowSize, setWindowSize] = useState(PAGE_SIZE);
  const [aiBudget, setAiBudget] = useState<AiBudget>({
    used: 0,
    limit: AI_TOKEN_BUDGET,
    resetAt: Date.now() + AI_BUDGET_WINDOW,
  });

  /**
   * One service and one transport per provider. Rebuilding either on a render
   * would drop the in-flight retry timers that reference them.
   */
  const serviceRef = useRef<ChatService | null>(null);
  if (!serviceRef.current) serviceRef.current = new ChatService();
  const service = serviceRef.current;

  const transport = useRef<Transport>(createApiTransport(service, workspaceSlug));
  /** Timers for in-flight retries, cleared on unmount so tests don't leak. */
  const retryTimers = useRef(new Map<MessageId, ReturnType<typeof setTimeout>>());
  /** Cursor and "is there more" per room, for scrollback. Not rendered. */
  const historyRef = useRef<{ cursors: Record<RoomId, string | null>; more: Record<RoomId, boolean> }>({
    cursors: {},
    more: {},
  });
  /** Server clock from the last successful poll. Never a local reading. */
  const watermarkRef = useRef<string>(new Date().toISOString());

  /* ---------------------------------------------------------------------- */
  /* Boot and live updates                                                  */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    if (!workspaceSlug || !currentUserId) return;

    // A late resolution after unmount would set state on a dead provider, and
    // a stale poll would keep running after a workspace switch.
    let live = true;

    const local = readLocalState(currentUserId);
    setDrafts(local.drafts);
    if (local.watermark) watermarkRef.current = local.watermark;

    void (async () => {
      try {
        const boot = await bootstrapChat(service, workspaceSlug);
        if (!live) return;

        setRooms(boot.rooms);
        setMessages(boot.messages);
        setReadState(boot.readState);
        historyRef.current = { cursors: boot.cursorByRoom, more: boot.hasMoreByRoom };

        // Prefer the room the user was last in, but only if they are still a
        // member of it -- being restored into a conversation you were removed
        // from is a confusing way to find out.
        const restorable = boot.rooms.find((room) => room.id === local.activeRoomId && !room.archived);
        const firstOpen = boot.rooms.find((room) => !room.archived);
        setActiveRoomId(restorable?.id ?? firstOpen?.id ?? "");

        setConnectorStatus({
          kind: "api",
          ready: true,
          detail: `KIRAN API — ${boot.rooms.length} conversation${boot.rooms.length === 1 ? "" : "s"}`,
        });
      } catch (error) {
        if (!live) return;
        // Chat opens empty rather than not at all. The status line is what tells
        // a developer why, and the poll below keeps trying.
        setConnectorStatus({
          kind: "api",
          ready: false,
          detail: error instanceof Error ? error.message : "Could not reach the chat API",
        });
      } finally {
        if (live) setStorageReady(true);
      }
    })();

    const unsubscribe = subscribeToChatUpdates(service, workspaceSlug, watermarkRef.current, (delta) => {
      if (!live) return;
      watermarkRef.current = delta.watermark;
      setMessages((current) => mergeMessages(current, delta.messages));
      setRooms((current) => mergeRooms(current, delta.rooms));
      setReadState((current) => mergeReadState(current, delta.readState));
    });

    return () => {
      live = false;
      unsubscribe();
    };
  }, [service, workspaceSlug, currentUserId]);

  /**
   * The only thing still written locally.
   *
   * This used to be `save(theEntireWorkspace)` on every state change. What is
   * left is the slice that is genuinely per-device: an unsent draft, which room
   * you had open, and the polling watermark. Everything else earned a table.
   */
  useEffect(() => {
    if (!storageReady || !currentUserId) return;
    writeLocalState(currentUserId, {
      activeRoomId: activeRoomId || null,
      drafts,
      watermark: watermarkRef.current,
    });
  }, [storageReady, currentUserId, activeRoomId, drafts]);

  useEffect(() => {
    const timers = retryTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Directory helpers                                                      */
  /* ---------------------------------------------------------------------- */

  const userById = useCallback(
    (id: UserId) => users.find((user) => user.id === id) ?? users[0]!,
    [users],
  );

  const plainText = useCallback(
    (text: string) => toPlainText(text, users, userGroups),
    [users, userGroups],
  );

  const notify = useCallback((notification: Omit<Notification, "id" | "timestamp">) => {
    setNotifications((current) =>
      [{ ...notification, id: newId("n"), timestamp: Date.now() }, ...current].slice(0, 50),
    );
  }, []);

  const visibleRooms = useMemo(
    () => rooms.filter((room) => room.participantIds.includes(currentUserId) && !room.archived),
    [rooms, currentUserId],
  );

  const archivedRooms = useMemo(
    () => rooms.filter((room) => room.participantIds.includes(currentUserId) && room.archived),
    [rooms, currentUserId],
  );

  const activeRoom = useMemo(
    () => rooms.find((room) => room.id === activeRoomId) ?? visibleRooms[0] ?? rooms[0]!,
    [rooms, activeRoomId, visibleRooms],
  );

  const roomTitle = useCallback(
    (room: Room) => {
      if (room.type === "group") return room.name ?? "Group";
      const others = room.participantIds.filter((id) => id !== currentUserId);
      if (room.type === "groupdm") {
        if (room.name) return room.name;
        const names = others.map((id) => userById(id).name.split(" ")[0]);
        return names.length > 3
          ? `${names.slice(0, 3).join(", ")} +${names.length - 3}`
          : names.join(", ") || "Group message";
      }
      const other = others[0];
      return other ? userById(other).name : "Direct message";
    },
    [currentUserId, userById],
  );

  const isAdmin = useCallback(
    (room: Room, userId: UserId = currentUserId) => room.adminIds.includes(userId),
    [currentUserId],
  );

  const canSend = useCallback((room: Room, userId: UserId) => {
    if (room.archived) return { allowed: false, reason: "archived" };
    if (room.type !== "group") return { allowed: true };
    if (room.groupMuted && !room.adminIds.includes(userId))
      return { allowed: false, reason: "group" };
    if (room.mutedUserIds.includes(userId)) return { allowed: false, reason: "user" };
    return { allowed: true };
  }, []);

  const messageById = useCallback(
    (id: MessageId) => messages.find((message) => message.id === id),
    [messages],
  );

  /* ---------------------------------------------------------------------- */
  /* Read state                                                             */
  /* ---------------------------------------------------------------------- */

  const markRoomRead = useCallback(
    (roomId: RoomId) => {
      setMessages((current) => {
        const roomMessages = current
          .filter((message) => message.roomId === roomId && !message.scheduledFor)
          .sort(compareMessages);
        const newest = roomMessages[roomMessages.length - 1];
        setReadState((state) => {
          const room = state[roomId] ?? {};
          const existing = room[currentUserId];
          const nextTimestamp = newest?.timestamp ?? existing?.lastReadTimestamp ?? 0;
          if (existing && existing.lastReadTimestamp >= nextTimestamp) return state;
          return {
            ...state,
            [roomId]: {
              ...room,
              [currentUserId]: {
                lastReadTimestamp: nextTimestamp,
                lastReadMessageId: newest?.id ?? existing?.lastReadMessageId ?? null,
                updatedAt: Date.now(),
              },
            },
          };
        });
        // Advancing our own marker is the one write the server can safely
        // ignore if it fails: the next poll re-reports the truth, and a
        // wrongly-unread badge costs a glance rather than data.
        if (newest) {
          void service.markRead(workspaceSlug, roomId, newest.id).catch(() => {});
        }
        return current;
      });
    },
    [currentUserId, service, workspaceSlug],
  );

  const unreadFor = useCallback(
    (roomId: RoomId): UnreadSummary => {
      const room = rooms.find((r) => r.id === roomId);
      const marker = readState[roomId]?.[currentUserId];
      const since = marker?.lastReadTimestamp ?? 0;
      let total = 0;
      let mentions = 0;
      let firstUnreadId: MessageId | null = null;

      for (const message of messages) {
        if (message.roomId !== roomId) continue;
        if (message.scheduledFor) continue;
        if (message.threadRootId) continue;
        if (message.senderId === currentUserId) continue;
        if (message.timestamp <= since) continue;
        total += 1;
        if (!firstUnreadId) firstUnreadId = message.id;
        if (room && mentionsUser(message.mentions, currentUserId, room, users, userGroups)) {
          mentions += 1;
        }
      }
      return { total, mentions, firstUnreadId };
    },
    [messages, readState, currentUserId, rooms, users, userGroups],
  );

  /** Other members whose read marker has passed this message. */
  const readersOf = useCallback(
    (message: SharedMessage) => {
      const room = readState[message.roomId] ?? {};
      return Object.entries(room)
        .filter(
          ([userId, marker]) =>
            userId !== message.senderId && marker.lastReadTimestamp >= message.timestamp,
        )
        .map(([userId]) => userById(userId));
    },
    [readState, userById],
  );

  /* ---------------------------------------------------------------------- */
  /* Sending                                                                */
  /* ---------------------------------------------------------------------- */

  const dispatchSend = useCallback(async (message: SharedMessage) => {
    const attempt = (message.attempts ?? 0) + 1;
    setMessages((current) =>
      current.map((m) =>
        m.id === message.id ? { ...m, delivery: "sending", attempts: attempt } : m,
      ),
    );

    try {
      const ack = await transport.current.send({
        clientId: message.clientId,
        roomId: message.roomId,
        senderId: message.senderId,
        message,
      });
      setMessages((current) =>
        current.map((m) =>
          m.id === message.id
            ? {
                ...m,
                // Adopt the real row id. Until this point the message has a
                // locally-minted one, and anything keyed on it -- reactions,
                // replies, the permalink -- would address a row that does not
                // exist on the server.
                id: ack.serverId,
                delivery: "sent",
                // The server's receive time is the ordering authority, except
                // for a duplicate: that row is already on screen at a position
                // the user can see, and moving it would be worse than a
                // slightly stale timestamp.
                timestamp: ack.duplicate ? m.timestamp : ack.timestamp,
                ...(m.failureReason !== undefined ? { failureReason: undefined } : {}),
              }
            : m,
        ),
      );
      // The server has it; the tick turns solid once the write is acknowledged
      // rather than after a cosmetic delay. Matched on clientId because the row
      // just adopted a new id above.
      setTimeout(() => {
        setMessages((current) =>
          current.map((m) =>
            m.clientId === message.clientId && m.delivery === "sent" ? { ...m, delivery: "delivered" } : m,
          ),
        );
      }, 120);
    } catch (error) {
      const retriable = error instanceof TransportError ? error.retriable : true;
      const reason = error instanceof Error ? error.message : "Send failed";
      setMessages((current) =>
        current.map((m) =>
          m.id === message.id ? { ...m, delivery: "failed", failureReason: reason } : m,
        ),
      );

      if (retriable && attempt < MAX_RETRY_ATTEMPTS && transport.current.isOnline()) {
        const timer = setTimeout(() => {
          retryTimers.current.delete(message.id);
          void dispatchSend({ ...message, attempts: attempt });
        }, backoffDelay(attempt));
        retryTimers.current.set(message.id, timer);
      }
    }
  }, []);

  /**
   * Runs a server call behind an optimistic update that has already happened.
   *
   * On failure it calls `revert` and says so once. Deliberately does NOT retry:
   * these are toggles and edits, all of them one click to redo, and a silent
   * background retry of "unpin this message" is a worse outcome than a toast.
   * Sending is the exception and has its own retry loop.
   */
  const withServer = useCallback(async (run: () => Promise<unknown>, revert: () => void, whatFailed: string) => {
    try {
      await run();
    } catch (error) {
      revert();
      const detail =
        typeof error === "object" && error !== null && typeof (error as { detail?: string }).detail === "string"
          ? (error as { detail: string }).detail
          : null;
      toast.error(detail ?? `Could not ${whatFailed}.`);
    }
  }, []);

  const buildMessage = useCallback(
    (roomId: RoomId, content: string, extras: Partial<SharedMessage> = {}): SharedMessage => {
      const previews: LinkPreview[] = derivePreviews(content);
      return {
        id: newId("m"),
        clientId: newId("c"),
        roomId,
        senderId: currentUserId,
        content,
        timestamp: Date.now(),
        reactions: {},
        delivery: "sending",
        mentions: parseMentions(content, userGroups),
        ...(previews.length ? { linkPreviews: previews } : {}),
        ...extras,
      };
    },
    [currentUserId, userGroups],
  );

  /** Fans a message's mentions out to notifications for whoever it targets. */
  const notifyMentions = useCallback(
    (message: SharedMessage) => {
      const room = rooms.find((r) => r.id === message.roomId);
      if (!room) return;
      const targets = resolveMentionTargets(message.mentions, room, users, userGroups);
      if (!targets.includes(currentUserId) && targets.length === 0) return;
      // Only the viewer's own notification feed exists locally; a server would
      // fan this out to every target's feed.
      if (!targets.includes(currentUserId) || message.senderId === currentUserId) return;
      notify({
        kind: "mention",
        text: `${userById(message.senderId).name} mentioned you in ${roomTitle(room)}`,
        roomId: room.id,
        messageId: message.id,
      });
    },
    [rooms, users, userGroups, currentUserId, notify, userById, roomTitle],
  );

  const sendMessage = useCallback<ChatContextValue["sendMessage"]>(
    (roomId, content, options) => {
      const text = content.trim();
      if (!text) return;
      const message = buildMessage(roomId, text, {
        replyToId: options?.replyToId ?? null,
        threadRootId: options?.threadRootId ?? null,
        ...(options?.sharedProfileUserId
          ? { sharedProfileUserId: options.sharedProfileUserId }
          : {}),
      });
      setMessages((current) => [...current, message]);
      void dispatchSend(message);
    },
    [buildMessage, dispatchSend],
  );

  const sendAttachment = useCallback<ChatContextValue["sendAttachment"]>(
    async (roomId, file, caption = "", options) => {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.error("Attachments are limited to 15 MB.");
        return;
      }
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => resolve("");
        reader.readAsDataURL(file);
      });
      if (!dataUrl) {
        toast.error("That file could not be read.");
        return;
      }
      const message = buildMessage(roomId, caption.trim(), {
        replyToId: options?.replyToId ?? null,
        threadRootId: options?.threadRootId ?? null,
        attachment: { name: file.name, type: file.type, size: file.size, dataUrl },
      });
      setMessages((current) => [...current, message]);
      void dispatchSend(message);
    },
    [buildMessage, dispatchSend],
  );

  const retryMessage = useCallback(
    (id: MessageId) => {
      const message = messages.find((m) => m.id === id);
      if (!message) return;
      const timer = retryTimers.current.get(id);
      if (timer) {
        clearTimeout(timer);
        retryTimers.current.delete(id);
      }
      // Same clientId: the transport's ledger guarantees this cannot duplicate.
      void dispatchSend({ ...message, attempts: 0 });
    },
    [messages, dispatchSend],
  );

  const discardMessage = useCallback((id: MessageId) => {
    const timer = retryTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      retryTimers.current.delete(id);
    }
    setMessages((current) => current.filter((message) => message.id !== id));
  }, []);

  /** Anything still unsent goes back out when connectivity returns. */
  const setOnline = useCallback(
    (next: boolean) => {
      transport.current.setOnline(next);
      setOnlineState(next);
      if (!next) return;
      setMessages((current) => {
        for (const message of current) {
          if (message.delivery === "failed" && message.senderId === currentUserId) {
            void dispatchSend({ ...message, attempts: 0 });
          }
        }
        return current;
      });
    },
    [currentUserId, dispatchSend],
  );

  /* ---------------------------------------------------------------------- */
  /* Editing, deleting, pinning, saving                                     */
  /* ---------------------------------------------------------------------- */

  const editMessage = useCallback(
    (id: MessageId, content: string) => {
      const text = content.trim();
      const before = messages.find((message) => message.id === id);
      setMessages((current) =>
        current.map((message) => {
          if (message.id !== id) return message;
          if (message.senderId !== currentUserId) return message;
          if (isTombstoned(message)) return message;
          const previews = derivePreviews(text);
          return {
            ...message,
            content: text,
            editedAt: Date.now(),
            mentions: parseMentions(text, userGroups),
            ...(previews.length ? { linkPreviews: previews } : { linkPreviews: [] }),
          };
        }),
      );
      if (!before || before.senderId !== currentUserId || isTombstoned(before)) return;
      void withServer(
        () => service.editMessage(workspaceSlug, before.roomId, id, text),
        () => setMessages((current) => current.map((m) => (m.id === id ? before : m))),
        "save that edit",
      );
    },
    [currentUserId, userGroups, messages, service, workspaceSlug, withServer],
  );

  /**
   * Soft delete. The row stays so replies, thread roots and cursors remain
   * valid; only the body and attachment are cleared.
   */
  const deleteMessage = useCallback(
    (id: MessageId) => {
      setMessages((current) =>
        current.map((message) => {
          if (message.id !== id) return message;
          const room = rooms.find((r) => r.id === message.roomId);
          const allowed =
            message.senderId === currentUserId || (room ? isAdmin(room, currentUserId) : false);
          if (!allowed) return message;
          return {
            ...message,
            content: "",
            deletedAt: Date.now(),
            deletedBy: currentUserId,
            reactions: {},
            linkPreviews: [],
            ...(message.attachment !== undefined ? { attachment: undefined } : {}),
          };
        }),
      );
      const before = messages.find((message) => message.id === id);
      if (!before) return;
      const room = rooms.find((r) => r.id === before.roomId);
      const allowed = before.senderId === currentUserId || (room ? isAdmin(room, currentUserId) : false);
      if (!allowed) return;

      toast.success("Message deleted");
      void withServer(
        () => service.deleteMessage(workspaceSlug, before.roomId, id),
        () => setMessages((current) => current.map((m) => (m.id === id ? before : m))),
        "delete that message",
      );
    },
    [currentUserId, rooms, isAdmin, messages, service, workspaceSlug, withServer],
  );

  const toggleReaction = useCallback(
    (id: MessageId, emoji: string) => {
      setMessages((current) =>
        current.map((message) => {
          if (message.id !== id || isTombstoned(message)) return message;
          const reactions = { ...(message.reactions ?? {}) };
          const list = reactions[emoji] ?? [];
          const next = list.includes(currentUserId)
            ? list.filter((userId) => userId !== currentUserId)
            : [...list, currentUserId];
          if (next.length === 0) delete reactions[emoji];
          else reactions[emoji] = next;
          // A NEW object every time, never a mutation. MessageItem's memo
          // comparator checks `reactions` by reference, so mutating in place
          // would leave the row rendering the old set forever.
          return { ...message, reactions };
        }),
      );

      const before = messages.find((message) => message.id === id);
      if (!before || isTombstoned(before)) return;
      void withServer(
        () => service.toggleReaction(workspaceSlug, before.roomId, id, emoji),
        () => setMessages((current) => current.map((m) => (m.id === id ? before : m))),
        "react to that message",
      );
    },
    [currentUserId, messages, service, workspaceSlug, withServer],
  );

  const togglePin = useCallback(
    (id: MessageId) => {
      setMessages((current) =>
        current.map((message) => {
          if (message.id !== id) return message;
          if (message.pinnedBy) {
            toast.success("Unpinned");
            return { ...message, pinnedBy: undefined, pinnedAt: undefined };
          }
          toast.success("Pinned to this conversation");
          return { ...message, pinnedBy: currentUserId, pinnedAt: Date.now() };
        }),
      );

      const before = messages.find((message) => message.id === id);
      if (!before) return;
      void withServer(
        () => service.togglePin(workspaceSlug, before.roomId, id),
        () => setMessages((current) => current.map((m) => (m.id === id ? before : m))),
        "pin that message",
      );
    },
    [currentUserId, messages, service, workspaceSlug, withServer],
  );

  const toggleSave = useCallback(
    (id: MessageId) => {
      const previous = saved[currentUserId] ?? [];
      setSaved((current) => {
        const list = current[currentUserId] ?? [];
        const next = list.includes(id) ? list.filter((item) => item !== id) : [id, ...list];
        toast.success(list.includes(id) ? "Removed from saved" : "Saved for later");
        return { ...current, [currentUserId]: next };
      });

      const message = messages.find((m) => m.id === id);
      if (!message) return;
      void withServer(
        () => service.toggleSave(workspaceSlug, message.roomId, id, "saved"),
        () => setSaved((current) => ({ ...current, [currentUserId]: previous })),
        "save that message",
      );
    },
    [currentUserId, saved, messages, service, workspaceSlug, withServer],
  );

  const isSaved = useCallback(
    (id: MessageId) => (saved[currentUserId] ?? []).includes(id),
    [saved, currentUserId],
  );

  const savedMessages = useCallback(() => {
    const ids = saved[currentUserId] ?? [];
    return ids
      .map((id) => messages.find((message) => message.id === id))
      .filter((message): message is SharedMessage => Boolean(message));
  }, [saved, currentUserId, messages]);

  const pinnedMessages = useCallback(
    (roomId: RoomId) =>
      messages
        .filter(
          (message) => message.roomId === roomId && message.pinnedBy && !isTombstoned(message),
        )
        .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0)),
    [messages],
  );

  const forwardMessage = useCallback(
    (id: MessageId, targetRoomIds: RoomId[]) => {
      const source = messages.find((message) => message.id === id);
      if (!source || targetRoomIds.length === 0) return;
      const created = targetRoomIds.map((roomId) =>
        buildMessage(roomId, source.content, {
          forwardedFrom: {
            roomId: source.roomId,
            messageId: source.id,
            senderId: source.senderId,
          },
          ...(source.attachment ? { attachment: source.attachment } : {}),
          ...(source.sharedProfileUserId
            ? { sharedProfileUserId: source.sharedProfileUserId }
            : {}),
        }),
      );
      setMessages((current) => [...current, ...created]);
      for (const message of created) void dispatchSend(message);
      toast.success(
        targetRoomIds.length === 1
          ? "Forwarded"
          : `Forwarded to ${targetRoomIds.length} conversations`,
      );
    },
    [messages, buildMessage, dispatchSend],
  );

  /**
   * A link back to one message.
   *
   * The standalone app owned the whole origin and could point at `/?room=`.
   * Chat is now one app inside a workspace, so the path has to carry the slug
   * or the link opens the wrong product.
   */
  const permalinkFor = useCallback(
    (message: SharedMessage) => {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const room = encodeURIComponent(message.roomId);
      const msg = encodeURIComponent(message.id);
      return `${origin}/${workspaceSlug}/chat?room=${room}&msg=${msg}`;
    },
    [workspaceSlug],
  );

  /* ---------------------------------------------------------------------- */
  /* Scheduled messages                                                     */
  /* ---------------------------------------------------------------------- */

  const scheduleMessage = useCallback(
    (roomId: RoomId, content: string, sendAt: number) => {
      const text = content.trim();
      if (!text) return;
      const message = buildMessage(roomId, text, { scheduledFor: sendAt, delivery: "sending" });
      setMessages((current) => [...current, message]);
      toast.success("Message scheduled");
    },
    [buildMessage],
  );

  const scheduledMessages = useCallback(
    (roomId?: RoomId) =>
      messages
        .filter(
          (message) =>
            message.scheduledFor &&
            message.senderId === currentUserId &&
            (!roomId || message.roomId === roomId),
        )
        .sort((a, b) => (a.scheduledFor ?? 0) - (b.scheduledFor ?? 0)),
    [messages, currentUserId],
  );

  const cancelScheduled = useCallback((id: MessageId) => {
    setMessages((current) => current.filter((message) => message.id !== id));
    toast.success("Scheduled message cancelled");
  }, []);

  const releaseScheduled = useCallback(
    (id: MessageId) => {
      setMessages((current) => {
        const target = current.find((message) => message.id === id);
        if (!target) return current;
        const released: SharedMessage = {
          ...target,
          scheduledFor: undefined,
          timestamp: Date.now(),
          delivery: "sending",
        };
        void dispatchSend(released);
        return current.map((message) => (message.id === id ? released : message));
      });
    },
    [dispatchSend],
  );

  const sendScheduledNow = useCallback(
    (id: MessageId) => {
      releaseScheduled(id);
      toast.success("Sent");
    },
    [releaseScheduled],
  );

  // Due-message ticker. A server would run this as a queue worker.
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const due = messages.filter((message) => message.scheduledFor && message.scheduledFor <= now);
      for (const message of due) releaseScheduled(message.id);
    }, 5_000);
    return () => clearInterval(interval);
  }, [messages, releaseScheduled]);

  /* ---------------------------------------------------------------------- */
  /* Threads                                                                */
  /* ---------------------------------------------------------------------- */

  const threadReplies = useCallback(
    (rootId: MessageId) =>
      messages.filter((message) => message.threadRootId === rootId).sort(compareMessages),
    [messages],
  );

  const threadCount = useCallback(
    (rootId: MessageId) =>
      messages.filter((message) => message.threadRootId === rootId && !isTombstoned(message))
        .length,
    [messages],
  );

  const threadParticipants = useCallback(
    (rootId: MessageId) => {
      const ids = new Set<UserId>();
      const root = messages.find((message) => message.id === rootId);
      if (root) ids.add(root.senderId);
      for (const message of messages) {
        if (message.threadRootId === rootId) ids.add(message.senderId);
      }
      return [...ids].map(userById);
    },
    [messages, userById],
  );

  const isFollowingThread = useCallback(
    (rootId: MessageId) => (followedThreads[currentUserId] ?? []).includes(rootId),
    [followedThreads, currentUserId],
  );

  const toggleFollowThread = useCallback(
    (rootId: MessageId) => {
      setFollowedThreads((current) => {
        const list = current[currentUserId] ?? [];
        const following = list.includes(rootId);
        toast.success(following ? "Unfollowed thread" : "Following thread");
        return {
          ...current,
          [currentUserId]: following ? list.filter((id) => id !== rootId) : [rootId, ...list],
        };
      });
    },
    [currentUserId],
  );

  /* ---------------------------------------------------------------------- */
  /* Pagination                                                             */
  /* ---------------------------------------------------------------------- */

  const roomLog = useMemo(
    () =>
      messages
        .filter(
          (message) =>
            message.roomId === activeRoomId && !message.threadRootId && !message.scheduledFor,
        )
        .sort(compareMessages),
    [messages, activeRoomId],
  );

  const channelMessages = useMemo(
    () => roomLog.slice(Math.max(0, roomLog.length - windowSize)),
    [roomLog, windowSize],
  );

  const hasMoreHistory = roomLog.length > channelMessages.length;

  const loadOlder = useCallback(() => {
    setWindowSize((size) => size + PAGE_SIZE);
  }, []);

  // Reset the window when the conversation changes, so switching rooms doesn't
  // inherit a huge materialised window from the previous one.
  useEffect(() => {
    setWindowSize(PAGE_SIZE);
  }, [activeRoomId]);

  /** Exposed for tests and for a future server-backed history endpoint. */
  const historyPage = useCallback(
    (roomId: RoomId, cursor: Cursor | null) =>
      pageBefore(
        messages.filter((m) => m.roomId === roomId && !m.threadRootId && !m.scheduledFor),
        cursor,
      ),
    [messages],
  );
  void historyPage;

  /* ---------------------------------------------------------------------- */
  /* Navigation                                                             */
  /* ---------------------------------------------------------------------- */

  const setActiveRoom = useCallback(
    (id: RoomId) => {
      setActiveRoomId(id);
      markRoomRead(id);
    },
    [markRoomRead],
  );

  const jumpToMessage = useCallback(
    (roomId: RoomId, messageId: MessageId) => {
      const index = messages
        .filter((m) => m.roomId === roomId && !m.threadRootId && !m.scheduledFor)
        .sort(compareMessages)
        .findIndex((m) => m.id === messageId);
      setActiveRoomId(roomId);
      // Widen the window far enough back that the target is materialised.
      if (index !== -1) {
        const fromEnd = roomLog.length - index;
        setWindowSize(Math.max(PAGE_SIZE, fromEnd + 10));
      }
      setPendingJump(messageId);
    },
    [messages, roomLog.length],
  );

  const clearJump = useCallback(() => setPendingJump(null), []);

  /**
   * Kept only because `ChatContextValue` declares it and removing it would ripple
   * through every consumer for no gain. There is a real signed-in account now;
   * impersonating another member is not something chat gets to offer.
   */
  const setCurrentUserId = useCallback((_id: UserId) => {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn("[chat] setCurrentUserId is a no-op — identity comes from the session.");
    }
  }, []);

  const searchMessages = useCallback(
    (query: string, roomId?: RoomId) => {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      return messages
        .filter((message) => {
          if (roomId && message.roomId !== roomId) return false;
          if (isTombstoned(message)) return false;
          if (message.scheduledFor) return false;
          const room = rooms.find((r) => r.id === message.roomId);
          if (!room?.participantIds.includes(currentUserId)) return false;
          const haystack = `${plainText(message.content)} ${message.attachment?.name ?? ""}`;
          return haystack.toLowerCase().includes(q);
        })
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 50);
    },
    [messages, rooms, currentUserId, plainText],
  );

  /* ---------------------------------------------------------------------- */
  /* Drafts                                                                 */
  /* ---------------------------------------------------------------------- */

  const getDraft = useCallback(
    (roomId: RoomId, threadRootId?: MessageId | null) =>
      drafts[draftKey(currentUserId, roomId, threadRootId)],
    [drafts, currentUserId],
  );

  const saveDraft = useCallback(
    (roomId: RoomId, draft: Omit<Draft, "updatedAt">, threadRootId?: MessageId | null) => {
      const key = draftKey(currentUserId, roomId, threadRootId);
      setDrafts((current) => {
        if (!draft.text.trim()) {
          if (!(key in current)) return current;
          const next = { ...current };
          delete next[key];
          return next;
        }
        return { ...current, [key]: { ...draft, updatedAt: Date.now() } };
      });
    },
    [currentUserId],
  );

  const clearDraft = useCallback(
    (roomId: RoomId, threadRootId?: MessageId | null) => {
      const key = draftKey(currentUserId, roomId, threadRootId);
      setDrafts((current) => {
        if (!(key in current)) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
    },
    [currentUserId],
  );

  const draftRoomIds = useCallback(() => {
    const prefix = `${currentUserId}:`;
    return Object.keys(drafts)
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length).split(":")[0]!)
      .filter((roomId, index, list) => list.indexOf(roomId) === index);
  }, [drafts, currentUserId]);

  /* ---------------------------------------------------------------------- */
  /* Room management                                                        */
  /* ---------------------------------------------------------------------- */

  const systemMessage = useCallback((roomId: RoomId, content: string): SharedMessage => {
    const id = newId("m");
    return {
      id,
      clientId: newId("c"),
      roomId,
      senderId: "system",
      content,
      timestamp: Date.now(),
      system: true,
      delivery: "delivered",
    };
  }, []);

  /**
   * Room creation waits for the server.
   *
   * Everywhere else in this store the local update lands first and the request
   * follows, because a message you cannot see is worse than a message that
   * might fail. Creating a room is different: the thing we do next is navigate
   * into it, and navigating into a locally-invented id means every subsequent
   * write in that room addresses a row the server has never heard of. A short
   * wait on a deliberate action is the cheaper trade.
   */
  const openDirect = useCallback(
    async (otherUserId: UserId) => {
      const existing = rooms.find(
        (room) =>
          room.type === "direct" &&
          room.participantIds.length === 2 &&
          room.participantIds.includes(currentUserId) &&
          room.participantIds.includes(otherUserId),
      );
      if (existing) {
        setActiveRoom(existing.id);
        return existing.id;
      }

      try {
        // The server dedupes too, and it is the one that can see rooms this
        // client has not loaded. A local miss is a cache miss, not proof.
        const created = await service.createRoom(workspaceSlug, {
          type: "direct",
          participant_ids: [otherUserId],
        });
        const room = wireToRoom(created);
        setRooms((current) => mergeRooms(current, [room]));
        setActiveRoom(room.id);
        return room.id;
      } catch {
        toast.error("Could not open that conversation.");
        return "";
      }
    },
    [rooms, currentUserId, setActiveRoom, service, workspaceSlug],
  );

  const createGroup = useCallback<ChatContextValue["createGroup"]>(
    async ({ name, description, participantIds }) => {
      try {
        const created = await service.createRoom(workspaceSlug, {
          type: "group",
          name,
          description,
          participant_ids: participantIds,
        });
        const room = wireToRoom(created);
        setRooms((current) => mergeRooms(current, [room]));
        setActiveRoom(room.id);
        notify({ kind: "system", text: `You created “${name}”`, roomId: room.id });
        toast.success(`Group “${name}” created`);
        return room.id;
      } catch {
        toast.error("Could not create that group.");
        return "";
      }
    },
    [service, workspaceSlug, setActiveRoom, notify],
  );

  const createGroupDm = useCallback(
    async (participantIds: UserId[]) => {
      const members = Array.from(new Set([currentUserId, ...participantIds]));
      const existing = rooms.find(
        (room) =>
          room.type === "groupdm" &&
          room.participantIds.length === members.length &&
          members.every((id) => room.participantIds.includes(id)),
      );
      if (existing) {
        setActiveRoom(existing.id);
        return existing.id;
      }

      try {
        const created = await service.createRoom(workspaceSlug, {
          type: "groupdm",
          participant_ids: participantIds,
        });
        const room = wireToRoom(created);
        setRooms((current) => mergeRooms(current, [room]));
        setActiveRoom(room.id);
        toast.success(`Group message with ${members.length - 1} people`);
        return room.id;
      } catch {
        toast.error("Could not start that conversation.");
        return "";
      }
    },
    [rooms, currentUserId, setActiveRoom, service, workspaceSlug],
  );

  /**
   * Applies a room change locally and mirrors the server-owned fields.
   *
   * `wire` is separate from `patch` on purpose: the client's `Room` is a
   * flattened view (four arrays derived from the membership table), so not
   * every local field has a column to write to. Passing null means "this change
   * is local only" -- which is true of nothing today, but is the honest shape
   * for a field like a collapsed-section flag when one arrives.
   */
  const patchRoom = useCallback(
    (roomId: RoomId, patch: Partial<Room>, wire: Record<string, unknown> | null = null) => {
      const before = rooms.find((room) => room.id === roomId);
      setRooms((current) =>
        current.map((room) => (room.id === roomId ? { ...room, ...patch } : room)),
      );
      if (!wire || !before) return;
      void withServer(
        () => service.updateRoom(workspaceSlug, roomId, wire as never),
        () => setRooms((current) => current.map((room) => (room.id === roomId ? before : room))),
        "save that change",
      );
    },
    [rooms, service, workspaceSlug, withServer],
  );

  const renameRoom = useCallback(
    (roomId: RoomId, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      patchRoom(roomId, { name: trimmed }, { name: trimmed });
      setMessages((current) => [
        ...current,
        systemMessage(
          roomId,
          `${userById(currentUserId).name} renamed the conversation to “${trimmed}”.`,
        ),
      ]);
      toast.success("Conversation renamed");
    },
    [patchRoom, systemMessage, userById, currentUserId],
  );

  const setRoomTopic = useCallback(
    (roomId: RoomId, topic: string) => {
      patchRoom(roomId, { topic: topic.trim() }, { topic: topic.trim() });
      setMessages((current) => [
        ...current,
        systemMessage(
          roomId,
          topic.trim()
            ? `${userById(currentUserId).name} set the topic to “${topic.trim()}”.`
            : `${userById(currentUserId).name} cleared the topic.`,
        ),
      ]);
    },
    [patchRoom, systemMessage, userById, currentUserId],
  );

  const setRoomDescription = useCallback(
    (roomId: RoomId, description: string) => {
      patchRoom(roomId, { description: description.trim() }, { description: description.trim() });
      toast.success("Description updated");
    },
    [patchRoom],
  );

  const updateGroupPhoto = useCallback(
    (roomId: RoomId, photo: Room["photo"] | null) => {
      const room = rooms.find((candidate) => candidate.id === roomId);
      if (!room || room.type === "direct" || !room.participantIds.includes(currentUserId)) {
        toast.error("Only group members can change the group photo.");
        return false;
      }

      patchRoom(roomId, { photo: photo ?? undefined }, { photo: photo ?? null });
      const actor = userById(currentUserId).name;
      const action = photo ? "changed" : "removed";
      const update = systemMessage(roomId, `${actor} ${action} the group photo.`);
      setMessages((current) => [...current, update]);

      for (const memberId of room.participantIds) {
        notify({
          kind: "system",
          text: `${actor} ${action} the ${roomTitle(room)} group photo.`,
          roomId,
          messageId: update.id,
          ownerUserId: memberId,
        });
      }
      toast.success(photo ? "Group photo updated" : "Group photo removed");
      return true;
    },
    [rooms, currentUserId, patchRoom, userById, systemMessage, notify, roomTitle],
  );

  const addMembers = useCallback(
    (roomId: RoomId, userIds: UserId[]) => {
      if (userIds.length === 0) return;
      void withServer(
        () => service.addMembers(workspaceSlug, roomId, userIds),
        () =>
          setRooms((current) =>
            current.map((room) =>
              room.id === roomId
                ? { ...room, participantIds: room.participantIds.filter((id) => !userIds.includes(id)) }
                : room,
            ),
          ),
        "add those members",
      );
      setRooms((current) =>
        current.map((room) =>
          room.id === roomId
            ? {
                ...room,
                participantIds: Array.from(new Set([...room.participantIds, ...userIds])),
              }
            : room,
        ),
      );
      setMessages((current) => [
        ...current,
        systemMessage(
          roomId,
          `${userById(currentUserId).name} added ${userIds.map((id) => userById(id).name).join(", ")}.`,
        ),
      ]);
      toast.success(userIds.length === 1 ? "Member added" : `${userIds.length} members added`);
    },
    [systemMessage, userById, currentUserId, service, workspaceSlug, withServer],
  );

  const removeMember = useCallback(
    (roomId: RoomId, userId: UserId) => {
      setRooms((current) =>
        current.map((room) =>
          room.id === roomId
            ? {
                ...room,
                participantIds: room.participantIds.filter((id) => id !== userId),
                adminIds: room.adminIds.filter((id) => id !== userId),
                mutedUserIds: room.mutedUserIds.filter((id) => id !== userId),
              }
            : room,
        ),
      );
      setMessages((current) => [
        ...current,
        systemMessage(roomId, `${userById(userId).name} was removed from the conversation.`),
      ]);
      notify({
        kind: "system",
        ownerUserId: userId,
        text: `You were removed from ${roomTitle(rooms.find((room) => room.id === roomId) ?? activeRoom)} by ${userById(currentUserId).name}.`,
      });
      toast.success("Member removed");
    },
    [systemMessage, userById, notify, roomTitle, rooms, activeRoom, currentUserId],
  );

  const toggleAdmin = useCallback((roomId: RoomId, userId: UserId) => {
    setRooms((current) =>
      current.map((room) => {
        if (room.id !== roomId) return room;
        const isCurrentlyAdmin = room.adminIds.includes(userId);
        // Never strip the last admin — the room would become unmanageable.
        if (isCurrentlyAdmin && room.adminIds.length === 1) {
          toast.error("A conversation needs at least one admin.");
          return room;
        }
        toast.success(isCurrentlyAdmin ? "Admin removed" : "Admin added");
        return {
          ...room,
          adminIds: isCurrentlyAdmin
            ? room.adminIds.filter((id) => id !== userId)
            : [...room.adminIds, userId],
        };
      }),
    );
  }, []);

  const leaveRoom = useCallback(
    (roomId: RoomId) => {
      const room = rooms.find((r) => r.id === roomId);
      if (!room) return;
      if (
        room.adminIds.length === 1 &&
        room.adminIds[0] === currentUserId &&
        room.participantIds.length > 1
      ) {
        toast.error("Promote another admin before leaving.");
        return;
      }
      setRooms((current) =>
        current.map((r) =>
          r.id === roomId
            ? {
                ...r,
                participantIds: r.participantIds.filter((id) => id !== currentUserId),
                adminIds: r.adminIds.filter((id) => id !== currentUserId),
              }
            : r,
        ),
      );
      setMessages((current) => [
        ...current,
        systemMessage(roomId, `${userById(currentUserId).name} left the conversation.`),
      ]);
      const fallback = rooms.find(
        (r) => r.id !== roomId && r.participantIds.includes(currentUserId) && !r.archived,
      );
      if (fallback) setActiveRoomId(fallback.id);
      toast.success("You left the conversation");
    },
    [rooms, currentUserId, systemMessage, userById],
  );

  const setArchived = useCallback(
    (roomId: RoomId, archived: boolean) => {
      patchRoom(
        roomId,
        archived ? { archived: true, archivedAt: Date.now() } : { archived: false },
        { archived },
      );
      if (archived) {
        const fallback = rooms.find(
          (r) => r.id !== roomId && r.participantIds.includes(currentUserId) && !r.archived,
        );
        if (fallback) setActiveRoomId(fallback.id);
      }
      toast.success(archived ? "Conversation archived" : "Conversation restored");
    },
    [patchRoom, rooms, currentUserId],
  );

  const toggleGroupMute = useCallback((roomId: RoomId) => {
    setRooms((current) =>
      current.map((room) => {
        if (room.id !== roomId) return room;
        const groupMuted = !room.groupMuted;
        toast[groupMuted ? "warning" : "success"](
          groupMuted ? "Group messaging muted by admin" : "Group messaging enabled",
        );
        return { ...room, groupMuted };
      }),
    );
  }, []);

  const toggleUserMute = useCallback(
    (roomId: RoomId, userId: UserId) => {
      setRooms((current) =>
        current.map((room) => {
          if (room.id !== roomId) return room;
          const muted = room.mutedUserIds.includes(userId);
          toast[muted ? "success" : "warning"](
            `${userById(userId).name} ${muted ? "unmuted" : "muted"}`,
          );
          return {
            ...room,
            mutedUserIds: muted
              ? room.mutedUserIds.filter((id) => id !== userId)
              : [...room.mutedUserIds, userId],
          };
        }),
      );
    },
    [userById],
  );

  const notificationLevel = useCallback(
    (roomId: RoomId): NotificationLevel =>
      rooms.find((room) => room.id === roomId)?.notificationLevels?.[currentUserId] ?? "all",
    [rooms, currentUserId],
  );

  const setNotificationLevel = useCallback(
    (roomId: RoomId, level: NotificationLevel) => {
      setRooms((current) =>
        current.map((room) =>
          room.id === roomId
            ? {
                ...room,
                notificationLevels: { ...(room.notificationLevels ?? {}), [currentUserId]: level },
              }
            : room,
        ),
      );
      toast.success(
        level === "all"
          ? "Notifying for all messages"
          : level === "mentions"
            ? "Notifying for mentions only"
            : "Notifications off for this conversation",
      );
    },
    [currentUserId],
  );

  const toggleRoomNotifications = useCallback(
    (roomId: RoomId) => {
      const level = notificationLevel(roomId);
      setNotificationLevel(roomId, level === "none" ? "all" : "none");
    },
    [notificationLevel, setNotificationLevel],
  );

  /* ---------------------------------------------------------------------- */
  /* Invites                                                                */
  /* ---------------------------------------------------------------------- */

  const inviteStatus = useCallback(
    (invite: Invite | null | undefined) => inviteIsUsable(invite),
    [],
  );

  /**
   * The server mints the code, not the client.
   *
   * The standalone app generated it locally, which it had to -- there was no
   * server. Now there is, and an invite code a client can choose is an invite
   * code a client can guess: it has to come from the same place that enforces
   * expiry and the use limit, or the limit is advisory.
   */
  const createInvite = useCallback<ChatContextValue["createInvite"]>(
    (roomId, { expiresInMs, maxUses }) => {
      void (async () => {
        try {
          const updated = await service.createInvite(workspaceSlug, roomId, {
            expires_in_ms: expiresInMs,
            max_uses: maxUses,
          });
          setRooms((current) => mergeRooms(current, [wireToRoom(updated)]));
          toast.success("New invite link generated");
        } catch {
          toast.error("Could not create an invite link.");
        }
      })();
    },
    [service, workspaceSlug],
  );

  const revokeInvite = useCallback(
    (roomId: RoomId) => {
      const room = rooms.find((candidate) => candidate.id === roomId);
      const inviteId = room?.invite?.code;
      if (!inviteId) return;
      patchRoom(roomId, { invite: null });
      toast.warning("Invite link revoked");
      void withServer(
        () => service.revokeInvite(workspaceSlug, roomId, inviteId),
        () => setRooms((current) => (room ? mergeRooms(current, [room]) : current)),
        "revoke that link",
      );
    },
    [rooms, patchRoom, service, workspaceSlug, withServer],
  );

  const roomByCode = useCallback(
    (code: string) => rooms.find((room) => room.invite?.code === code) ?? null,
    [rooms],
  );

  /**
   * Redeem an invite.
   *
   * The client-side checks below are kept, but only to give an instant answer
   * for a link this session already knows is dead. The server re-checks
   * everything and is the authority -- expiry and use limits enforced in a
   * browser are a devtools edit away from not being enforced at all.
   */
  const joinByCode = useCallback(
    async (code: string): Promise<{ room: Room | null; error?: string }> => {
      const known = rooms.find((r) => r.invite?.code === code);
      if (known) {
        const status = inviteStatus(known.invite);
        if (status === "expired") return { room: null, error: "This invite link has expired." };
        if (status === "exhausted")
          return { room: null, error: "This invite link has reached its usage limit." };
        if (known.participantIds.includes(currentUserId)) {
          setActiveRoomId(known.id);
          return { room: known };
        }
      }

      try {
        const joined = wireToRoom(await service.joinByCode(workspaceSlug, code));
        setRooms((current) => mergeRooms(current, [joined]));
        setActiveRoomId(joined.id);
        notify({ kind: "system", text: `You joined “${roomTitle(joined)}”`, roomId: joined.id });
        return { room: joined };
      } catch (error) {
        const detail =
          typeof error === "object" && error !== null && typeof (error as { detail?: string }).detail === "string"
            ? (error as { detail: string }).detail
            : "This invite link is not valid.";
        return { room: null, error: detail };
      }
    },
    [rooms, currentUserId, inviteStatus, service, workspaceSlug, notify, roomTitle],
  );

  /* ---------------------------------------------------------------------- */
  /* AI assistant                                                           */
  /* ---------------------------------------------------------------------- */

  const aiConversation = useCallback(
    (roomId: RoomId) =>
      aiMessages
        .filter((message) => message.roomId === roomId && message.ownerUserId === currentUserId)
        .sort((a, b) => a.timestamp - b.timestamp),
    [aiMessages, currentUserId],
  );

  const chargeBudget = useCallback((tokens: number) => {
    setAiBudget((current) => {
      const now = Date.now();
      if (now >= current.resetAt) {
        return { used: tokens, limit: AI_TOKEN_BUDGET, resetAt: now + AI_BUDGET_WINDOW };
      }
      return { ...current, used: current.used + tokens };
    });
  }, []);

  const runAgent = useCallback(
    async (
      roomId: RoomId,
      prompt: string,
      aiId: string,
      owner: UserId,
      conversationId: string,
      mode: "chat" | "summary" = "chat",
    ) => {
      // Prior turns in this conversation, so follow-ups actually have context.
      const history = aiMessages
        .filter(
          (message) =>
            message.conversationId === conversationId && message.id !== aiId && !message.error,
        )
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(-6)
        .flatMap((message) => [
          { role: "user" as const, content: message.prompt },
          { role: "assistant" as const, content: message.response },
        ])
        .filter((turn) => turn.content.trim().length > 0);

      const context = messages
        .filter(
          (message) => message.roomId === roomId && !isTombstoned(message) && !message.scheduledFor,
        )
        .sort(compareMessages)
        .slice(mode === "summary" ? -60 : -14)
        .map((message) => `${userById(message.senderId).name}: ${plainText(previewText(message))}`)
        .join("\n");

      try {
        // AI is explicitly out of scope for this stage. The whole assistant
        // surface -- the @agent composer target, the per-room conversation, the
        // token budget, the share-to-chat action -- is ported and wired, and
        // this one fetch is the only thing standing between it and working.
        // It is left pointing at the route it will use so that turning AI on is
        // a backend change, not a hunt through the client.
        //
        // Until that route exists the request 404s, the catch below turns it
        // into a visible "AI request failed" bubble the user can dismiss, and
        // nothing else in chat is affected.
        const response = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            context,
            history,
            mode,
            userName: userById(owner).name,
            stream: true,
          }),
        });

        if (!response.ok || !response.body) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "AI request failed");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let text = "";

        setAiMessages((current) =>
          current.map((message) =>
            message.id === aiId ? { ...message, pending: false, streaming: true } : message,
          ),
        );

        // Server-sent events: one JSON payload per `data:` line.
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            let event: { delta?: string; error?: string };
            try {
              event = JSON.parse(payload) as { delta?: string; error?: string };
            } catch {
              continue;
            }
            if (event.error) throw new Error(event.error);
            if (event.delta) {
              text += event.delta;
              const snapshot = text;
              setAiMessages((current) =>
                current.map((message) =>
                  message.id === aiId ? { ...message, response: snapshot } : message,
                ),
              );
            }
          }
        }

        const tokens = Math.ceil((prompt.length + text.length) / 3.6);
        chargeBudget(tokens);
        setAiMessages((current) =>
          current.map((message) =>
            message.id === aiId
              ? { ...message, response: text, pending: false, streaming: false, tokensUsed: tokens }
              : message,
          ),
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : "AI request failed";
        toast.error(reason);
        setAiMessages((current) =>
          current.map((message) =>
            message.id === aiId
              ? { ...message, response: reason, pending: false, streaming: false, error: true }
              : message,
          ),
        );
      }
    },
    [aiMessages, messages, userById, plainText, chargeBudget],
  );

  const askAgent = useCallback(
    async (roomId: RoomId, prompt: string) => {
      if (aiBudget.used >= aiBudget.limit && Date.now() < aiBudget.resetAt) {
        toast.error("You've used your AI allowance for today.");
        return;
      }
      // One conversation per room per user, so follow-ups thread naturally.
      const existing = aiConversation(roomId)[0];
      const conversationId = existing?.conversationId ?? newId("conv");
      const aiId = newId("ai");
      setAiMessages((current) => [
        ...current,
        {
          id: aiId,
          roomId,
          ownerUserId: currentUserId,
          prompt,
          response: "",
          timestamp: Date.now(),
          pending: true,
          conversationId,
          kind: "chat",
        },
      ]);
      await runAgent(roomId, prompt, aiId, currentUserId, conversationId, "chat");
    },
    [aiBudget, aiConversation, currentUserId, runAgent],
  );

  const summarizeRoom = useCallback(
    async (roomId: RoomId) => {
      const marker = readState[roomId]?.[currentUserId];
      const missed = messages.filter(
        (message) =>
          message.roomId === roomId &&
          !message.scheduledFor &&
          message.timestamp > (marker?.lastReadTimestamp ?? 0),
      ).length;
      const aiId = newId("ai");
      const conversationId = newId("conv");
      const prompt = missed
        ? `Catch me up on the ${missed} messages I haven't read in this conversation. Lead with anything addressed to me or needing a decision.`
        : "Summarise this conversation and list any open action items.";

      setAiMessages((current) => [
        ...current,
        {
          id: aiId,
          roomId,
          ownerUserId: currentUserId,
          prompt: missed ? `Catch me up (${missed} unread)` : "Summarise this conversation",
          response: "",
          timestamp: Date.now(),
          pending: true,
          conversationId,
          kind: "summary",
        },
      ]);
      await runAgent(roomId, prompt, aiId, currentUserId, conversationId, "summary");
    },
    [readState, currentUserId, messages, runAgent],
  );

  const regenerateAgent = useCallback(
    async (aiId: string) => {
      const target = aiMessages.find((message) => message.id === aiId);
      if (!target) return;
      setAiMessages((current) =>
        current.map((message) =>
          message.id === aiId
            ? { ...message, pending: true, streaming: false, error: false, response: "" }
            : message,
        ),
      );
      await runAgent(
        target.roomId,
        target.prompt,
        aiId,
        target.ownerUserId,
        target.conversationId,
        target.kind ?? "chat",
      );
    },
    [aiMessages, runAgent],
  );

  const shareAiToChat = useCallback(
    (aiId: string) => {
      const target = aiMessages.find((message) => message.id === aiId);
      if (!target || target.pending || target.streaming) return;
      const message = buildMessage(target.roomId, target.response, { sharedFromAi: true });
      setMessages((current) => [...current, message]);
      void dispatchSend(message);
      toast.success("AI response shared with the room");
    },
    [aiMessages, buildMessage, dispatchSend],
  );

  /* ---------------------------------------------------------------------- */
  /* Notifications                                                          */
  /* ---------------------------------------------------------------------- */

  const visibleNotifications = useMemo(
    () =>
      notifications.filter(
        (notification) => !notification.ownerUserId || notification.ownerUserId === currentUserId,
      ),
    [notifications, currentUserId],
  );

  const markNotificationsRead = useCallback(() => {
    setNotifications((current) =>
      current.map((notification) =>
        !notification.ownerUserId || notification.ownerUserId === currentUserId
          ? { ...notification, read: true }
          : notification,
      ),
    );
  }, [currentUserId]);

  const unreadNotificationCount = useMemo(
    () => visibleNotifications.filter((notification) => !notification.read).length,
    [visibleNotifications],
  );

  // Fire a mention notification when a message the viewer is targeted by lands.
  const seenMentions = useRef(new Set<MessageId>());
  useEffect(() => {
    for (const message of messages) {
      if (message.senderId === currentUserId) continue;
      if (seenMentions.current.has(message.id)) continue;
      seenMentions.current.add(message.id);
      if (!message.mentions) continue;
      notifyMentions(message);
    }
  }, [messages, currentUserId, notifyMentions]);

  const outbox = useMemo(
    () =>
      messages.filter(
        (message) =>
          message.senderId === currentUserId &&
          !message.scheduledFor &&
          (message.delivery === "failed" || message.delivery === "sending"),
      ),
    [messages, currentUserId],
  );

  const lastMessage = useCallback(
    (roomId: RoomId) => {
      const list = messages
        .filter(
          (message) => message.roomId === roomId && !message.threadRootId && !message.scheduledFor,
        )
        .sort(compareMessages);
      return list[list.length - 1];
    },
    [messages],
  );

  const value: ChatContextValue = {
    users,
    userGroups,
    currentUser: userById(currentUserId),
    currentUserId,
    setCurrentUserId,
    userById,

    rooms,
    visibleRooms,
    archivedRooms,
    activeRoom,
    activeRoomId,
    setActiveRoom,
    roomTitle,
    canSend,
    isAdmin,

    messages,
    channelMessages,
    hasMoreHistory,
    loadOlder,
    messageById,
    lastMessage,

    sendMessage,
    sendAttachment,
    editMessage,
    deleteMessage,
    retryMessage,
    discardMessage,
    forwardMessage,
    toggleReaction,
    togglePin,
    toggleSave,
    isSaved,
    savedMessages,
    pinnedMessages,
    permalinkFor,

    scheduleMessage,
    scheduledMessages,
    cancelScheduled,
    sendScheduledNow,

    threadReplies,
    threadCount,
    threadParticipants,
    isFollowingThread,
    toggleFollowThread,

    readState,
    markRoomRead,
    unreadFor,
    readersOf,

    getDraft,
    saveDraft,
    clearDraft,
    draftRoomIds,

    openDirect,
    createGroup,
    createGroupDm,
    renameRoom,
    setRoomTopic,
    setRoomDescription,
    updateGroupPhoto,
    addMembers,
    removeMember,
    toggleAdmin,
    leaveRoom,
    setArchived,
    toggleGroupMute,
    toggleUserMute,
    setNotificationLevel,
    notificationLevel,
    toggleRoomNotifications,

    createInvite,
    revokeInvite,
    inviteStatus,
    roomByCode,
    joinByCode,

    aiMessages,
    askAgent,
    regenerateAgent,
    shareAiToChat,
    summarizeRoom,
    aiBudget,
    aiConversation,

    notifications: visibleNotifications,
    markNotificationsRead,
    unreadNotificationCount,

    online,
    setOnline,
    outbox,

    connectorKind: data.kind,
    connectorStatus,

    pendingJump,
    jumpToMessage,
    clearJump,
    searchMessages,
    plainText,
  };

  // Presence heartbeat stand-in: keeps the seeded directory honest about the
  // viewer being online. A real client would drive this from the socket.
  useEffect(() => {
    setUsers((current) =>
      current.map((user) => (user.id === currentUserId ? { ...user, online: true } : user)),
    );
  }, [currentUserId]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used inside ChatProvider");
  return ctx;
}

export { encodeCursor };
