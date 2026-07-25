import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { installShutdownHandlers, startMcpServer } from "./mcp/lifecycle.js";

async function main(): Promise<void> {
  const runtime = await startMcpServer(new StdioServerTransport());
  installShutdownHandlers(runtime);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  console.error(`[deeptrace] Failed to start MCP server: ${message}`);
  process.exitCode = 1;
});
