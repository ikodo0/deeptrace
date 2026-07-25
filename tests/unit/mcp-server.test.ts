import { describe, expect, it } from "vitest";

import { createMcpServer, serverInfo } from "../../src/mcp/server.js";
import { createFixtureComparePoolsSources } from "../../src/tools/index.js";

describe("MCP server foundation", () => {
  it("creates the configured DeepTrace server", () => {
    expect(
      createMcpServer({
        sources: createFixtureComparePoolsSources({ graphResults: [] }),
      }),
    ).toBeDefined();
    expect(serverInfo).toEqual({
      name: "deeptrace",
      version: "0.1.0",
    });
  });
});
