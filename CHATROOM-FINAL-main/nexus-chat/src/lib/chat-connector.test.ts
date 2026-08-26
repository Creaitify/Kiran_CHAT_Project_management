import { beforeEach, describe, expect, it, vi } from "vitest";

import { createChatConnector, resolveConnectorKind } from "./chat-connector";
import { createLocalConnector } from "./chat-connector-local";
import { chatApiEndpoints, createApiConnector } from "./chat-connector-api";
import { SCHEMA_VERSION, STORAGE_KEY, type PersistedState } from "./chat-persistence";

function snapshot(overrides: Partial<PersistedState> = {}): PersistedState {
  return {
    version: SCHEMA_VERSION,
    rooms: [],
    messages: [],
    aiMessages: [],
    currentUserId: "u1",
    activeRoomId: "r1",
    notifications: [],
    readState: {},
    drafts: {},
    saved: {},
    followedThreads: {},
    ...overrides,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("connector selection", () => {
  it("defaults to local", () => {
    expect(resolveConnectorKind({})).toBe("local");
  });

  it("selects the api connector on an exact opt-in", () => {
    expect(resolveConnectorKind({ VITE_CHAT_CONNECTOR: "api" })).toBe("api");
    expect(resolveConnectorKind({ VITE_CHAT_CONNECTOR: "  API  " })).toBe("api");
  });

  it("falls back to local for anything unrecognised", () => {
    // A typo must leave a working app, not an empty one.
    expect(resolveConnectorKind({ VITE_CHAT_CONNECTOR: "postgres" })).toBe("local");
    expect(resolveConnectorKind({ VITE_CHAT_CONNECTOR: "" })).toBe("local");
    expect(resolveConnectorKind({ VITE_CHAT_CONNECTOR: true })).toBe("local");
  });

  it("builds the implementation matching the kind", () => {
    expect(createChatConnector("local").kind).toBe("local");
    expect(createChatConnector("api").kind).toBe("api");
  });
});

describe("local connector", () => {
  beforeEach(() => window.localStorage.clear());

  it("reads back what it wrote, under the original storage key", async () => {
    const connector = createLocalConnector();
    expect(await connector.save(snapshot({ activeRoomId: "r9" }))).toBe(true);

    // The key is the one shipped before the connector existed — an existing
    // browser's snapshot has to keep loading.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeTruthy();
    expect((await connector.load())?.activeRoomId).toBe("r9");
  });

  it("returns null on first run rather than throwing", async () => {
    expect(await createLocalConnector().load()).toBeNull();
  });

  it("notifies on a cross-tab write and stops after unsubscribe", async () => {
    const connector = createLocalConnector();
    const onChange = vi.fn();
    const stop = connector.subscribe(onChange);

    const fire = (key: string) =>
      window.dispatchEvent(
        new StorageEvent("storage", { key, newValue: JSON.stringify(snapshot()) }),
      );

    fire("some-other-app");
    expect(onChange).not.toHaveBeenCalled();

    fire(STORAGE_KEY);
    expect(onChange).toHaveBeenCalledTimes(1);

    stop();
    fire(STORAGE_KEY);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("reports not-ready when localStorage refuses writes", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });

    const status = await createLocalConnector().status();
    expect(status).toMatchObject({ kind: "local", ready: false });

    setItem.mockRestore();
  });
});

describe("api connector", () => {
  const options = { baseUrl: "http://api.test", workspaceSlug: "acme" };

  it("scopes every endpoint to the workspace", () => {
    const endpoints = chatApiEndpoints("http://api.test/", "acme corp");
    expect(endpoints.snapshot).toBe("http://api.test/api/workspaces/acme%20corp/chat/snapshot/");
    expect(endpoints.events).toBe("http://api.test/api/workspaces/acme%20corp/chat/events/");
    expect(endpoints.health).toBe("http://api.test/api/workspaces/acme%20corp/chat/health/");
  });

  it("sends session credentials — workspace routes are authenticated", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(snapshot()));
    await createApiConnector({ ...options, fetchImpl }).load();

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/api/workspaces/acme/chat/snapshot/",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("loads a snapshot when the endpoint answers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(snapshot({ activeRoomId: "r7" })));
    expect((await createApiConnector({ ...options, fetchImpl }).load())?.activeRoomId).toBe("r7");
  });

  it("treats 204 as an empty workspace, not a failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    expect(await createApiConnector({ ...options, fetchImpl }).load()).toBeNull();
  });

  it("falls back to seed data when the endpoints do not exist yet", async () => {
    // Stage 1 ships the seam; apps/api serves no /chat/ routes until Stage 3.
    // That has to degrade to seed data, never to a blank screen.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    const connector = createApiConnector({ ...options, fetchImpl });

    expect(await connector.load()).toBeNull();
    expect(await connector.save(snapshot())).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);

    // One warning per process, however many times the store re-saves.
    await connector.load();
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
  });

  it("survives a network error without rejecting", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const connector = createApiConnector({ ...options, fetchImpl });

    expect(await connector.load()).toBeNull();
    expect(await connector.save(snapshot())).toBe(false);

    warn.mockRestore();
  });

  it("refuses to run unscoped rather than reading another workspace", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn();
    const connector = createApiConnector({
      baseUrl: "http://api.test",
      workspaceSlug: "",
      fetchImpl,
    });

    expect(await connector.load()).toBeNull();
    expect(await connector.save(snapshot())).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await connector.status()).toMatchObject({ ready: false });

    warn.mockRestore();
  });

  it("reports ready when the health endpoint answers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ ok: true }));
    const status = await createApiConnector({ ...options, fetchImpl }).status();
    expect(status).toMatchObject({ kind: "api", ready: true });
    expect(status.detail).toContain("acme");
  });

  it("names Stage 3 when the health endpoint is absent", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    const status = await createApiConnector({ ...options, fetchImpl }).status();
    expect(status).toMatchObject({ kind: "api", ready: false });
    expect(status.detail).toContain("Stage 3");
  });

  it("PUTs the snapshot and reports whether it stuck", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    expect(await createApiConnector({ ...options, fetchImpl }).save(snapshot())).toBe(true);

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toMatchObject({ version: SCHEMA_VERSION });
  });
});
