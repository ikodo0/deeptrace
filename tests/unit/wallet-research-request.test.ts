import { describe, expect, it } from "vitest";

import { researchWalletRequestSchema } from "../../src/schemas/index.js";
import {
  WALLET_RESEARCH_SCOPE,
  WALLET_RESEARCH_SECTIONS,
} from "../../src/scope/wallet-research.js";

const WALLET = "0x5cb3787a9c9c7547451ca3e6d8702453de35fe01";

describe("research_wallet request", () => {
  it("applies bounded defaults", () => {
    expect(researchWalletRequestSchema.parse({ chain_id: 8453, address: WALLET })).toEqual({
      chain_id: 8453,
      address: WALLET,
      sections: [...WALLET_RESEARCH_SECTIONS],
      window: "24h",
      limit: WALLET_RESEARCH_SCOPE.limit.default,
      cursor: null,
    });
  });

  it.each([
    { chain_id: 1, address: WALLET },
    { chain_id: 8453, address: WALLET.toUpperCase() },
    { chain_id: 8453, address: WALLET, window: "30d" },
    { chain_id: 8453, address: WALLET, limit: 0 },
    {
      chain_id: 8453,
      address: WALLET,
      sections: ["activity", "activity"],
    },
  ])("rejects unsupported scope %#", (input) => {
    expect(researchWalletRequestSchema.safeParse(input).success).toBe(false);
  });
});
