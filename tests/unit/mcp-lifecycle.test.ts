import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import {
  installShutdownHandlers,
  startMcpServer,
  type ShutdownSignal,
  type ShutdownSignalTarget,
} from "../../src/mcp/lifecycle.js";
import { serverInfo } from "../../src/mcp/server.js";

class TestSignalTarget implements ShutdownSignalTarget {
  private readonly listeners = new Map<ShutdownSignal, () => void>();

  once(signal: ShutdownSignal, listener: () => void): void {
    this.listeners.set(signal, listener);
  }

  off(signal: ShutdownSignal, listener: () => void): void {
    if (this.listeners.get(signal) === listener) {
      this.listeners.delete(signal);
    }
  }

  emit(signal: ShutdownSignal): void {
    const listener = this.listeners.get(signal);
    this.listeners.delete(signal);
    listener?.();
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

describe("MCP server lifecycle", () => {
  it("completes initialization over an in-memory transport", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const runtime = await startMcpServer(serverTransport);
    const client = new Client({
      name: "deeptrace-test-client",
      version: "0.1.0",
    });

    try {
      await client.connect(clientTransport);

      expect(client.getServerVersion()).toEqual(serverInfo);
      expect(runtime.server.isConnected()).toBe(true);
    } finally {
      await client.close();
      await runtime.close();
    }

    expect(runtime.server.isConnected()).toBe(false);
  });

  it("closes only once when multiple shutdown signals arrive", async () => {
    const signalTarget = new TestSignalTarget();
    const close = vi.fn().mockResolvedValue(undefined);
    const removeHandlers = installShutdownHandlers({ close }, signalTarget);

    signalTarget.emit("SIGINT");
    signalTarget.emit("SIGTERM");

    await vi.waitFor(() => {
      expect(close).toHaveBeenCalledTimes(1);
    });

    removeHandlers();
    expect(signalTarget.listenerCount()).toBe(0);
  });
});
