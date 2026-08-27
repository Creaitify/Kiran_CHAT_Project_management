/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * The chat HTTP client.
 *
 * Every method is one endpoint. There is no snapshot method and no `save(state)`
 * -- the Stage 1 connector had both, because chat's whole world was a
 * localStorage blob and the seam had to match what the store already did. This
 * is what replaces it: sending a message POSTs a message, and nothing else
 * moves.
 *
 * ---------------------------------------------------------------------------
 * Why this lives in the app and not in `packages/services`
 * ---------------------------------------------------------------------------
 * The convention in this repo is that services live in `@plane/services`, and
 * for anything shared across apps that is right. This one is used by exactly one
 * app, and putting it in the package would mean every change to a chat endpoint
 * requires rebuilding a workspace package before the dev server sees it. Keeping
 * it here also keeps the promise MODULES.md makes: an app is one directory.
 *
 * If a second app ever needs to read chat data, this file moves. Until then it
 * would be a shared abstraction with one consumer.
 */

import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";
import type {
  TWireMessage,
  TWirePage,
  TWireRoom,
  TWireRoomMember,
  TWireUpdates,
  TWireUserGroup,
} from "./wire";
import type { TChatOverview } from "./overview";

export type TCreateRoomPayload = {
  type: "group" | "direct" | "groupdm";
  name?: string;
  description?: string;
  participant_ids: string[];
};

export type TSendMessagePayload = {
  /**
   * Client-minted idempotency key. The server treats (room, client_id) as
   * unique and returns the existing row rather than erroring, which is what
   * makes a retry after a timeout safe: the request either created the message
   * or it did not, and either way the second attempt converges on one message.
   */
  client_id: string;
  content: string;
  reply_to?: string | null;
  thread_root?: string | null;
  attachment?: unknown;
  mentions?: unknown;
  scheduled_for?: string | null;
  shared_profile_user?: string | null;
  forwarded_from?: string | null;
};

export type TWireReference = {
  id: string;
  room_id: string;
  room_title: string;
  excerpt: string;
  author: string | null;
  created_at: string;
};

export type TUserGroupPayload = {
  handle: string;
  name: string;
  member_ids?: string[];
};

export class ChatService extends APIService {
  constructor(BASE_URL?: string) {
    super(BASE_URL || API_BASE_URL);
  }

  private root(workspaceSlug: string): string {
    return `/api/workspaces/${encodeURIComponent(workspaceSlug)}/chat`;
  }

  /* ------------------------------------------------------------- references */

  /**
   * Messages that link to somebody else's object.
   *
   * `kind` and `id` are opaque here and opaque on the server. Chat never learns
   * what a work item is; it searches its own message text for the URL the kind
   * implies. See `views/chat/reference.py`.
   */
  async fetchReferences(
    workspaceSlug: string,
    kind: string,
    id: string
  ): Promise<{ items: TWireReference[] }> {
    return this.get(`${this.root(workspaceSlug)}/references/`, { params: { kind, id } })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /* --------------------------------------------------------------- overview */

  /**
   * Chat, summarised for the shell.
   *
   * Deliberately not `listRooms`. That returns whole rooms -- members, last
   * message, its reactions -- because the conversation list renders all of it.
   * The rail badge wants a number and the palette wants titles, and polling the
   * expensive one on every page in the product to get them would be the worst
   * request in the shell.
   */
  async fetchOverview(workspaceSlug: string): Promise<TChatOverview> {
    return this.get(`${this.root(workspaceSlug)}/overview/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /* ----------------------------------------------------------- mention groups */

  async listUserGroups(workspaceSlug: string): Promise<TWireUserGroup[]> {
    return this.get(`${this.root(workspaceSlug)}/groups/`)
      .then((response) => {
        const d = response?.data;
        return Array.isArray(d) ? d : (d?.results ?? []);
      })
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * `member_ids` is the whole membership, not a delta. A mention group is
   * edited as one decision -- "who is on-call this week" -- and sending the set
   * is what makes that decision atomic. Omitting the field on an update leaves
   * the membership alone; sending `[]` empties it.
   */
  async createUserGroup(workspaceSlug: string, data: TUserGroupPayload): Promise<TWireUserGroup> {
    return this.post(`${this.root(workspaceSlug)}/groups/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateUserGroup(
    workspaceSlug: string,
    groupId: string,
    data: Partial<TUserGroupPayload>
  ): Promise<TWireUserGroup> {
    return this.patch(`${this.root(workspaceSlug)}/groups/${groupId}/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deleteUserGroup(workspaceSlug: string, groupId: string): Promise<void> {
    return this.delete(`${this.root(workspaceSlug)}/groups/${groupId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /* ------------------------------------------------------------------ agent */

  /**
   * The AI endpoint, as a URL rather than a request.
   *
   * Every other method here goes through axios. This one cannot: the response is
   * an SSE stream and axios in a browser has no way to read a body as it
   * arrives -- `responseType: "stream"` is Node-only, and the XHR adapter
   * resolves once, at the end. The caller uses `fetch`, which gives it a
   * `ReadableStream`, and needs the absolute URL because `fetch` has no notion
   * of the instance's `baseURL`.
   *
   * `credentials: "include"` is the caller's responsibility for the same reason:
   * it is what `withCredentials` does for the axios instance, and without it the
   * session cookie is not sent and the endpoint answers 401.
   */
  agentUrl(workspaceSlug: string): string {
    return `${this.baseURL}${this.root(workspaceSlug)}/agent/`;
  }

  /* ------------------------------------------------------------------ rooms */

  async listRooms(workspaceSlug: string): Promise<TWireRoom[]> {
    return this.get(`${this.root(workspaceSlug)}/rooms/`)
      .then((response) => {
        const d = response?.data;
        return Array.isArray(d) ? d : (d?.results ?? []);
      })
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async createRoom(workspaceSlug: string, data: TCreateRoomPayload): Promise<TWireRoom> {
    return this.post(`${this.root(workspaceSlug)}/rooms/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateRoom(workspaceSlug: string, roomId: string, data: Partial<TWireRoom>): Promise<TWireRoom> {
    return this.patch(`${this.root(workspaceSlug)}/rooms/${roomId}/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deleteRoom(workspaceSlug: string, roomId: string): Promise<void> {
    return this.delete(`${this.root(workspaceSlug)}/rooms/${roomId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /* --------------------------------------------------------------- messages */

  /**
   * One page of history, newest first.
   *
   * `cursor` is opaque to the caller and is whatever `next_cursor` the previous
   * page returned. Omitting `threadRoot` returns channel messages only --
   * thread replies are deliberately absent from the channel view, and asking
   * for them is a separate request.
   */
  async listMessages(
    workspaceSlug: string,
    roomId: string,
    params: { cursor?: string | null; limit?: number; threadRoot?: string | null } = {}
  ): Promise<TWirePage<TWireMessage>> {
    return this.get(`${this.root(workspaceSlug)}/rooms/${roomId}/messages/`, {
      params: {
        ...(params.cursor ? { cursor: params.cursor } : {}),
        ...(params.limit ? { limit: params.limit } : {}),
        ...(params.threadRoot ? { thread_root: params.threadRoot } : {}),
      },
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Sends a message and reports whether the server created it.
   *
   * The status code is the answer: 201 means this request created the row, 200
   * means the server matched an existing (room, client_id) and returned it
   * unchanged. The caller needs to know, because a matched row already has a
   * server timestamp and adopting a second one would jump the message to a new
   * position in a list someone is looking at.
   *
   * There is no way to infer this from the body -- which is exactly why it is
   * returned separately rather than guessed at.
   */
  async sendMessage(
    workspaceSlug: string,
    roomId: string,
    data: TSendMessagePayload
  ): Promise<{ message: TWireMessage; created: boolean }> {
    return this.post(`${this.root(workspaceSlug)}/rooms/${roomId}/messages/`, data)
      .then((response) => ({ message: response?.data, created: response?.status === 201 }))
      .catch((error) => {
        throw error?.response?.data ?? error;
      });
  }

  async editMessage(
    workspaceSlug: string,
    roomId: string,
    messageId: string,
    content: string
  ): Promise<TWireMessage> {
    return this.patch(`${this.root(workspaceSlug)}/rooms/${roomId}/messages/${messageId}/`, { content })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Tombstones rather than removes; the server returns the surviving row. */
  async deleteMessage(workspaceSlug: string, roomId: string, messageId: string): Promise<TWireMessage> {
    return this.delete(`${this.root(workspaceSlug)}/rooms/${roomId}/messages/${messageId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /* -------------------------------------------------- message-level actions */

  async toggleReaction(
    workspaceSlug: string,
    roomId: string,
    messageId: string,
    emoji: string
  ): Promise<TWireMessage> {
    return this.post(`${this.root(workspaceSlug)}/rooms/${roomId}/messages/${messageId}/reactions/`, { emoji })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Release a queued message ahead of its send time.
   *
   * Not a PATCH clearing `scheduled_for`: the server keeps that column
   * read-only, because the only legal edit to it is this one and a writable
   * column would also allow rescheduling into the past.
   */
  async sendScheduledNow(workspaceSlug: string, roomId: string, messageId: string): Promise<TWireMessage> {
    return this.post(`${this.root(workspaceSlug)}/rooms/${roomId}/messages/${messageId}/send-now/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async togglePin(workspaceSlug: string, roomId: string, messageId: string): Promise<TWireMessage> {
    return this.post(`${this.root(workspaceSlug)}/rooms/${roomId}/messages/${messageId}/pin/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async toggleSave(
    workspaceSlug: string,
    roomId: string,
    messageId: string,
    kind: "saved" | "followed_thread" = "saved"
  ): Promise<{ saved: boolean }> {
    return this.post(`${this.root(workspaceSlug)}/rooms/${roomId}/messages/${messageId}/save/`, { kind })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async forwardMessage(
    workspaceSlug: string,
    roomId: string,
    messageId: string,
    targetRoomIds: string[]
  ): Promise<TWireMessage[]> {
    return this.post(`${this.root(workspaceSlug)}/rooms/${roomId}/messages/${messageId}/forward/`, {
      target_room_ids: targetRoomIds,
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /* ---------------------------------------------------------------- members */

  async listMembers(workspaceSlug: string, roomId: string): Promise<TWireRoomMember[]> {
    return this.get(`${this.root(workspaceSlug)}/rooms/${roomId}/members/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async addMembers(workspaceSlug: string, roomId: string, memberIds: string[]): Promise<TWireRoomMember[]> {
    return this.post(`${this.root(workspaceSlug)}/rooms/${roomId}/members/`, { member_ids: memberIds })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateMember(
    workspaceSlug: string,
    roomId: string,
    membershipId: string,
    data: { role?: number; notification_level?: string; is_muted?: boolean }
  ): Promise<TWireRoomMember> {
    return this.patch(`${this.root(workspaceSlug)}/rooms/${roomId}/members/${membershipId}/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async removeMember(workspaceSlug: string, roomId: string, membershipId: string): Promise<void> {
    return this.delete(`${this.root(workspaceSlug)}/rooms/${roomId}/members/${membershipId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /* ------------------------------------------------------------- read state */

  /** Advances the caller's marker. The server refuses to move it backwards. */
  async markRead(workspaceSlug: string, roomId: string, messageId?: string): Promise<TWireRoomMember> {
    return this.post(`${this.root(workspaceSlug)}/rooms/${roomId}/read/`, messageId ? { message_id: messageId } : {})
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /* ---------------------------------------------------------------- invites */

  async createInvite(
    workspaceSlug: string,
    roomId: string,
    options: { expires_in_ms?: number | null; max_uses?: number | null }
  ): Promise<TWireRoom> {
    return this.post(`${this.root(workspaceSlug)}/rooms/${roomId}/invites/`, options)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async revokeInvite(workspaceSlug: string, roomId: string, inviteId: string): Promise<void> {
    return this.delete(`${this.root(workspaceSlug)}/rooms/${roomId}/invites/${inviteId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async joinByCode(workspaceSlug: string, code: string): Promise<TWireRoom> {
    return this.post(`${this.root(workspaceSlug)}/invites/${encodeURIComponent(code)}/join/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /* --------------------------------------------------------------- realtime */

  /**
   * Everything that changed since `since`, across all the caller's rooms.
   *
   * This is the entire real-time transport. It is a poll, not a stream, for
   * three reasons that only became clear after reading the deployment:
   *
   *   - Locally the API runs `manage.py runserver`, which is thread-per-request
   *     and would happily hold an SSE connection open. In production it runs
   *     gunicorn with UvicornWorker, where Django executes sync views with
   *     `thread_sensitive=True` -- every sync request on a worker shares one
   *     executor thread, so one blocking SSE generator stalls the worker. An
   *     SSE endpoint would therefore work in the demo and fail in production,
   *     which is the worst of the available failure modes.
   *   - `GZipMiddleware` is in the global middleware chain and buffers
   *     streaming bodies, so events would arrive in clumps regardless.
   *   - `apps/live`, the websocket service that would otherwise carry this,
   *     hangs during Redis init and has never bound its port.
   *
   * Polling an indexed query every few seconds is the honest option here.
   *
   * Pass back the `server_time` from the previous response rather than a local
   * clock reading. Client and server clocks disagree, and a client that is
   * thirty seconds fast will silently skip thirty seconds of other people's
   * messages -- a bug that only appears on someone else's laptop.
   */
  async fetchUpdates(workspaceSlug: string, since: string): Promise<TWireUpdates> {
    return this.get(`${this.root(workspaceSlug)}/updates/`, { params: { since } })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
