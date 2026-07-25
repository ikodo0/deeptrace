import { z } from "zod";

import {
  BASE_CHAIN_ID,
  type NuthatchFreshnessData,
  type PoolSourceData,
  type SourceProvenance,
  type TokenMetadata,
} from "./source-adapter.js";

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

const transactionHashSchema = blockHashSchema;

const nonNegativeDecimalStringSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, "Expected a non-negative decimal string");

const financialValueSchema = nonNegativeDecimalStringSchema.nullable();

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
  .strict() satisfies z.ZodType<SourceProvenance>;

export const tokenMetadataSchema = z
  .object({
    address: ethereumAddressSchema,
    symbol: nonEmptyStringSchema,
    decimals: nonNegativeIntegerSchema,
  })
  .strict() satisfies z.ZodType<TokenMetadata>;

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
  .strict() satisfies z.ZodType<PoolSourceData>;

export const nuthatchFreshnessDataSchema = z
  .object({
    pool_address: ethereumAddressSchema,
    recent_swap_count_24h: nonNegativeIntegerSchema,
    last_swap_block: nonNegativeIntegerSchema,
    last_swap_block_timestamp: nonNegativeIntegerSchema,
    last_swap_block_hash: blockHashSchema,
    last_swap_tx_hash: transactionHashSchema,
    last_swap_log_index: nonNegativeIntegerSchema,
  })
  .strict() satisfies z.ZodType<NuthatchFreshnessData>;

const sourceResultBaseShape = {
  source_id: nonEmptyStringSchema,
  protocol: nonEmptyStringSchema,
  chain_id: z.literal(BASE_CHAIN_ID),
  provenance: sourceProvenanceSchema,
  warnings: z.array(nonEmptyStringSchema),
  latency_ms: nonNegativeNumberSchema,
};

function createSourceResultSchema<
  TSourceType extends z.ZodType<"standardized_subgraph" | "native_subgraph" | "nuthatch_view">,
  TData extends z.ZodType,
  TFreshness extends z.ZodType,
>(sourceTypeSchema: TSourceType, dataSchema: TData, freshnessSchema: TFreshness) {
  const successfulResultSchema = z
    .object({
      ...sourceResultBaseShape,
      source_type: sourceTypeSchema,
      status: z.literal("ok"),
      data: dataSchema,
      freshness: freshnessSchema,
    })
    .strict();

  const failedResultSchema = z
    .object({
      ...sourceResultBaseShape,
      source_type: sourceTypeSchema,
      status: z.enum(["timeout", "error", "unsupported", "stale"]),
      data: z.null(),
      freshness: freshnessSchema.nullable(),
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
