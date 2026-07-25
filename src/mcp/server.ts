import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const serverInfo = {
  name: "deeptrace",
  version: "0.1.0",
} as const;

export function createMcpServer(): McpServer {
  return new McpServer(serverInfo);
}
