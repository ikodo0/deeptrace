import { describe, expect, it } from "vitest";

import {
  NormalizationError,
  deduplicateSwapEvents,
  filterSwapsByTokenThreshold,
  normalizeDeduplicateAndFilterSwaps,
  normalizeLssSwapEvent,
  swapEventIdentity,
  swapMeetsTokenThreshold,
  type RawLssSwapEvent,
} from "../../src/normalization/index.js";
import { LSS_SCOPE } from "../../src/scope/index.js";
import { usdcToWethSwapFixture, wethToUsdcSwapFixture } from "../fixtures/large-swaps.js";

function rawSwap(overrides: Partial<RawLssSwapEvent> = {}): RawLssSwapEvent {
  return {
    chain_id: LSS_SCOPE.chainId,
    protocol: LSS_SCOPE.protocol,
    pool: LSS_SCOPE.poolAddress,
    transaction_hash: `0x${"1".repeat(64)}`,
    log_index: 12,
    block_number: 20_000_099,
    timestamp: 1_749_999_990,
    amount0_raw: "2500000000000000000",
    amount1_raw: "-6250125000",
    source_id: "fixture-nuthatch-swaps",
    ...overrides,
  };
}

describe("LSS swap normalization", () => {
  it("derives WETH-in/USDC-out direction and preserves signed raw deltas", () => {
    expect(normalizeLssSwapEvent(rawSwap())).toEqual(wethToUsdcSwapFixture);
  });

  it("derives reversed USDC-in/WETH-out direction", () => {
    expect(
      normalizeLssSwapEvent(
        rawSwap({
          transaction_hash: `0x${"2".repeat(64)}`,
          log_index: 7,
          block_number: 20_000_098,
          timestamp: 1_749_999_980,
          amount0_raw: "-1200000000000000000",
          amount1_raw: "3000000001",
        }),
      ),
    ).toEqual(usdcToWethSwapFixture);
  });

  it("converts base units exactly at token precision without floating point", () => {
    const normalized = normalizeLssSwapEvent(
      rawSwap({
        amount0_raw: "1",
        amount1_raw: "-1",
      }),
    );

    expect(normalized.amount_in).toBe("0.000000000000000001");
    expect(normalized.amount_out).toBe("0.000001");

    const large = normalizeLssSwapEvent(
      rawSwap({
        amount0_raw: "123456789012345678901234567890123456789",
        amount1_raw: "-987654321012345",
      }),
    );
    expect(large.amount_in).toBe("123456789012345678901.234567890123456789");
    expect(large.amount_out).toBe("987654321.012345");
  });

  it("normalizes mixed-case pool and transaction identities", () => {
    const normalized = normalizeLssSwapEvent(
      rawSwap({
        pool: LSS_SCOPE.poolAddress.toUpperCase().replace("0X", "0x"),
        transaction_hash: `0x${"A".repeat(64)}`,
      }),
    );

    expect(normalized.pool).toBe(LSS_SCOPE.poolAddress);
    expect(normalized.transaction_hash).toBe(`0x${"a".repeat(64)}`);
  });

  it("rejects malformed, zero, same-sign, and out-of-scope rows", () => {
    for (const row of [
      rawSwap({ amount0_raw: "01" }),
      rawSwap({ amount0_raw: "0" }),
      rawSwap({ amount1_raw: "6250125000" }),
      rawSwap({ chain_id: 1 }),
      rawSwap({ protocol: "pancakeswap-v3" }),
      rawSwap({ pool: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
    ]) {
      expect(() => normalizeLssSwapEvent(row)).toThrow(NormalizationError);
    }
  });
});

describe("LSS swap identity and deduplication", () => {
  it("builds a chain/transaction/log identity independent of hash casing", () => {
    expect(swapEventIdentity(8453, `0x${"A".repeat(64)}`, 12)).toBe(
      swapEventIdentity(8453, `0x${"a".repeat(64)}`, 12),
    );
    expect(swapEventIdentity(8453, `0x${"a".repeat(64)}`, 12)).not.toBe(
      swapEventIdentity(8453, `0x${"a".repeat(64)}`, 13),
    );
  });

  it("collapses exact duplicate events", () => {
    const event = normalizeLssSwapEvent(rawSwap());
    expect(deduplicateSwapEvents([event, { ...event }])).toEqual([event]);
  });

  it("rejects conflicting rows with the same event identity", () => {
    const event = normalizeLssSwapEvent(rawSwap());
    expect(() =>
      deduplicateSwapEvents([
        event,
        {
          ...event,
          amount_in: "3",
          amount_in_raw: "3000000000000000000",
        },
      ]),
    ).toThrow(NormalizationError);
  });
});

describe("LSS exact token threshold", () => {
  const event = normalizeLssSwapEvent(rawSwap());

  it("includes exact equality and excludes a value one base unit below", () => {
    expect(swapMeetsTokenThreshold(event, LSS_SCOPE.tokens.weth.address, "2.5")).toBe(true);
    expect(
      swapMeetsTokenThreshold(event, LSS_SCOPE.tokens.weth.address, "2.500000000000000001"),
    ).toBe(false);
    expect(swapMeetsTokenThreshold(event, LSS_SCOPE.tokens.usdc.address, "6250.125")).toBe(true);
    expect(swapMeetsTokenThreshold(event, LSS_SCOPE.tokens.usdc.address, "6250.125001")).toBe(
      false,
    );
  });

  it("uses the absolute signed pool delta for either selected token", () => {
    expect(event.amount_out_raw?.startsWith("-")).toBe(true);
    expect(filterSwapsByTokenThreshold([event], LSS_SCOPE.tokens.usdc.address, "6000")).toEqual([
      event,
    ]);
  });

  it("rejects unsupported tokens, zero thresholds, missing raw values, and wrong signs", () => {
    expect(() =>
      swapMeetsTokenThreshold(event, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "1"),
    ).toThrow(NormalizationError);
    expect(() => swapMeetsTokenThreshold(event, LSS_SCOPE.tokens.weth.address, "0")).toThrow(
      NormalizationError,
    );
    expect(() =>
      swapMeetsTokenThreshold(
        { ...event, amount_in_raw: undefined },
        LSS_SCOPE.tokens.weth.address,
        "1",
      ),
    ).toThrow(NormalizationError);
    expect(() =>
      swapMeetsTokenThreshold(
        { ...event, amount_out_raw: "6250125000" },
        LSS_SCOPE.tokens.usdc.address,
        "1",
      ),
    ).toThrow(NormalizationError);
  });

  it("normalizes, deduplicates, and removes below-threshold rows in one pipeline", () => {
    const below = rawSwap({
      transaction_hash: `0x${"3".repeat(64)}`,
      log_index: 3,
      amount0_raw: "1499999999999999999",
      amount1_raw: "-3749999999",
    });

    expect(
      normalizeDeduplicateAndFilterSwaps(
        [rawSwap(), { ...rawSwap() }, below],
        LSS_SCOPE.tokens.weth.address,
        "1.5",
      ),
    ).toEqual([event]);
  });
});
