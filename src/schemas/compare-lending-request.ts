import { z } from "zod";

import { M0_CORE_POLICY, M0_LENDING_RANKING_METRICS } from "../policy/index.js";
import { BASE_CHAIN_ID } from "./source-adapter.js";

/**
 * Public `compare_lending_markets` request schema bound to the locked Base
 * USDC market asset. Unknown fields and out-of-scope tokens/chains are
 * rejected.
 */
export const compareLendingRequestSchema = z
  .object({
    chain_id: z.literal(BASE_CHAIN_ID),
    market_token: z.literal(M0_CORE_POLICY.lending.marketToken),
    ranked_by: z
      .enum(M0_LENDING_RANKING_METRICS)
      .default(M0_CORE_POLICY.lending.defaultRankingMetric),
    top_n: z
      .number()
      .int()
      .min(1)
      .max(M0_CORE_POLICY.lending.topN.maximum)
      .default(M0_CORE_POLICY.lending.topN.default),
  })
  .strict();

export type CompareLendingRequest = z.infer<typeof compareLendingRequestSchema>;
export type CompareLendingRequestInput = z.input<typeof compareLendingRequestSchema>;
