import { describe, expect, it } from "vitest";

import { researchWalletRequestSchema } from "../../src/schemas/index.js";
import { createLiveWalletSources } from "../../src/tools/live-wallet-sources.js";
import { inspectWalletResearchQuery } from "../../src/tools/wallet-query.js";

const WALLET = "0x5cb3787a9c9c7547451ca3e6d8702453de35fe01";

describe("live wallet sources", () => {
  it("returns source-local failures when credentials and Nuthatch are unconfigured", async () => {
    const sources = createLiveWalletSources({ environment: {} });
    const request = researchWalletRequestSchema.parse({
      chain_id: 8453,
      address: WALLET,
    });
    const [graph, nuthatch] = await Promise.all([
      sources.fetchPositions(request),
      sources.fetchActivity(inspectWalletResearchQuery(request)),
    ]);

    expect(graph).toMatchObject({
      status: "error",
      positions: null,
      freshness: { status: "unavailable" },
    });
    expect(nuthatch).toMatchObject({
      status: "error",
      activities: null,
      freshness: { status: "unavailable" },
    });
    expect(JSON.stringify([graph, nuthatch])).not.toContain("undefined");
  });
});
