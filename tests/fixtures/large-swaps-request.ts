import type { FindLargeSwapsRequestInput } from "../../src/schemas/index.js";
import { LSS_SCOPE } from "../../src/scope/index.js";

export const fixtureLargeSwapCursor =
  "lss:v1:eyJzbmFwc2hvdF9oZWFkIjoyMDAwMDEwMCwiY2hhaW5faWQiOjg0NTMsInBvb2xfYWRkcmVzcyI6IjB4NmM1NjFiNDQ2NDE2ZTFhMDBlOGU5M2UyMjE4NTRkNmVhNDE3MTM3MiIsInRocmVzaG9sZF90b2tlbiI6IjB4ODMzNTg5ZmNkNmVkYjZlMDhmNGM3YzMyZDRmNzFiNTRiZGEwMjkxMyIsIm1pbl9hbW91bnQiOiIyNTAwIiwibGFzdF9ldmVudCI6eyJibG9ja19udW1iZXIiOjIwMDAwMDk4LCJsb2dfaW5kZXgiOjcsInRyYW5zYWN0aW9uX2hhc2giOiIweDIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIifX0";

export const lockedLargeSwapsRequest = {
  chain_id: LSS_SCOPE.chainId,
  pool_address: LSS_SCOPE.poolAddress,
  threshold_token: LSS_SCOPE.tokens.weth.address,
  min_amount: "1.5",
} as const satisfies FindLargeSwapsRequestInput;

export const lockedLargeSwapsRequestWithOptions = {
  chain_id: LSS_SCOPE.chainId,
  pool_address: LSS_SCOPE.poolAddress,
  threshold_token: LSS_SCOPE.tokens.usdc.address,
  min_amount: "2500",
  limit: 1,
  cursor: fixtureLargeSwapCursor,
} as const satisfies FindLargeSwapsRequestInput;
