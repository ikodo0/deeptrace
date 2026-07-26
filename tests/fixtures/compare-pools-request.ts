import type { ComparePoolsRequestInput } from "../../src/schemas/index.js";
import { M0_COMPARE_POOLS_SCOPE } from "../../src/scope/index.js";

/** Minimal valid public request for the locked Graph pair. */
export const lockedComparePoolsRequest = {
  chain_id: M0_COMPARE_POOLS_SCOPE.chainId,
  token0: M0_COMPARE_POOLS_SCOPE.token0.address,
  token1: M0_COMPARE_POOLS_SCOPE.token1.address,
} as const satisfies ComparePoolsRequestInput;

export const lockedComparePoolsRequestWithOptions = {
  ...lockedComparePoolsRequest,
  window: "7d",
  ranked_by: "tvl_usd",
  top_n: 2,
} as const satisfies ComparePoolsRequestInput;
