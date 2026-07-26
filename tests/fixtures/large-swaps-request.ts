import type { FindLargeSwapsRequestInput } from "../../src/schemas/index.js";
import { LSS_SCOPE } from "../../src/scope/index.js";

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
  min_amount: "2500.000001",
  limit: 10,
  cursor: "lss:v1:fixture-page-2",
} as const satisfies FindLargeSwapsRequestInput;
