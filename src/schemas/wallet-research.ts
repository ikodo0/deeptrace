import { z } from "zod";

import {
  WALLET_RESEARCH_SCOPE,
  WALLET_RESEARCH_SECTIONS,
  WALLET_RESEARCH_WINDOWS,
} from "../scope/wallet-research.js";
import { resultFreshnessSchema, resultProvenanceSchema } from "./compare-pools.js";
import { BASE_CHAIN_ID } from "./source-adapter.js";

const nonEmptyStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim() === value, "Must not have surrounding whitespace");
const addressSchema = z.string().regex(/^0x[0-9a-f]{40}$/);
const hashSchema = z.string().regex(/^0x[0-9a-f]{64}$/);
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const nonNegativeDecimalSchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
const rawAmountSchema = z.string().regex(/^(?:0|[1-9]\d*)$/);
const sourceIdsSchema = z
  .array(nonEmptyStringSchema)
  .min(1)
  .refine((values) => new Set(values).size === values.length, "Source IDs must be unique");

export const walletAssetLegSchema = z
  .object({
    token_address: addressSchema,
    symbol: nonEmptyStringSchema,
    decimals: nonNegativeIntegerSchema.max(255),
    role: z.enum(["swap_in", "swap_out", "supplied", "collateral", "borrowed"]),
    raw_amount: rawAmountSchema,
    normalized_amount: nonNegativeDecimalSchema,
    usd_price: nonNegativeDecimalSchema.nullable(),
    usd_value: nonNegativeDecimalSchema.nullable(),
  })
  .strict();

export const walletActivitySchema = z
  .object({
    id: nonEmptyStringSchema,
    chain_id: z.literal(BASE_CHAIN_ID),
    wallet_address: addressSchema,
    protocol: z.literal(WALLET_RESEARCH_SCOPE.nuthatch.protocol),
    activity_type: z.enum(["swap_sent", "swap_received"]),
    transaction_hash: hashSchema,
    log_index: nonNegativeIntegerSchema,
    block_number: nonNegativeIntegerSchema,
    timestamp: nonNegativeIntegerSchema,
    counterparty: addressSchema.nullable(),
    assets: z.array(walletAssetLegSchema).length(2),
    source_id: z.literal(WALLET_RESEARCH_SCOPE.nuthatch.sourceId),
  })
  .strict();

export const defiPositionSchema = z
  .object({
    id: nonEmptyStringSchema,
    chain_id: z.literal(BASE_CHAIN_ID),
    protocol: z.literal(WALLET_RESEARCH_SCOPE.graph.protocol),
    position_type: z.enum(["lending_supply", "lending_collateral", "lending_borrow"]),
    container: z
      .object({
        address: addressSchema,
        name: nonEmptyStringSchema.nullable(),
      })
      .strict(),
    assets: z.array(walletAssetLegSchema).length(1),
    valuation: z
      .object({
        usd_value: nonNegativeDecimalSchema.nullable(),
      })
      .strict(),
    observed_at: z
      .object({
        block_number: nonNegativeIntegerSchema,
        timestamp: nonNegativeIntegerSchema,
      })
      .strict(),
    source_ids: sourceIdsSchema,
  })
  .strict();

const observedAssetSchema = z
  .object({
    token_address: addressSchema,
    symbol: nonEmptyStringSchema,
    decimals: nonNegativeIntegerSchema.max(255),
    source_ids: sourceIdsSchema,
  })
  .strict();

const counterpartySchema = z
  .object({
    address: addressSchema,
    interaction_count: z.number().int().positive(),
    source_ids: sourceIdsSchema,
  })
  .strict();

const protocolUsageSchema = z
  .object({
    protocol: nonEmptyStringSchema,
    activity_count: nonNegativeIntegerSchema,
    position_count: nonNegativeIntegerSchema,
    source_ids: sourceIdsSchema,
  })
  .strict();

const observableFlowSchema = z
  .object({
    direction: z.enum(["inflow", "outflow"]),
    token_address: addressSchema,
    symbol: nonEmptyStringSchema,
    raw_amount: rawAmountSchema,
    normalized_amount: nonNegativeDecimalSchema,
    source_ids: sourceIdsSchema,
  })
  .strict();

export const walletResearchDataSchema = z
  .object({
    chain_id: z.literal(BASE_CHAIN_ID),
    wallet_address: addressSchema,
    window: z.enum(WALLET_RESEARCH_WINDOWS),
    requested_sections: z.array(z.enum(WALLET_RESEARCH_SECTIONS)).min(1),
    activity: z.array(walletActivitySchema).max(WALLET_RESEARCH_SCOPE.limit.maximum),
    counterparties: z.array(counterpartySchema),
    protocol_usage: z.array(protocolUsageSchema),
    observable_flows: z.array(observableFlowSchema),
    observed_assets: z.array(observedAssetSchema),
    positions: z.array(defiPositionSchema).max(WALLET_RESEARCH_SCOPE.limit.maximum),
  })
  .strict();

const sectionCoverageSchema = z
  .object({
    section: z.enum(WALLET_RESEARCH_SECTIONS),
    requested: z.boolean(),
    status: z.enum(["complete", "partial", "unavailable", "unsupported", "not_requested"]),
    source_ids: z.array(nonEmptyStringSchema),
  })
  .strict();

export const walletResearchCoverageSchema = z
  .object({
    requested_sources: z.literal(2),
    successful_sources: z.number().int().min(0).max(2),
    sections: z.array(sectionCoverageSchema).length(WALLET_RESEARCH_SECTIONS.length),
  })
  .strict();

export const walletResearchPaginationSchema = z
  .object({
    limit: z.number().int().min(1).max(WALLET_RESEARCH_SCOPE.limit.maximum),
    returned: z.number().int().min(0).max(WALLET_RESEARCH_SCOPE.limit.maximum),
    has_more: z.boolean(),
    next_cursor: z.string().min(1).max(WALLET_RESEARCH_SCOPE.cursor.maximumLength).nullable(),
  })
  .strict()
  .refine((page) => page.has_more === (page.next_cursor !== null), {
    message: "next_cursor must be present exactly when has_more is true",
    path: ["next_cursor"],
  });

const qualityShape = {
  coverage: walletResearchCoverageSchema,
  freshness: z.array(resultFreshnessSchema).length(2),
  provenance: z.array(resultProvenanceSchema).length(2),
  warnings: z.array(nonEmptyStringSchema),
  pagination: walletResearchPaginationSchema,
};

export const researchWalletResponseSchema = z
  .discriminatedUnion("status", [
    z
      .object({
        status: z.literal("complete"),
        data: walletResearchDataSchema,
        ...qualityShape,
      })
      .strict(),
    z
      .object({
        status: z.literal("partial"),
        data: walletResearchDataSchema,
        ...qualityShape,
      })
      .strict(),
    z
      .object({
        status: z.literal("failed"),
        data: z.null(),
        ...qualityShape,
      })
      .strict(),
  ])
  .superRefine((response, context) => {
    if (response.pagination.returned !== (response.data?.activity.length ?? 0)) {
      context.addIssue({
        code: "custom",
        message: "Pagination returned count must equal activity length",
        path: ["pagination", "returned"],
      });
    }
    if (response.status === "complete" && response.coverage.successful_sources !== 2) {
      context.addIssue({
        code: "custom",
        message: "Complete wallet research requires two successful sources",
        path: ["status"],
      });
    }
    if (response.status === "failed" && response.coverage.successful_sources !== 0) {
      context.addIssue({
        code: "custom",
        message: "Failed wallet research cannot report successful sources",
        path: ["coverage", "successful_sources"],
      });
    }
  });

export type WalletAssetLeg = z.infer<typeof walletAssetLegSchema>;
export type WalletActivity = z.infer<typeof walletActivitySchema>;
export type DeFiPosition = z.infer<typeof defiPositionSchema>;
export type WalletResearchData = z.infer<typeof walletResearchDataSchema>;
export type WalletResearchCoverage = z.infer<typeof walletResearchCoverageSchema>;
export type WalletResearchPagination = z.infer<typeof walletResearchPaginationSchema>;
export type ResearchWalletResponse = z.infer<typeof researchWalletResponseSchema>;
