import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("Nuthatch watchdog deployment configuration", () => {
  it("keeps every production RPC endpoint in environment configuration", async () => {
    const config = await readFile(new URL("../../nest/nuthatch.toml", import.meta.url), "utf8");
    expect(config).toContain('"${BASE_RPC_URL_PRIMARY}"');
    expect(config).toContain('"${BASE_RPC_URL_SECONDARY}"');
    expect(config).toContain('"${BASE_RPC_URL_TERTIARY}"');
    expect(config).not.toContain("https://");
  });
});
