import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { createMcpServer } from "./server.js";

export type ShutdownSignal = "SIGINT" | "SIGTERM";

export interface McpServerRuntime {
  readonly server: ReturnType<typeof createMcpServer>;
  close(): Promise<void>;
}

export interface ShutdownSignalTarget {
  once(signal: ShutdownSignal, listener: () => void): unknown;
  off(signal: ShutdownSignal, listener: () => void): unknown;
}

export async function startMcpServer(transport: Transport): Promise<McpServerRuntime> {
  const server = createMcpServer();
  await server.connect(transport);

  let closePromise: Promise<void> | undefined;

  return {
    server,
    close() {
      closePromise ??= server.close();
      return closePromise;
    },
  };
}

export function installShutdownHandlers(
  runtime: Pick<McpServerRuntime, "close">,
  signalTarget: ShutdownSignalTarget = process,
  onError: (error: unknown) => void = (error) => {
    const message = error instanceof Error ? error.message : "Unknown shutdown error";
    console.error(`[deeptrace] Failed to stop MCP server: ${message}`);
    process.exitCode = 1;
  },
): () => void {
  let shutdownPromise: Promise<void> | undefined;

  const shutdown = (): void => {
    shutdownPromise ??= runtime.close().catch(onError);
  };

  signalTarget.once("SIGINT", shutdown);
  signalTarget.once("SIGTERM", shutdown);

  return () => {
    signalTarget.off("SIGINT", shutdown);
    signalTarget.off("SIGTERM", shutdown);
  };
}
