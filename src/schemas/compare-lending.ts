import { z } from "zod";

import { M0_CORE_POLICY, M0_LENDING_RANKING_METRICS } from "../policy/index.js";
import { resultFreshnessSchema, resultProvenanceSchema } from "./compare-pools.js";
import { BASE_CHAIN_ID } from "./source-adapter.js";

const nonEmptyStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim() === value, "Must not have leading or trailing whitespace");

const nonNegativeIntegerSchema = z.number().int().nonnegative();
const positiveIntegerSchema = z.number().int().positive();
const ethereumAddressSchema = z
  .string()
  .regex(/^0x[0-9a-f]{40}$/, "Expected a lowercase 20-byte hexadecimal address");
const financialValueSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, "Expected a non-negative decimal string")
  .nullable();

function hasUniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

const sourceIdsSchema = z
  .array(nonEmptyStringSchema)
  .min(1)
  .refine(hasUniqueValues, "Expected unique source IDs");

const lendingTokenSchema = z
  .object({
    chain_id: z.literal(BASE_CHAIN_ID),
    address: ethereumAddressSchema,
    symbol: nonEmptyStringSchema,
    decimals: nonNegativeIntegerSchema.max(255),
  })
  .strict();

export const lendingMarketRecordSchema = z
  .object({
    chain_id: z.literal(BASE_CHAIN_ID),
    protocol: nonEmptyStringSchema,
    market_id: ethereumAddressSchema,
    market_name: nonEmptyStringSchema.nullable(),
    input_token: lendingTokenSchema,
    is_active: z.boolean(),
    can_borrow_from: z.boolean(),
    can_use_as_collateral: z.boolean(),
    tvl_usd: financialValueSchema,
    total_deposit_balance_usd: financialValueSchema,
    total_borrow_balance_usd: financialValueSchema,
    lender_variable_rate_percent: financialValueSchema,
    borrower_variable_rate_percent: financialValueSchema,
    borrower_stable_rate_percent: financialValueSchema,
    rank: positiveIntegerSchema.max(M0_CORE_POLICY.lending.topN.maximum),
    source_ids: sourceIdsSchema,
  })
  .strict();

export const lendingCoverageSchema = z
  .object({
    requested_sources: z.literal(M0_CORE_POLICY.lending.coverage.expectedSources),
    successful_sources: nonNegativeIntegerSchema.max(
      M0_CORE_POLICY.lending.coverage.expectedSources,
    ),
  })
  .strict();

export const lendingComparisonDataSchema = z
  .object({
    chain_id: z.literal(BASE_CHAIN_ID),
    market_token: lendingTokenSchema,
    ranked_by: z.enum(M0_LENDING_RANKING_METRICS),
    /**
     * Rates are republished exactly as each protocol reports them, so the unit
     * is stated rather than converted.
     */
    rate_basis: z.literal("percent_apy"),
    markets: z
      .array(lendingMarketRecordSchema)
      .min(M0_CORE_POLICY.lending.coverage.minimumSourcesForPartial)
      .max(M0_CORE_POLICY.lending.topN.maximum),
  })
  .strict();

const responseQualityShape = {
  coverage: lendingCoverageSchema,
  freshness: z
    .array(resultFreshnessSchema)
    .length(M0_CORE_POLICY.lending.coverage.expectedSources)
    .refine(
      (entries) => hasUniqueValues(entries.map(({ source_id }) => source_id)),
      "Expected one freshness entry per source",
    ),
  provenance: z
    .array(resultProvenanceSchema)
    .length(M0_CORE_POLICY.lending.coverage.expectedSources)
    .refine(
      (entries) => hasUniqueValues(entries.map(({ source_id }) => source_id)),
      "Expected one provenance entry per source",
    ),
  warnings: z.array(nonEmptyStringSchema),
  pagination: z.null(),
};

const successfulResponseSchema = (status: "complete" | "partial") =>
  z
    .object({
      status: z.literal(status),
      data: lendingComparisonDataSchema,
      ...responseQualityShape,
    })
    .strict();

const failedResponseSchema = z
  .object({
    status: z.literal("failed"),
    data: z.null(),
    ...responseQualityShape,
  })
  .strict();

export const compareLendingResponseSchema = z
  .discriminatedUnion("status", [
    successfulResponseSchema("complete"),
    successfulResponseSchema("partial"),
    failedResponseSchema,
  ])
  .superRefine((response, context) => {
    const provenanceIds = new Set(response.provenance.map(({ source_id }) => source_id));
    const freshnessIds = new Set(response.freshness.map(({ source_id }) => source_id));
    const freshnessById = new Map(
      response.freshness.map((freshness) => [freshness.source_id, freshness]),
    );

    if (
      provenanceIds.size !== freshnessIds.size ||
      [...provenanceIds].some((sourceId) => !freshnessIds.has(sourceId))
    ) {
      context.addIssue({
        code: "custom",
        message: "Every provenance source must have one freshness entry",
        path: ["freshness"],
      });
    }

    if (response.data === null) {
      if (response.coverage.successful_sources !== 0) {
        context.addIssue({
          code: "custom",
          message: "Failed responses cannot report successful sources",
          path: ["coverage", "successful_sources"],
        });
      }
      return;
    }

    if (response.coverage.successful_sources !== response.data.markets.length) {
      context.addIssue({
        code: "custom",
        message: "Successful source count must equal the number of market records",
        path: ["coverage", "successful_sources"],
      });
    }

    for (const [index, market] of response.data.markets.entries()) {
      if (market.rank !== index + 1) {
        context.addIssue({
          code: "custom",
          message: "Market records must be ordered by ascending rank starting at one",
          path: ["data", "markets", index, "rank"],
        });
      }

      if (
        market.source_ids.some(
          (sourceId) =>
            !provenanceIds.has(sourceId) || freshnessById.get(sourceId)?.status === "unavailable",
        )
      ) {
        context.addIssue({
          code: "custom",
          message: "Market records must reference observed sources present in provenance",
          path: ["data", "markets", index, "source_ids"],
        });
      }
    }

    const hasDegradedCoverage =
      response.coverage.successful_sources < M0_CORE_POLICY.lending.coverage.expectedSources ||
      response.freshness.some(({ status }) => status !== "fresh");

    if (response.status === "complete" && hasDegradedCoverage) {
      context.addIssue({
        code: "custom",
        message: "Complete responses require every source to be successful and fresh",
        path: ["status"],
      });
    }

    if (response.status === "partial" && !hasDegradedCoverage) {
      context.addIssue({
        code: "custom",
        message: "Partial responses require missing, stale, or unavailable coverage",
        path: ["status"],
      });
    }

    if (response.status === "partial" && response.warnings.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Partial responses require an explicit warning",
        path: ["warnings"],
      });
    }
  });

export type LendingToken = z.infer<typeof lendingTokenSchema>;
export type LendingMarketRecord = z.infer<typeof lendingMarketRecordSchema>;
export type LendingCoverage = z.infer<typeof lendingCoverageSchema>;
export type LendingComparisonData = z.infer<typeof lendingComparisonDataSchema>;
export type CompareLendingResponse = z.infer<typeof compareLendingResponseSchema>;
