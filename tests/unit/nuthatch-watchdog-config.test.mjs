import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("Nuthatch watchdog deployment configuration", () => {
  it("keeps valid credential-free public RPC fallbacks in the nest", async () => {
    const config = await readFile(new URL("../../nest/nuthatch.toml", import.meta.url), "utf8");
    const block = config.match(/rpc_urls\s*=\s*\[([^\]]*)\]/);
    expect(block).not.toBeNull();

    const declarations = block[1]
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    expect(declarations.length).toBeGreaterThan(1);
    expect(config).not.toContain("${");

    for (const declaration of declarations) {
      expect(declaration).toMatch(/^"[^"]+"$/);
      const endpoint = new URL(JSON.parse(declaration));
      expect(endpoint.protocol).toBe("https:");
      expect(endpoint.username).toBe("");
      expect(endpoint.password).toBe("");
      expect(endpoint.hostname).not.toBe("mainnet.base.org");
    }
  });
});
