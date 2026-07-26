import { z } from "zod";

import { LSS_SCOPE } from "../scope/large-swaps.js";
import { BASE_CHAIN_ID } from "./source-adapter.js";

const positiveDecimalStringSchema = z
  .string()
  .regex(
    /^(?:0\.\d*[1-9]\d*|[1-9]\d*(?:\.\d+)?)$/,
    "Expected a positive decimal string in human units",
  );

const opaqueCursorSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim() === value, "Cursor must not contain surrounding whitespace");

/**
 * Public `find_large_swaps` request bound to the locked Base Uniswap V3 pool.
 * Unknown fields and out-of-scope chains, pools, or threshold tokens are rejected.
 */
export const findLargeSwapsRequestSchema = z
  .object({
    chain_id: z.literal(BASE_CHAIN_ID),
    pool_address: z.literal(LSS_SCOPE.poolAddress),
    threshold_token: z.union([
      z.literal(LSS_SCOPE.tokens.weth.address),
      z.literal(LSS_SCOPE.tokens.usdc.address),
    ]),
    min_amount: positiveDecimalStringSchema,
    limit: z.number().int().min(1).max(LSS_SCOPE.limit.maximum).default(LSS_SCOPE.limit.default),
    cursor: opaqueCursorSchema.nullable().default(null),
  })
  .strict();

export type FindLargeSwapsRequest = z.infer<typeof findLargeSwapsRequestSchema>;
export type FindLargeSwapsRequestInput = z.input<typeof findLargeSwapsRequestSchema>;
