import { describe, expect, it } from "vitest";
import { backoffDelay, createLocalTransport, newId, TransportError } from "./transport";

describe("createLocalTransport", () => {
  it("acknowledges a send", async () => {
    const transport = createLocalTransport({ latency: 0, failureRate: 0 });
    const ack = await transport.send({ clientId: "c1", roomId: "r1", senderId: "u1" });
    expect(ack.clientId).toBe("c1");
    expect(ack.duplicate).toBe(false);
    expect(ack.serverId).toBeTruthy();
  });

  it("is idempotent: the same clientId never creates a second row", async () => {
    const transport = createLocalTransport({ latency: 0, failureRate: 0 });
    const first = await transport.send({ clientId: "c1", roomId: "r1", senderId: "u1" });
    const retry = await transport.send({ clientId: "c1", roomId: "r1", senderId: "u1" });
    expect(retry.duplicate).toBe(true);
    expect(retry.serverId).toBe(first.serverId);
    expect(retry.timestamp).toBe(first.timestamp);
  });

  it("fails retriably while offline", async () => {
    const transport = createLocalTransport({ latency: 0, failureRate: 0 });
    transport.setOnline(false);
    await expect(
      transport.send({ clientId: "c2", roomId: "r1", senderId: "u1" }),
    ).rejects.toBeInstanceOf(TransportError);

    transport.setOnline(true);
    await expect(
      transport.send({ clientId: "c2", roomId: "r1", senderId: "u1" }),
    ).resolves.toMatchObject({ duplicate: false });
  });

  it("surfaces injected failures as retriable", async () => {
    const transport = createLocalTransport({ latency: 0, failureRate: 1 });
    await expect(
      transport.send({ clientId: "c3", roomId: "r1", senderId: "u1" }),
    ).rejects.toMatchObject({ retriable: true });
  });
});

describe("backoffDelay", () => {
  it("grows with each attempt and stays under the cap", () => {
    const first = backoffDelay(1, 500, 30_000);
    const later = backoffDelay(6, 500, 30_000);
    expect(first).toBeLessThanOrEqual(500);
    expect(later).toBeLessThanOrEqual(30_000);
    expect(later).toBeGreaterThan(first);
  });

  it("applies jitter rather than a fixed schedule", () => {
    const samples = new Set(Array.from({ length: 20 }, () => backoffDelay(4)));
    expect(samples.size).toBeGreaterThan(1);
  });
});

describe("newId", () => {
  it("does not collide across a large batch", () => {
    const ids = new Set(Array.from({ length: 20_000 }, () => newId("m")));
    expect(ids.size).toBe(20_000);
  });

  it("honours the prefix", () => {
    expect(newId("ai")).toMatch(/^ai/);
  });
});
