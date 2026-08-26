/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Message delivery.
 *
 * The standalone app shipped a fake transport: `createLocalTransport` resolved
 * after a simulated latency, failed 4% of the time on purpose, and kept an
 * in-memory ledger keyed by `clientId` so a retry could not duplicate a row.
 * It was a stub, but it was a stub of the *right shape* -- the store's outbox,
 * exponential backoff and retry loop were all written against it and all of
 * them are real logic.
 *
 * So this file keeps the interface and replaces the implementation. The store
 * above it does not change: it still calls `send`, still gets a `SendAck`, still
 * retries on a `TransportError` whose `retriable` flag says it is worth it.
 *
 * The one change to the contract is that `SendEnvelope` now carries the whole
 * message. The fake server did not need the content -- it was never going to
 * store it. A real one does.
 */

import type { SharedMessage } from "../lib/chat-types";
import type { ChatService } from "../services/chat.service";
import { toIso } from "../services/wire";

export interface SendEnvelope {
  /** Idempotency key. The server treats (room, client_id) as unique. */
  clientId: string;
  roomId: string;
  senderId: string;
  /** The message to persist. Absent on a bare liveness probe. */
  message: SharedMessage;
}

export interface SendAck {
  clientId: string;
  /** The row's real id. The optimistic message adopts it. */
  serverId: string;
  /** The server's receive time -- the ordering authority, not the client clock. */
  timestamp: number;
  /** True when the server matched an existing row rather than creating one. */
  duplicate: boolean;
}

export class TransportError extends Error {
  constructor(
    message: string,
    readonly retriable: boolean
  ) {
    super(message);
    this.name = "TransportError";
  }
}

export interface Transport {
  send(envelope: SendEnvelope): Promise<SendAck>;
  isOnline(): boolean;
  setOnline(online: boolean): void;
}

/**
 * Exponential backoff with jitter, capped.
 *
 * Jitter is not decoration. Without it, every client that failed during the
 * same outage retries at the same instant and re-creates the outage; the
 * multiplier spreads them across the window.
 */
export function backoffDelay(attempt: number, base = 500, cap = 30_000): number {
  const exponential = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
  return Math.round(exponential * (0.5 + Math.random() * 0.5));
}

/**
 * Which failures are worth retrying.
 *
 * A 4xx means the request was wrong and will be wrong again -- retrying it
 * just burns the user's battery and fills the log. A 5xx, a timeout or a
 * dead network might succeed on the next attempt.
 *
 * A thrown value with no status at all is treated as retriable: axios surfaces
 * a genuine network failure that way, and the cost of one wasted retry is much
 * lower than the cost of silently dropping a message someone typed.
 */
function isRetriable(error: unknown): boolean {
  const status = (error as { status?: number; response?: { status?: number } } | null)?.status;
  if (typeof status !== "number") return true;
  return status >= 500 || status === 408 || status === 429;
}

function describe(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const detail = (error as { detail?: string; error?: string }).detail ?? (error as { error?: string }).error;
    if (typeof detail === "string" && detail) return detail;
  }
  if (error instanceof Error && error.message) return error.message;
  return "Send failed";
}

export function createApiTransport(service: ChatService, workspaceSlug: string): Transport {
  // Reflects the browser when the browser has an opinion, and is otherwise
  // driven by the store's manual offline toggle. Starting from
  // `navigator.onLine` matters: a message composed while offline should go
  // straight to the outbox rather than fail once first.
  let online = typeof navigator === "undefined" ? true : navigator.onLine;

  return {
    isOnline: () => online,
    setOnline: (next: boolean) => {
      online = next;
    },

    async send(envelope: SendEnvelope): Promise<SendAck> {
      if (!online) {
        throw new TransportError("You are offline. This will send when you reconnect.", true);
      }

      const { message } = envelope;

      try {
        const { message: saved, created } = await service.sendMessage(workspaceSlug, envelope.roomId, {
          client_id: envelope.clientId,
          content: message.content,
          reply_to: message.replyToId ?? null,
          thread_root: message.threadRootId ?? null,
          ...(message.attachment ? { attachment: message.attachment } : {}),
          ...(message.mentions ? { mentions: message.mentions } : {}),
          scheduled_for: toIso(message.scheduledFor ?? null),
          shared_profile_user: message.sharedProfileUserId ?? null,
          forwarded_from: message.forwardedFrom?.messageId ?? null,
        });

        return {
          clientId: envelope.clientId,
          serverId: saved.id,
          timestamp: Date.parse(saved.created_at) || Date.now(),
          // A repeated client_id is a successful outcome, not an error: the
          // server returns the row it already has. Reported so the store keeps
          // the timestamp it is already rendering.
          duplicate: !created,
        };
      } catch (error) {
        throw new TransportError(describe(error), isRetriable(error));
      }
    },
  };
}
