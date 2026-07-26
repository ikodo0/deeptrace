import { describe, expect, it, vi } from "vitest";

import { compareLendingResponseSchema } from "../../src/schemas/compare-lending.js";
import type { LendingMarketSourceResult } from "../../src/schemas/source-adapter.js";
import { M0_COMPARE_LENDING_SCOPE } from "../../src/scope/index.js";
import {
  CompareLendingRequestError,
  createFixtureCompareLendingSources,
  executeCompareLending,
} from "../../src/tools/index.js";
import {
  completeLendingScenario,
  lendingAave,
  lendingMoonwell,
  lendingMoonwellUnsupported,
  lendingSeamless,
  lendingSeamlessTimeout,
  partialLendingScenario,
} from "../fixtures/lending-sources.js";

const lockedRequest = {
  chain_id: M0_COMPARE_LENDING_SCOPE.chainId,
  market_token: M0_COMPARE_LENDING_SCOPE.marketToken.address,
} as const;

function sourcesFor(results: readonly LendingMarketSourceResult[], onFetch?: () => void) {
  return createFixtureCompareLendingSources({
    lendingResults: results,
    ...(onFetch !== undefined ? { onLendingFetch: onFetch } : {}),
  });
}

describe("executeCompareLending", () => {
  it("rejects invalid requests before calling source adapters", async () => {
    const onLendingFetch = vi.fn();

    await expect(
      executeCompareLending(
        { ...lockedRequest, market_token: "0x4200000000000000000000000000000000000006" } as never,
        sourcesFor(completeLendingScenario, onLendingFetch),
      ),
    ).rejects.toBeInstanceOf(CompareLendingRequestError);
    expect(onLendingFetch).not.toHaveBeenCalled();
  });

  it("returns a complete envelope when all three protocols answer fresh", async () => {
    const response = await executeCompareLending(
      lockedRequest,
      sourcesFor(completeLendingScenario),
    );

    expect(compareLendingResponseSchema.parse(response).status).toBe("complete");
    expect(response.status).toBe("complete");
    expect(response.coverage).toEqual({ requested_sources: 3, successful_sources: 3 });
    expect(response.freshness.map((entry) => entry.status)).toEqual(["fresh", "fresh", "fresh"]);
    expect(response.provenance.map((entry) => entry.source_id)).toEqual(
      M0_COMPARE_LENDING_SCOPE.sources.map((source) => source.source_id),
    );
    expect(response.data?.rate_basis).toBe("percent_apy");
    expect(response.data?.ranked_by).toBe("tvl_usd");
    expect(response.data?.market_token).toEqual({
      chain_id: 8453,
      address: M0_COMPARE_LENDING_SCOPE.marketToken.address,
      symbol: "USDC",
      decimals: 6,
    });
    // Default ranking is TVL desc: Aave 172.4M, Moonwell 15.1M, Seamless 205K.
    expect(response.data?.markets.map((market) => market.protocol)).toEqual([
      "aave-v3",
      "moonwell",
      "seamless-protocol",
    ]);
    expect(response.data?.markets.map((market) => market.rank)).toEqual([1, 2, 3]);
    expect(response.data?.markets[0]?.source_ids).toEqual(["messari-aave-v3-base"]);
  });

  it("returns a partial envelope with warnings when two protocols degrade", async () => {
    const response = await executeCompareLending(lockedRequest, sourcesFor(partialLendingScenario));

    expect(compareLendingResponseSchema.parse(response).status).toBe("partial");
    expect(response.coverage.successful_sources).toBe(1);
    expect(response.freshness.map((entry) => entry.status)).toEqual([
      "fresh",
      "unavailable",
      "unavailable",
    ]);
    expect(response.warnings).toContain("messari-seamless-base timed out");
    expect(response.warnings).toContain("messari-moonwell-base is unsupported for this request");
    expect(response.data?.markets).toHaveLength(1);
    expect(response.data?.markets[0]?.protocol).toBe("aave-v3");
  });

  it("returns a failed envelope with null data when no protocol answers", async () => {
    const response = await executeCompareLending(
      lockedRequest,
      sourcesFor([
        { ...lendingAave, status: "error", data: null, freshness: null, warnings: [] },
        lendingSeamlessTimeout,
        lendingMoonwellUnsupported,
      ]),
    );

    expect(compareLendingResponseSchema.parse(response).status).toBe("failed");
    expect(response.data).toBeNull();
    expect(response.coverage).toEqual({ requested_sources: 3, successful_sources: 0 });
    expect(response.warnings).toContain("messari-aave-v3-base returned an error");
    expect(response.provenance).toHaveLength(3);
  });

  it("ranks by the requested rate metric with nulls last", async () => {
    const response = await executeCompareLending(
      { ...lockedRequest, ranked_by: "borrower_stable_rate_percent" as never },
      sourcesFor(completeLendingScenario),
    ).catch((error: unknown) => error);

    // borrower_stable_rate_percent is not a supported ranking metric.
    expect(response).toBeInstanceOf(CompareLendingRequestError);

    const byLenderRate = await executeCompareLending(
      { ...lockedRequest, ranked_by: "lender_variable_rate_percent" },
      sourcesFor(completeLendingScenario),
    );

    // Moonwell 4.116 > Aave 3.517 > Seamless 0.110.
    expect(byLenderRate.data?.markets.map((market) => market.protocol)).toEqual([
      "moonwell",
      "aave-v3",
      "seamless-protocol",
    ]);
  });

  it("orders a null ranking metric last", async () => {
    const aaveWithoutBorrowBalance = {
      ...lendingAave,
      data: { ...lendingAave.data, total_borrow_balance_usd: null },
    } satisfies LendingMarketSourceResult;

    const response = await executeCompareLending(
      { ...lockedRequest, ranked_by: "total_borrow_balance_usd" },
      sourcesFor([aaveWithoutBorrowBalance, lendingSeamless, lendingMoonwell]),
    );

    expect(response.data?.markets.map((market) => market.protocol)).toEqual([
      "moonwell",
      "seamless-protocol",
      "aave-v3",
    ]);
    expect(response.data?.markets[2]?.total_borrow_balance_usd).toBeNull();
  });

  it("keeps coverage on answered sources when top_n truncates ranked markets", async () => {
    const response = await executeCompareLending(
      { ...lockedRequest, top_n: 1 },
      sourcesFor(completeLendingScenario),
    );

    // Truncation is the caller's choice, so it is a warning rather than a
    // coverage gap: every source still answered and was fresh.
    expect(compareLendingResponseSchema.parse(response).status).toBe("complete");
    expect(response.data?.markets).toHaveLength(1);
    expect(response.coverage.successful_sources).toBe(3);
    expect(response.warnings).toContain("Top-N truncated ranked markets from 3 to 1.");
  });

  it("orders warnings by locked source order then lexically", async () => {
    const response = await executeCompareLending(lockedRequest, sourcesFor(partialLendingScenario));

    const seamlessIndex = response.warnings.findIndex((warning) =>
      warning.includes("messari-seamless-base"),
    );
    const moonwellIndex = response.warnings.findIndex((warning) =>
      warning.includes("messari-moonwell-base"),
    );
    expect(seamlessIndex).toBeGreaterThanOrEqual(0);
    expect(seamlessIndex).toBeLessThan(moonwellIndex);
  });
});
