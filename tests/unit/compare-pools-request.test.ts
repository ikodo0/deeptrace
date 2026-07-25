import { describe, expect, it } from "vitest";

import { comparePoolsRequestSchema } from "../../src/schemas/index.js";
import { M0_COMPARE_POOLS_SCOPE } from "../../src/scope/index.js";
import {
  lockedComparePoolsRequest,
  lockedComparePoolsRequestWithOptions,
} from "../fixtures/compare-pools-request.js";

describe("compare_pools request schema", () => {
  it("accepts the locked Base WETH/USDC request and applies defaults", () => {
    expect(comparePoolsRequestSchema.parse(lockedComparePoolsRequest)).toEqual({
      chain_id: 8453,
      token0: M0_COMPARE_POOLS_SCOPE.token0.address,
      token1: M0_COMPARE_POOLS_SCOPE.token1.address,
      window: "24h",
      ranked_by: "volume_usd",
      top_n: 3,
    });
  });

  it("accepts explicit optional fields within policy bounds", () => {
    expect(comparePoolsRequestSchema.parse(lockedComparePoolsRequestWithOptions)).toEqual(
      lockedComparePoolsRequestWithOptions,
    );
  });

  it("rejects unknown fields", () => {
    expect(
      comparePoolsRequestSchema.safeParse({
        ...lockedComparePoolsRequest,
        subgraph_id: "must-not-leak",
      }).success,
    ).toBe(false);
  });

  it("rejects unsupported chain and pair addresses", () => {
    expect(
      comparePoolsRequestSchema.safeParse({
        ...lockedComparePoolsRequest,
        chain_id: 1,
      }).success,
    ).toBe(false);
    expect(
      comparePoolsRequestSchema.safeParse({
        ...lockedComparePoolsRequest,
        token1: "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca",
      }).success,
    ).toBe(false);
    expect(
      comparePoolsRequestSchema.safeParse({
        ...lockedComparePoolsRequest,
        token0: "0x4200000000000000000000000000000000000006".toUpperCase(),
      }).success,
    ).toBe(false);
  });

  it("rejects out-of-bounds top_n and unknown enums", () => {
    expect(
      comparePoolsRequestSchema.safeParse({
        ...lockedComparePoolsRequest,
        top_n: 4,
      }).success,
    ).toBe(false);
    expect(
      comparePoolsRequestSchema.safeParse({
        ...lockedComparePoolsRequest,
        window: "1h",
      }).success,
    ).toBe(false);
  });
});
