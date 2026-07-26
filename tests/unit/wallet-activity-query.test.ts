import { describe, expect, it } from "vitest";

import {
  buildWalletActivityHeadQuery,
  buildWalletActivityQuery,
} from "../../src/sources/nuthatch/wallet-activity-query.js";
import {
  inspectWalletResearchQuery,
  WalletResearchQueryError,
} from "../../src/tools/wallet-query.js";

const WALLET = "0x5cb3787a9c9c7547451ca3e6d8702453de35fe01";

describe("wallet activity SQL", () => {
  it("builds a bounded allowlisted wallet query", () => {
    const context = inspectWalletResearchQuery({
      chain_id: 8453,
      address: WALLET,
      window: "24h",
      limit: 10,
    });
    const query = buildWalletActivityQuery(context, 100, 50);

    expect(query).toContain("FROM wallet_swap_activity");
    expect(query).toContain(`CAST(sender AS VARCHAR) = '${WALLET}'`);
    expect(query).toContain(`CAST(recipient AS VARCHAR) = '${WALLET}'`);
    expect(query).toContain("block_number <= 100");
    expect(query).toContain("block_timestamp >= 50");
    expect(query).toContain("LIMIT 5001");
    expect(query).not.toContain(";");
  });

  it("bounds the snapshot head query without request text", () => {
    expect(buildWalletActivityHeadQuery(123)).toContain("WHERE block_number <= 123");
    expect(() => buildWalletActivityHeadQuery(-1)).toThrow(
      "snapshotHead must be a non-negative safe integer",
    );
  });

  it("rejects an unsafe address before SQL construction", () => {
    expect(() =>
      inspectWalletResearchQuery({
        chain_id: 8453,
        address: `${WALLET}' OR 1=1 --`,
      }),
    ).toThrow(WalletResearchQueryError);
  });
});
