/**
 * Message transport.
 *
 * This is the seam where a real API client (HTTP + WebSocket) will go. The
 * local implementation simulates a network — latency, intermittent failure,
 * an offline switch — so that delivery states, the retry queue and idempotency
 * are genuine mechanics rather than cosmetic labels. Swapping this file for a
 * `fetch`/socket implementation should not require any change in the store or
 * the UI, because the contract below is what a server would expose anyway.
 */

export interface SendEnvelope {
  /** Idempotency key. Re-sending the same key must never create a second row. */
  clientId: string;
  roomId: string;
  senderId: string;
}

export interface SendAck {
  clientId: string;
  /** Server-assigned id. The local transport echoes a derived id. */
  serverId: string;
  /** Server receive time; the authority for ordering. */
  timestamp: number;
  /** True when the server had already stored this clientId. */
  duplicate: boolean;
}

export class TransportError extends Error {
  constructor(
    message: string,
    readonly retriable: boolean,
  ) {
    super(message);
    this.name = "TransportError";
  }
}

export interface TransportConfig {
  /** Simulated round-trip, in ms. */
  latency: number;
  /** 0–1 chance a send fails with a retriable error. */
  failureRate: number;
  online: boolean;
}

export interface Transport {
  send(envelope: SendEnvelope): Promise<SendAck>;
  isOnline(): boolean;
  setOnline(online: boolean): void;
  configure(patch: Partial<TransportConfig>): void;
  getConfig(): TransportConfig;
}

const DEFAULTS: TransportConfig = {
  latency: 220,
  // Low but non-zero: enough that the failed/retry path is exercised in normal
  // use instead of being dead code nobody ever sees.
  failureRate: 0.04,
  online: true,
};

export function createLocalTransport(overrides: Partial<TransportConfig> = {}): Transport {
  const config: TransportConfig = { ...DEFAULTS, ...overrides };
  /** Server-side idempotency ledger: clientId -> ack. */
  const ledger = new Map<string, SendAck>();
  let sequence = 0;

  const delay = (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });

  return {
    isOnline: () => config.online,
    setOnline: (online) => {
      config.online = online;
    },
    configure: (patch) => Object.assign(config, patch),
    getConfig: () => ({ ...config }),

    async send(envelope) {
      const existing = ledger.get(envelope.clientId);
      if (existing) {
        // A retry after an ambiguous failure: acknowledge the original row.
        await delay(config.latency / 4);
        return { ...existing, duplicate: true };
      }

      await delay(config.latency);

      if (!config.online) {
        throw new TransportError("You are offline. The message will be sent automatically.", true);
      }
      if (Math.random() < config.failureRate) {
        throw new TransportError("Network hiccup while sending.", true);
      }

      sequence += 1;
      const ack: SendAck = {
        clientId: envelope.clientId,
        serverId: `s${sequence.toString(36)}-${envelope.clientId.slice(0, 6)}`,
        timestamp: Date.now(),
        duplicate: false,
      };
      ledger.set(envelope.clientId, ack);
      return ack;
    },
  };
}

/** Exponential backoff with jitter, capped — the standard retry schedule. */
export function backoffDelay(attempt: number, base = 500, cap = 30_000) {
  const exponential = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
  return Math.round(exponential * (0.5 + Math.random() * 0.5));
}

/**
 * Collision-resistant id. `Math.random().toString(36)` alone gives ~40 bits and
 * starts colliding well before a real workspace's message volume; this uses the
 * platform CSPRNG when available.
 */
export function newId(prefix = ""): string {
  const globalCrypto = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (globalCrypto && typeof globalCrypto.randomUUID === "function") {
    return `${prefix}${globalCrypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  }
  if (globalCrypto && typeof globalCrypto.getRandomValues === "function") {
    const bytes = new Uint8Array(12);
    globalCrypto.getRandomValues(bytes);
    return `${prefix}${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  }
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
