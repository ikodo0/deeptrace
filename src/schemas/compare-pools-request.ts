import { z } from "zod";

import { M0_CORE_POLICY, M0_RANKING_METRICS, M0_TIME_WINDOWS } from "../policy/index.js";
import { M0_COMPARE_POOLS_SCOPE } from "../scope/compare-pools.js";
import { BASE_CHAIN_ID } from "./source-adapter.js";

/**
 * Public `compare_pools` request schema bound to the locked Base WETH/USDC pair.
 * Unknown fields and out-of-scope pairs/chains are rejected.
 */
export const comparePoolsRequestSchema = z
  .object({
    chain_id: z.literal(BASE_CHAIN_ID),
    token0: z.literal(M0_COMPARE_POOLS_SCOPE.token0.address),
    token1: z.literal(M0_COMPARE_POOLS_SCOPE.token1.address),
    window: z.enum(M0_TIME_WINDOWS).default(M0_CORE_POLICY.defaultWindow),
    ranked_by: z.enum(M0_RANKING_METRICS).default(M0_CORE_POLICY.defaultRankingMetric),
    top_n: z
      .number()
      .int()
      .min(1)
      .max(M0_CORE_POLICY.topN.maximum)
      .default(M0_CORE_POLICY.topN.default),
  })
  .strict();

export type ComparePoolsRequest = z.infer<typeof comparePoolsRequestSchema>;
export type ComparePoolsRequestInput = z.input<typeof comparePoolsRequestSchema>;
