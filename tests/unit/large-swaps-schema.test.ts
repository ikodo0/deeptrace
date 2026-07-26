import { describe, expect, it } from "vitest";

import { findLargeSwapsResponseSchema, swapEventSchema } from "../../src/schemas/index.js";
import {
  completeLargeSwapsFixture,
  duplicateLargeSwapsFixture,
  failedSourceLargeSwapsFixture,
  validLargeSwapsFixtures,
  wethToUsdcSwapFixture,
} from "../fixtures/large-swaps.js";

describe("find_large_swaps response schemas", () => {
  it("accepts success, empty, paginated, and failed-source fixtures", () => {
    for (const fixture of validLargeSwapsFixtures) {
      expect(findLargeSwapsResponseSchema.parse(fixture)).toEqual(fixture);
    }
  });

  it("rejects duplicate canonical event identities", () => {
    expect(findLargeSwapsResponseSchema.safeParse(duplicateLargeSwapsFixture).success).toBe(false);
  });

  it("requires locked identities, exact amounts, and null USD notional", () => {
    for (const event of [
      { ...wethToUsdcSwapFixture, transaction_hash: "0xABC" },
      { ...wethToUsdcSwapFixture, amount_in: 2.5 },
      { ...wethToUsdcSwapFixture, amount_in: "2.5e0" },
      { ...wethToUsdcSwapFixture, amount_out_raw: "-01" },
      { ...wethToUsdcSwapFixture, usd_notional: "6250.125" },
      { ...wethToUsdcSwapFixture, debug_row: {} },
    ]) {
      expect(swapEventSchema.safeParse(event).success).toBe(false);
    }
  });

  it("requires different supported input and output assets", () => {
    expect(
      swapEventSchema.safeParse({
        ...wethToUsdcSwapFixture,
        asset_out: wethToUsdcSwapFixture.asset_in,
      }).success,
    ).toBe(false);
  });

  it("requires page counts and cursors to match returned swaps", () => {
    expect(
      findLargeSwapsResponseSchema.safeParse({
        ...completeLargeSwapsFixture,
        pagination: {
          ...completeLargeSwapsFixture.pagination,
          returned: 1,
        },
      }).success,
    ).toBe(false);

    expect(
      findLargeSwapsResponseSchema.safeParse({
        ...completeLargeSwapsFixture,
        pagination: {
          ...completeLargeSwapsFixture.pagination,
          has_more: true,
        },
      }).success,
    ).toBe(false);
  });

  it("requires complete responses to reference one fresh Nuthatch source", () => {
    expect(
      findLargeSwapsResponseSchema.safeParse({
        ...completeLargeSwapsFixture,
        coverage: {
          requested_sources: 1,
          successful_sources: 0,
        },
      }).success,
    ).toBe(false);

    expect(
      findLargeSwapsResponseSchema.safeParse({
        ...completeLargeSwapsFixture,
        provenance: completeLargeSwapsFixture.provenance.map((entry) => ({
          ...entry,
          source_type: "native_subgraph",
        })),
      }).success,
    ).toBe(false);
  });

  it("requires observed Nuthatch freshness to include a block hash", () => {
    expect(
      findLargeSwapsResponseSchema.safeParse({
        ...completeLargeSwapsFixture,
        freshness: completeLargeSwapsFixture.freshness.map((entry) => ({
          ...entry,
          indexed_block_hash: null,
        })),
      }).success,
    ).toBe(false);
  });

  it("requires failed responses to remain empty and explain the source failure", () => {
    expect(
      findLargeSwapsResponseSchema.safeParse({
        ...failedSourceLargeSwapsFixture,
        warnings: [],
      }).success,
    ).toBe(false);

    expect(
      findLargeSwapsResponseSchema.safeParse({
        ...failedSourceLargeSwapsFixture,
        coverage: {
          requested_sources: 1,
          successful_sources: 1,
        },
      }).success,
    ).toBe(false);
  });
});
