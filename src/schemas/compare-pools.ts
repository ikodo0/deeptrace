import { z } from "zod";

import { M0_CORE_POLICY, M0_RANKING_METRICS, M0_TIME_WINDOWS } from "../policy/index.js";
import { BASE_CHAIN_ID, sourceTypeSchema } from "./source-adapter.js";

const nonEmptyStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim() === value, "Must not have leading or trailing whitespace");

const nonNegativeIntegerSchema = z.number().int().nonnegative();
const positiveIntegerSchema = z.number().int().positive();
const ethereumAddressSchema = z
  .string()
  .regex(/^0x[0-9a-f]{40}$/, "Expected a lowercase 20-byte hexadecimal address");
const blockHashSchema = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/, "Expected a lowercase 32-byte hexadecimal hash");
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

export const canonicalTokenSchema = z
  .object({
    chain_id: z.literal(BASE_CHAIN_ID),
    address: ethereumAddressSchema,
    symbol: nonEmptyStringSchema,
    decimals: nonNegativeIntegerSchema.max(255),
  })
  .strict();

function tokensEqual(
  left: z.infer<typeof canonicalTokenSchema>,
  right: z.infer<typeof canonicalTokenSchema>,
): boolean {
  return (
    left.chain_id === right.chain_id &&
    left.address === right.address &&
    left.symbol === right.symbol &&
    left.decimals === right.decimals
  );
}

export const canonicalPairSchema = z
  .tuple([canonicalTokenSchema, canonicalTokenSchema])
  .refine(([tokenA, tokenB]) => tokenA.address !== tokenB.address, "Pair tokens must differ");

export const poolComparisonRecordSchema = z
  .object({
    chain_id: z.literal(BASE_CHAIN_ID),
    protocol: nonEmptyStringSchema,
    pool_address: ethereumAddressSchema,
    pair: canonicalPairSchema,
    tvl_usd: financialValueSchema,
    volume_usd: financialValueSchema,
    fees_usd: financialValueSchema,
    window: z.enum(M0_TIME_WINDOWS),
    rank: positiveIntegerSchema.max(M0_CORE_POLICY.topN.maximum),
    source_ids: sourceIdsSchema,
  })
  .strict();

export const coverageSchema = z
  .object({
    requested_deployments: z.literal(M0_CORE_POLICY.coverage.expectedGraphResults),
    successful_deployments: nonNegativeIntegerSchema.max(
      M0_CORE_POLICY.coverage.expectedGraphResults,
    ),
    nuthatch_available: z.boolean(),
  })
  .strict();

const observedFreshnessSchema = z
  .object({
    source_id: nonEmptyStringSchema,
    status: z.enum(["fresh", "stale"]),
    indexed_block: nonNegativeIntegerSchema,
    indexed_block_timestamp: nonNegativeIntegerSchema,
    indexed_block_hash: blockHashSchema.nullable(),
    queried_at: nonNegativeIntegerSchema,
    lag_seconds: nonNegativeIntegerSchema,
  })
  .strict()
  .superRefine((freshness, context) => {
    if (
      freshness.queried_at < freshness.indexed_block_timestamp ||
      freshness.lag_seconds !== freshness.queried_at - freshness.indexed_block_timestamp
    ) {
      context.addIssue({
        code: "custom",
        message: "Lag seconds must equal query time minus indexed block time",
        path: ["lag_seconds"],
      });
    }

    const isQualityStale =
      freshness.lag_seconds > M0_CORE_POLICY.freshness.qualityStaleAfterSeconds;
    if (
      (freshness.status === "stale" && !isQualityStale) ||
      (freshness.status === "fresh" && isQualityStale)
    ) {
      context.addIssue({
        code: "custom",
        message: "Freshness status must match the core quality threshold",
        path: ["status"],
      });
    }
  });

const unavailableFreshnessSchema = z
  .object({
    source_id: nonEmptyStringSchema,
    status: z.literal("unavailable"),
  })
  .strict();

export const resultFreshnessSchema = z.discriminatedUnion("status", [
  observedFreshnessSchema,
  unavailableFreshnessSchema,
]);

export const resultProvenanceSchema = z
  .object({
    source_id: nonEmptyStringSchema,
    source_type: sourceTypeSchema,
    protocol: nonEmptyStringSchema,
    chain_id: z.literal(BASE_CHAIN_ID),
    deployment_or_view_id: nonEmptyStringSchema,
    schema_version: nonEmptyStringSchema.nullable(),
    methodology_version: nonEmptyStringSchema.nullable(),
    query_id: nonEmptyStringSchema,
  })
  .strict();

export const aiReasoningSchema = z
  .object({
    status: z.enum(["complete", "unavailable"]),
    summary: z.string(),
    highlights: z.array(nonEmptyStringSchema).max(M0_CORE_POLICY.reasoning.maximumHighlights),
    caveats: z.array(nonEmptyStringSchema).max(M0_CORE_POLICY.reasoning.maximumCaveats),
    source_ids: z.array(nonEmptyStringSchema).refine(hasUniqueValues, "Expected unique source IDs"),
  })
  .strict();

export const nuthatchFreshnessFactSchema = z
  .object({
    pool_address: ethereumAddressSchema,
    recent_swap_count_24h: nonNegativeIntegerSchema,
    last_swap_block: nonNegativeIntegerSchema,
    last_swap_block_timestamp: nonNegativeIntegerSchema,
    source_id: nonEmptyStringSchema,
  })
  .strict();

export const poolComparisonDataSchema = z
  .object({
    chain_id: z.literal(BASE_CHAIN_ID),
    pair: canonicalPairSchema,
    window: z.enum(M0_TIME_WINDOWS),
    ranked_by: z.enum(M0_RANKING_METRICS),
    pools: z
      .array(poolComparisonRecordSchema)
      .min(M0_CORE_POLICY.coverage.minimumGraphResultsForPartial)
      .max(M0_CORE_POLICY.topN.maximum),
    nuthatch_freshness_fact: nuthatchFreshnessFactSchema.nullable(),
  })
  .strict();

const responseQualityShape = {
  coverage: coverageSchema,
  freshness: z
    .array(resultFreshnessSchema)
    .length(M0_CORE_POLICY.coverage.expectedGraphResults + 1)
    .refine(
      (entries) => hasUniqueValues(entries.map(({ source_id }) => source_id)),
      "Expected one freshness entry per source",
    ),
  provenance: z
    .array(resultProvenanceSchema)
    .length(M0_CORE_POLICY.coverage.expectedGraphResults + 1)
    .refine(
      (entries) => hasUniqueValues(entries.map(({ source_id }) => source_id)),
      "Expected one provenance entry per source",
    ),
  warnings: z.array(nonEmptyStringSchema),
  pagination: z.null(),
  ai_reasoning: aiReasoningSchema,
};

const successfulResponseSchema = (status: "complete" | "partial") =>
  z
    .object({
      status: z.literal(status),
      data: poolComparisonDataSchema,
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

export const comparePoolsResponseSchema = z
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
    const provenanceById = new Map(
      response.provenance.map((provenance) => [provenance.source_id, provenance]),
    );
    const referencedIds = [
      ...response.freshness.map(({ source_id }) => source_id),
      ...response.ai_reasoning.source_ids,
    ];
    const graphSourceCount = response.provenance.filter(
      ({ source_type }) => source_type !== "nuthatch_view",
    ).length;
    const nuthatchSourceCount = response.provenance.length - graphSourceCount;

    if (
      graphSourceCount !== M0_CORE_POLICY.coverage.expectedGraphResults ||
      nuthatchSourceCount !== 1
    ) {
      context.addIssue({
        code: "custom",
        message: "Provenance must contain three Graph sources and one Nuthatch source",
        path: ["provenance"],
      });
    }

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

    for (const freshness of response.freshness) {
      if (
        freshness.status !== "unavailable" &&
        provenanceById.get(freshness.source_id)?.source_type === "nuthatch_view" &&
        freshness.indexed_block_hash === null
      ) {
        context.addIssue({
          code: "custom",
          message: "Observed Nuthatch freshness requires an indexed block hash",
          path: ["freshness"],
        });
        break;
      }
    }

    if (response.data !== null) {
      referencedIds.push(
        ...response.data.pools.flatMap(({ source_ids }) => source_ids),
        ...(response.data.nuthatch_freshness_fact === null
          ? []
          : [response.data.nuthatch_freshness_fact.source_id]),
      );

      if (response.coverage.successful_deployments !== response.data.pools.length) {
        context.addIssue({
          code: "custom",
          message: "Successful deployment count must equal the number of pool records",
          path: ["coverage", "successful_deployments"],
        });
      }

      for (const [index, pool] of response.data.pools.entries()) {
        if (
          pool.rank !== index + 1 ||
          pool.window !== response.data.window ||
          !tokensEqual(pool.pair[0], response.data.pair[0]) ||
          !tokensEqual(pool.pair[1], response.data.pair[1])
        ) {
          context.addIssue({
            code: "custom",
            message: "Pool records must match response pair, window, and rank order",
            path: ["data", "pools", index],
          });
        }

        if (
          pool.source_ids.some(
            (sourceId) =>
              provenanceById.get(sourceId)?.source_type === "nuthatch_view" ||
              freshnessById.get(sourceId)?.status === "unavailable",
          )
        ) {
          context.addIssue({
            code: "custom",
            message: "Pool financial records must reference observed Graph sources",
            path: ["data", "pools", index, "source_ids"],
          });
        }
      }

      if (
        response.coverage.nuthatch_available !==
        (response.data.nuthatch_freshness_fact !== null)
      ) {
        context.addIssue({
          code: "custom",
          message: "Nuthatch coverage must match freshness fact availability",
          path: ["coverage", "nuthatch_available"],
        });
      }

      const hasDegradedCoverage =
        response.coverage.successful_deployments < M0_CORE_POLICY.coverage.expectedGraphResults ||
        (M0_CORE_POLICY.coverage.requiresNuthatchForComplete &&
          !response.coverage.nuthatch_available) ||
        response.freshness.some(({ status }) => status !== "fresh");

      if (response.status === "complete" && hasDegradedCoverage) {
        context.addIssue({
          code: "custom",
          message: "Complete responses require full fresh Graph and Nuthatch coverage",
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
    } else if (response.coverage.successful_deployments !== 0) {
      context.addIssue({
        code: "custom",
        message: "Failed responses cannot report successful deployments",
        path: ["coverage", "successful_deployments"],
      });
    }

    for (const sourceId of referencedIds) {
      if (!provenanceIds.has(sourceId)) {
        context.addIssue({
          code: "custom",
          message: "Referenced source ID must exist in provenance",
          path: ["provenance"],
        });
        break;
      }
    }

    const nuthatchIds = new Set(
      response.provenance
        .filter(({ source_type }) => source_type === "nuthatch_view")
        .map(({ source_id }) => source_id),
    );
    const nuthatchSourceId = [...nuthatchIds][0];
    const nuthatchFreshness =
      nuthatchSourceId === undefined ? undefined : freshnessById.get(nuthatchSourceId);
    const nuthatchFact = response.data === null ? null : response.data.nuthatch_freshness_fact;

    if (
      nuthatchFact !== null &&
      (!nuthatchIds.has(nuthatchFact.source_id) ||
        freshnessById.get(nuthatchFact.source_id)?.status === "unavailable")
    ) {
      context.addIssue({
        code: "custom",
        message: "Nuthatch fact must reference an observed Nuthatch source",
        path: ["data", "nuthatch_freshness_fact", "source_id"],
      });
    }

    if (
      response.data !== null &&
      ((nuthatchFreshness?.status === "fresh" && nuthatchFact === null) ||
        (nuthatchFreshness?.status === "unavailable" && nuthatchFact !== null))
    ) {
      context.addIssue({
        code: "custom",
        message: "Nuthatch fact availability must match Nuthatch freshness",
        path: ["data", "nuthatch_freshness_fact"],
      });
    }

    if (
      response.data === null &&
      response.coverage.nuthatch_available !==
        (nuthatchFreshness !== undefined && nuthatchFreshness.status !== "unavailable")
    ) {
      context.addIssue({
        code: "custom",
        message: "Failed response Nuthatch coverage must match observed freshness",
        path: ["coverage", "nuthatch_available"],
      });
    }
  });

export type CanonicalToken = z.infer<typeof canonicalTokenSchema>;
export type CanonicalPair = z.infer<typeof canonicalPairSchema>;
export type PoolComparisonRecord = z.infer<typeof poolComparisonRecordSchema>;
export type Coverage = z.infer<typeof coverageSchema>;
export type ResultFreshness = z.infer<typeof resultFreshnessSchema>;
export type ResultProvenance = z.infer<typeof resultProvenanceSchema>;
export type AiReasoning = z.infer<typeof aiReasoningSchema>;
export type NuthatchFreshnessFact = z.infer<typeof nuthatchFreshnessFactSchema>;
export type PoolComparisonData = z.infer<typeof poolComparisonDataSchema>;
export type ComparePoolsResponse = z.infer<typeof comparePoolsResponseSchema>;
