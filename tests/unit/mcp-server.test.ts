import { describe, expect, it } from "vitest";

import { createMcpServer, serverInfo } from "../../src/mcp/server.js";

describe("MCP server foundation", () => {
  it("creates the configured DeepTrace server", () => {
    expect(createMcpServer()).toBeDefined();
    expect(serverInfo).toEqual({
      name: "deeptrace",
      version: "0.1.0",
    });
  });
});
