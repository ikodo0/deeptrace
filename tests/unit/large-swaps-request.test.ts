import { describe, expect, it } from "vitest";

import { findLargeSwapsRequestSchema } from "../../src/schemas/index.js";
import { LSS_SCOPE } from "../../src/scope/index.js";
import {
  lockedLargeSwapsRequest,
  lockedLargeSwapsRequestWithOptions,
} from "../fixtures/large-swaps-request.js";

describe("find_large_swaps request schema", () => {
  it("accepts the locked Base pool request and applies defaults", () => {
    expect(findLargeSwapsRequestSchema.parse(lockedLargeSwapsRequest)).toEqual({
      ...lockedLargeSwapsRequest,
      limit: 25,
      cursor: null,
    });
  });

  it("accepts either pool token and explicit bounded page options", () => {
    expect(findLargeSwapsRequestSchema.parse(lockedLargeSwapsRequestWithOptions)).toEqual(
      lockedLargeSwapsRequestWithOptions,
    );
  });

  it("rejects unsupported chains, pools, and threshold tokens", () => {
    for (const request of [
      { ...lockedLargeSwapsRequest, chain_id: 1 },
      {
        ...lockedLargeSwapsRequest,
        pool_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      {
        ...lockedLargeSwapsRequest,
        threshold_token: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      {
        ...lockedLargeSwapsRequest,
        threshold_token: LSS_SCOPE.tokens.weth.address.toUpperCase(),
      },
    ]) {
      expect(findLargeSwapsRequestSchema.safeParse(request).success).toBe(false);
    }
  });

  it("accepts positive exact decimals and rejects zero or malformed amounts", () => {
    for (const minAmount of ["0.000001", "1", "1.0", "2500.000001"]) {
      expect(
        findLargeSwapsRequestSchema.safeParse({
          ...lockedLargeSwapsRequest,
          min_amount: minAmount,
        }).success,
      ).toBe(true);
    }

    for (const minAmount of ["0", "0.0", "-1", "+1", "01", "1e3", " 1"]) {
      expect(
        findLargeSwapsRequestSchema.safeParse({
          ...lockedLargeSwapsRequest,
          min_amount: minAmount,
        }).success,
      ).toBe(false);
    }
  });

  it("rejects out-of-bounds limits, blank cursors, and unknown fields", () => {
    for (const request of [
      { ...lockedLargeSwapsRequest, limit: 0 },
      { ...lockedLargeSwapsRequest, limit: 101 },
      { ...lockedLargeSwapsRequest, limit: 1.5 },
      { ...lockedLargeSwapsRequest, cursor: "" },
      { ...lockedLargeSwapsRequest, cursor: " cursor " },
      { ...lockedLargeSwapsRequest, cursor: "x".repeat(LSS_SCOPE.cursor.maximumLength + 1) },
      { ...lockedLargeSwapsRequest, sql: "select *" },
    ]) {
      expect(findLargeSwapsRequestSchema.safeParse(request).success).toBe(false);
    }
  });
});
