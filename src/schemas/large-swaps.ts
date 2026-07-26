import { z } from "zod";

import { LSS_SCOPE } from "../scope/large-swaps.js";
import { resultFreshnessSchema, resultProvenanceSchema } from "./compare-pools.js";
import { BASE_CHAIN_ID } from "./source-adapter.js";

const nonEmptyStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim() === value, "Must not have leading or trailing whitespace");

const nonNegativeIntegerSchema = z.number().int().nonnegative();
const transactionHashSchema = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/, "Expected a lowercase 32-byte hexadecimal hash");
const positiveDecimalStringSchema = z
  .string()
  .regex(/^(?:0\.\d*[1-9]\d*|[1-9]\d*(?:\.\d+)?)$/, "Expected a positive decimal string");
const signedIntegerStringSchema = z
  .string()
  .regex(/^(?:0|-?[1-9]\d*)$/, "Expected a signed base-10 integer string");
const opaqueCursorSchema = z
  .string()
  .min(1)
  .max(LSS_SCOPE.cursor.maximumLength)
  .refine((value) => value.trim() === value, "Cursor must not contain surrounding whitespace");

const wethAssetSchema = z
  .object({
    chain_id: z.literal(BASE_CHAIN_ID),
    address: z.literal(LSS_SCOPE.tokens.weth.address),
    symbol: z.literal(LSS_SCOPE.tokens.weth.symbol),
    decimals: z.literal(LSS_SCOPE.tokens.weth.decimals),
  })
  .strict();

const usdcAssetSchema = z
  .object({
    chain_id: z.literal(BASE_CHAIN_ID),
    address: z.literal(LSS_SCOPE.tokens.usdc.address),
    symbol: z.literal(LSS_SCOPE.tokens.usdc.symbol),
    decimals: z.literal(LSS_SCOPE.tokens.usdc.decimals),
  })
  .strict();

export const lssAssetSchema = z.union([wethAssetSchema, usdcAssetSchema]);

export const swapEventSchema = z
  .object({
    chain_id: z.literal(BASE_CHAIN_ID),
    protocol: z.literal(LSS_SCOPE.protocol),
    pool: z.literal(LSS_SCOPE.poolAddress),
    transaction_hash: transactionHashSchema,
    log_index: nonNegativeIntegerSchema,
    block_number: nonNegativeIntegerSchema,
    timestamp: nonNegativeIntegerSchema,
    asset_in: lssAssetSchema,
    asset_out: lssAssetSchema,
    amount_in: positiveDecimalStringSchema,
    amount_out: positiveDecimalStringSchema,
    amount_in_raw: signedIntegerStringSchema.optional(),
    amount_out_raw: signedIntegerStringSchema.optional(),
    usd_notional: z.null(),
    source_id: nonEmptyStringSchema,
  })
  .strict()
  .refine((event) => event.asset_in.address !== event.asset_out.address, {
    message: "Swap input and output assets must differ",
    path: ["asset_out"],
  });

function eventIdentity(event: z.infer<typeof swapEventSchema>): string {
  return `${event.chain_id}:${event.transaction_hash}:${String(event.log_index)}`;
}

const swapEventsSchema = z
  .array(swapEventSchema)
  .max(LSS_SCOPE.limit.maximum)
  .refine(
    (events) => new Set(events.map(eventIdentity)).size === events.length,
    "Expected unique swap event identities",
  );

export const largeSwapSearchDataSchema = z
  .object({
    chain_id: z.literal(BASE_CHAIN_ID),
    pool_address: z.literal(LSS_SCOPE.poolAddress),
    threshold_token: z.union([
      z.literal(LSS_SCOPE.tokens.weth.address),
      z.literal(LSS_SCOPE.tokens.usdc.address),
    ]),
    min_amount: positiveDecimalStringSchema,
    swaps: swapEventsSchema,
  })
  .strict();

export const largeSwapCoverageSchema = z
  .object({
    requested_sources: z.literal(1),
    successful_sources: z.union([z.literal(0), z.literal(1)]),
  })
  .strict();

export const largeSwapPaginationSchema = z
  .object({
    limit: z.number().int().min(1).max(LSS_SCOPE.limit.maximum),
    returned: z.number().int().min(0).max(LSS_SCOPE.limit.maximum),
    has_more: z.boolean(),
    next_cursor: opaqueCursorSchema.nullable(),
  })
  .strict()
  .superRefine((pagination, context) => {
    if (pagination.returned > pagination.limit) {
      context.addIssue({
        code: "custom",
        message: "Returned count cannot exceed the page limit",
        path: ["returned"],
      });
    }

    if (pagination.has_more !== (pagination.next_cursor !== null)) {
      context.addIssue({
        code: "custom",
        message: "A next cursor is required exactly when more results are available",
        path: ["next_cursor"],
      });
    }
  });

const responseQualityShape = {
  coverage: largeSwapCoverageSchema,
  freshness: z.array(resultFreshnessSchema).length(1),
  provenance: z.array(resultProvenanceSchema).length(1),
  warnings: z.array(nonEmptyStringSchema),
  pagination: largeSwapPaginationSchema,
};

const completeResponseSchema = z
  .object({
    status: z.literal("complete"),
    data: largeSwapSearchDataSchema,
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

export const findLargeSwapsResponseSchema = z
  .discriminatedUnion("status", [completeResponseSchema, failedResponseSchema])
  .superRefine((response, context) => {
    const freshness = response.freshness[0];
    const provenance = response.provenance[0];

    if (
      freshness === undefined ||
      provenance === undefined ||
      freshness.source_id !== provenance.source_id
    ) {
      context.addIssue({
        code: "custom",
        message: "Freshness and provenance must describe the same source",
        path: ["freshness"],
      });
      return;
    }

    if (provenance.source_type !== "nuthatch_view") {
      context.addIssue({
        code: "custom",
        message: "Large Swap Search requires Nuthatch provenance",
        path: ["provenance"],
      });
    }

    if (freshness.status !== "unavailable" && freshness.indexed_block_hash === null) {
      context.addIssue({
        code: "custom",
        message: "Observed Nuthatch freshness requires an indexed block hash",
        path: ["freshness"],
      });
    }

    if (response.status === "complete") {
      if (response.coverage.successful_sources !== 1 || freshness.status !== "fresh") {
        context.addIssue({
          code: "custom",
          message: "Complete responses require one fresh successful source",
          path: ["coverage"],
        });
      }

      if (response.pagination.returned !== response.data.swaps.length) {
        context.addIssue({
          code: "custom",
          message: "Returned count must equal the number of swaps",
          path: ["pagination", "returned"],
        });
      }

      if (response.data.swaps.some(({ source_id }) => source_id !== provenance.source_id)) {
        context.addIssue({
          code: "custom",
          message: "Every swap must reference the response provenance source",
          path: ["data", "swaps"],
        });
      }
    } else {
      if (
        response.coverage.successful_sources !== 0 ||
        freshness.status !== "unavailable" ||
        response.pagination.returned !== 0 ||
        response.pagination.has_more ||
        response.pagination.next_cursor !== null
      ) {
        context.addIssue({
          code: "custom",
          message: "Failed responses cannot report source success or page results",
          path: ["status"],
        });
      }

      if (response.warnings.length === 0) {
        context.addIssue({
          code: "custom",
          message: "Failed responses require an explicit warning",
          path: ["warnings"],
        });
      }
    }
  });

export type LssAsset = z.infer<typeof lssAssetSchema>;
export type SwapEvent = z.infer<typeof swapEventSchema>;
export type LargeSwapSearchData = z.infer<typeof largeSwapSearchDataSchema>;
export type LargeSwapCoverage = z.infer<typeof largeSwapCoverageSchema>;
export type LargeSwapPagination = z.infer<typeof largeSwapPaginationSchema>;
export type FindLargeSwapsResponse = z.infer<typeof findLargeSwapsResponseSchema>;
