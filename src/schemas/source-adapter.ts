import { z } from "zod";

export const BASE_CHAIN_ID = 8453 as const;

const nonEmptyStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim() === value, "Must not have leading or trailing whitespace");

const nonNegativeIntegerSchema = z.number().int().nonnegative();
const nonNegativeNumberSchema = z.number().nonnegative();

const ethereumAddressSchema = z
  .string()
  .regex(/^0x[0-9a-f]{40}$/, "Expected a lowercase 20-byte hexadecimal address");

const blockHashSchema = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/, "Expected a lowercase 32-byte hexadecimal hash");

const nonNegativeDecimalStringSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, "Expected a non-negative decimal string");

const financialValueSchema = nonNegativeDecimalStringSchema.nullable();

export const sourceStatusSchema = z.enum(["ok", "timeout", "error", "unsupported", "stale"]);
export const failureSourceStatusSchema = z.enum(["timeout", "error", "unsupported", "stale"]);
export const sourceTypeSchema = z.enum([
  "standardized_subgraph",
  "native_subgraph",
  "nuthatch_view",
]);

export const sourceFreshnessSchema = z
  .object({
    indexed_block: nonNegativeIntegerSchema,
    indexed_block_timestamp: nonNegativeIntegerSchema,
    indexed_block_hash: blockHashSchema.optional(),
    queried_at: nonNegativeIntegerSchema,
    has_indexing_errors: z.boolean().optional(),
  })
  .strict();

const nuthatchSourceFreshnessSchema = sourceFreshnessSchema.extend({
  indexed_block_hash: blockHashSchema,
});

export const sourceProvenanceSchema = z
  .object({
    deployment_or_view_id: nonEmptyStringSchema,
    schema_version: nonEmptyStringSchema.nullable(),
    methodology_version: nonEmptyStringSchema.nullable(),
    query_id: nonEmptyStringSchema,
  })
  .strict();

export const tokenMetadataSchema = z
  .object({
    address: ethereumAddressSchema,
    symbol: nonEmptyStringSchema,
    decimals: nonNegativeIntegerSchema,
  })
  .strict();

export const poolSourceDataSchema = z
  .object({
    pool_address: ethereumAddressSchema,
    token0: tokenMetadataSchema,
    token1: tokenMetadataSchema,
    fee_tier_bps: nonNegativeIntegerSchema.nullable(),
    tvl_usd: financialValueSchema,
    volume_usd_24h: financialValueSchema,
    volume_usd_7d: financialValueSchema,
    fees_usd_24h: financialValueSchema,
    fees_usd_7d: financialValueSchema,
  })
  .strict();

export const nuthatchFreshnessDataSchema = z
  .object({
    pool_address: ethereumAddressSchema,
    recent_swap_count_24h: nonNegativeIntegerSchema,
    last_swap_block: nonNegativeIntegerSchema,
    last_swap_block_timestamp: nonNegativeIntegerSchema,
    last_swap_block_hash: blockHashSchema,
    last_swap_tx_hash: blockHashSchema,
    last_swap_log_index: nonNegativeIntegerSchema,
  })
  .strict();

export type SourceStatus = z.infer<typeof sourceStatusSchema>;
export type FailureSourceStatus = z.infer<typeof failureSourceStatusSchema>;
export type SourceType = z.infer<typeof sourceTypeSchema>;
export type SourceFreshness = z.infer<typeof sourceFreshnessSchema>;
export type SourceProvenance = z.infer<typeof sourceProvenanceSchema>;
export type TokenMetadata = z.infer<typeof tokenMetadataSchema>;
export type PoolSourceData = z.infer<typeof poolSourceDataSchema>;
export type NuthatchFreshnessData = z.infer<typeof nuthatchFreshnessDataSchema>;

interface SourceResultBase {
  source_id: string;
  source_type: SourceType;
  protocol: string;
  chain_id: typeof BASE_CHAIN_ID;
  provenance: SourceProvenance;
  warnings: string[];
  latency_ms: number;
}

export interface SuccessfulSourceResult<T> extends SourceResultBase {
  status: "ok";
  data: T;
  freshness: SourceFreshness;
}

export interface FailedSourceResult extends SourceResultBase {
  status: FailureSourceStatus;
  data: null;
  freshness: SourceFreshness | null;
}

export type SourceResult<T> = SuccessfulSourceResult<T> | FailedSourceResult;

const sourceResultBaseShape = {
  source_id: nonEmptyStringSchema,
  protocol: nonEmptyStringSchema,
  chain_id: z.literal(BASE_CHAIN_ID),
  provenance: sourceProvenanceSchema,
  warnings: z.array(nonEmptyStringSchema),
  latency_ms: nonNegativeNumberSchema,
};

function createSourceResultSchema<
  TSourceType extends z.ZodType<SourceType>,
  TData extends z.ZodType,
  TFreshness extends z.ZodType,
>(sourceType: TSourceType, data: TData, freshness: TFreshness) {
  const successfulResultSchema = z
    .object({
      ...sourceResultBaseShape,
      source_type: sourceType,
      status: z.literal("ok"),
      data,
      freshness,
    })
    .strict();

  const failedResultSchema = z
    .object({
      ...sourceResultBaseShape,
      source_type: sourceType,
      status: failureSourceStatusSchema,
      data: z.null(),
      freshness: freshness.nullable(),
    })
    .strict();

  return z.discriminatedUnion("status", [successfulResultSchema, failedResultSchema]);
}

export const poolSourceResultSchema = createSourceResultSchema(
  z.enum(["standardized_subgraph", "native_subgraph"]),
  poolSourceDataSchema,
  sourceFreshnessSchema,
);

export const nuthatchSourceResultSchema = createSourceResultSchema(
  z.literal("nuthatch_view"),
  nuthatchFreshnessDataSchema,
  nuthatchSourceFreshnessSchema,
);

export type PoolSourceResult = z.infer<typeof poolSourceResultSchema>;
export type NuthatchSourceResult = z.infer<typeof nuthatchSourceResultSchema>;

/**
 * One lending market of a single input token on one protocol.
 *
 * Rates are percent APY exactly as the source reports them; a rate the source
 * does not publish stays `null` rather than being defaulted to zero, because
 * "no stable rate offered" and "a stable rate of 0%" are different facts.
 */
export const lendingMarketSourceDataSchema = z
  .object({
    market_id: ethereumAddressSchema,
    market_name: nonEmptyStringSchema.nullable(),
    input_token: tokenMetadataSchema,
    is_active: z.boolean(),
    can_borrow_from: z.boolean(),
    can_use_as_collateral: z.boolean(),
    tvl_usd: financialValueSchema,
    total_deposit_balance_usd: financialValueSchema,
    total_borrow_balance_usd: financialValueSchema,
    lender_variable_rate_percent: financialValueSchema,
    borrower_variable_rate_percent: financialValueSchema,
    borrower_stable_rate_percent: financialValueSchema,
  })
  .strict();

export const lendingMarketSourceResultSchema = createSourceResultSchema(
  z.enum(["standardized_subgraph", "native_subgraph"]),
  lendingMarketSourceDataSchema,
  sourceFreshnessSchema,
);

export type LendingMarketSourceData = z.infer<typeof lendingMarketSourceDataSchema>;
export type LendingMarketSourceResult = z.infer<typeof lendingMarketSourceResultSchema>;
