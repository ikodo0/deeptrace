import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { loadGatewayConfig, type GatewayConfig } from "../config/env.js";
import { RateLimitError } from "../errors/application-error.js";
import { FixedWindowRateLimiter } from "../gateway/index.js";
import {
  M0_CORE_POLICY,
  M0_LENDING_RANKING_METRICS,
  M0_RANKING_METRICS,
  M0_TIME_WINDOWS,
} from "../policy/index.js";
import {
  compareLendingResponseSchema,
  comparePoolsResponseSchema,
  coverageSchema,
  findLargeSwapsResponseSchema,
  largeSwapCoverageSchema,
  largeSwapPaginationSchema,
  largeSwapSearchDataSchema,
  lendingComparisonDataSchema,
  lendingCoverageSchema,
  poolComparisonDataSchema,
  resultFreshnessSchema,
  resultProvenanceSchema,
} from "../schemas/index.js";
import { BASE_CHAIN_ID } from "../schemas/source-adapter.js";
import { M0_COMPARE_POOLS_SCOPE } from "../scope/compare-pools.js";
import { LSS_SCOPE } from "../scope/large-swaps.js";
import {
  CompareLendingRequestError,
  ComparePoolsRequestError,
  FindLargeSwapsToolError,
  LargeSwapQueryError,
  createLiveCompareLendingSources,
  createLiveComparePoolsSources,
  createLiveLargeSwapSource,
  executeCompareLending,
  executeComparePools,
  executeFindLargeSwaps,
  type CompareLendingSourceGateway,
  type ComparePoolsSourceGateway,
  type LargeSwapSourceGateway,
} from "../tools/index.js";

export const serverInfo = {
  name: "deeptrace",
  version: "0.1.0",
} as const;

export const COMPARE_POOLS_TOOL_NAME = "compare_pools" as const;
export const COMPARE_LENDING_MARKETS_TOOL_NAME = "compare_lending_markets" as const;
export const FIND_LARGE_SWAPS_TOOL_NAME = "find_large_swaps" as const;

export const serverInstructions =
  "DeepTrace is read-only for locked Base (8453) scopes. Graph subgraphs supply pool financial metrics and lending rates; Nuthatch supplies independent freshness and large-swap receipts. Use compare_pools (WETH/USDC TVL/volume/fees), compare_lending_markets (USDC Aave v3/Seamless/Moonwell), and find_large_swaps (exact WETH/USDC threshold, never USD). Preserve decimal strings, status, warnings, freshness, source_ids, and provenance; never present partial results as complete or failed swap results as data.";

const comparePoolsInputSchema = z
  .object({
    chain_id: z.literal(BASE_CHAIN_ID).describe("Base mainnet chain ID; must be 8453."),
    token0: z
      .literal(M0_COMPARE_POOLS_SCOPE.token0.address)
      .describe("Native Base WETH address; this locked value is required."),
    token1: z
      .literal(M0_COMPARE_POOLS_SCOPE.token1.address)
      .describe("Native Base USDC address; this locked value is required."),
    window: z
      .enum(M0_TIME_WINDOWS)
      .optional()
      .describe("Metric window: 24h or 7d. Defaults to 24h."),
    ranked_by: z
      .enum(M0_RANKING_METRICS)
      .optional()
      .describe("Rank by Graph-reported tvl_usd, volume_usd, or fees_usd. Defaults to volume_usd."),
    top_n: z
      .number()
      .int()
      .min(1)
      .max(M0_CORE_POLICY.topN.maximum)
      .optional()
      .describe("Number of ranked pools to return, from 1 to 3. Defaults to 3."),
  })
  .strict();

const compareLendingInputSchema = z
  .object({
    chain_id: z.literal(BASE_CHAIN_ID).describe("Base mainnet chain ID; must be 8453."),
    market_token: z
      .literal(M0_CORE_POLICY.lending.marketToken)
      .describe("Native Base USDC address; this locked lending market token is required."),
    ranked_by: z
      .enum(M0_LENDING_RANKING_METRICS)
      .optional()
      .describe(
        "Rank by Graph-reported tvl_usd, deposit/borrow balances, or variable rates. Defaults to tvl_usd.",
      ),
    top_n: z
      .number()
      .int()
      .min(1)
      .max(M0_CORE_POLICY.lending.topN.maximum)
      .optional()
      .describe("Number of ranked markets to return, within the locked lending top_n bound."),
  })
  .strict();

const findLargeSwapsInputSchema = z
  .object({
    chain_id: z.literal(BASE_CHAIN_ID).describe("Base mainnet chain ID; must be 8453."),
    pool_address: z
      .literal(LSS_SCOPE.poolAddress)
      .describe("Locked Base Uniswap V3 WETH/USDC pool address."),
    threshold_token: z
      .union([z.literal(LSS_SCOPE.tokens.weth.address), z.literal(LSS_SCOPE.tokens.usdc.address)])
      .describe("WETH or native USDC address whose absolute pool delta is thresholded."),
    min_amount: z
      .string()
      .regex(/^(?:0\.\d*[1-9]\d*|[1-9]\d*(?:\.\d+)?)$/)
      .describe("Positive exact decimal threshold in human token units; never USD."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(LSS_SCOPE.limit.maximum)
      .optional()
      .describe("Page size from 1 to 100. Defaults to 25."),
    cursor: z
      .string()
      .min(1)
      .max(LSS_SCOPE.cursor.maximumLength)
      .nullable()
      .optional()
      .describe("Opaque next_cursor from a prior response; omit for the first page."),
  })
  .strict();

// The MCP SDK advertises and validates object-root output schemas. Keep the
// authoritative discriminated-union schema as the final refinement.
const comparePoolsOutputSchema = z
  .object({
    status: z.enum(["complete", "partial", "failed"]),
    data: poolComparisonDataSchema.nullable(),
    coverage: coverageSchema,
    freshness: z
      .array(resultFreshnessSchema)
      .length(M0_CORE_POLICY.coverage.expectedGraphResults + 1),
    provenance: z
      .array(resultProvenanceSchema)
      .length(M0_CORE_POLICY.coverage.expectedGraphResults + 1),
    warnings: z.array(z.string().min(1)),
    pagination: z.null(),
  })
  .strict()
  .superRefine((response, context) => {
    const validation = comparePoolsResponseSchema.safeParse(response);
    if (!validation.success) {
      context.addIssue({
        code: "custom",
        message: validation.error.message,
      });
    }
  });

const compareLendingOutputSchema = z
  .object({
    status: z.enum(["complete", "partial", "failed"]),
    data: lendingComparisonDataSchema.nullable(),
    coverage: lendingCoverageSchema,
    freshness: z
      .array(resultFreshnessSchema)
      .length(M0_CORE_POLICY.lending.coverage.expectedSources),
    provenance: z
      .array(resultProvenanceSchema)
      .length(M0_CORE_POLICY.lending.coverage.expectedSources),
    warnings: z.array(z.string().min(1)),
    pagination: z.null(),
  })
  .strict()
  .superRefine((response, context) => {
    const validation = compareLendingResponseSchema.safeParse(response);
    if (!validation.success) {
      context.addIssue({
        code: "custom",
        message: validation.error.message,
      });
    }
  });

const findLargeSwapsOutputSchema = z
  .object({
    status: z.enum(["complete", "failed"]),
    data: largeSwapSearchDataSchema.nullable(),
    coverage: largeSwapCoverageSchema,
    freshness: z.array(resultFreshnessSchema).length(1),
    provenance: z.array(resultProvenanceSchema).length(1),
    warnings: z.array(z.string().min(1)),
    pagination: largeSwapPaginationSchema,
  })
  .strict()
  .superRefine((response, context) => {
    const validation = findLargeSwapsResponseSchema.safeParse(response);
    if (!validation.success) {
      context.addIssue({
        code: "custom",
        message: validation.error.message,
      });
    }
  });

export interface CreateMcpServerOptions {
  readonly gatewayConfig?: GatewayConfig;
  readonly rateLimiter?: FixedWindowRateLimiter;
  readonly sources?: ComparePoolsSourceGateway;
  readonly lendingSources?: CompareLendingSourceGateway;
  readonly largeSwapSource?: LargeSwapSourceGateway;
  readonly rateLimitKey?: string;
  readonly lendingRateLimitKey?: string;
  readonly largeSwapRateLimitKey?: string;
}

function toolErrorResult(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}

export function createMcpServer(options: CreateMcpServerOptions = {}): McpServer {
  const gatewayConfig = options.gatewayConfig ?? loadGatewayConfig();
  const rateLimiter =
    options.rateLimiter ??
    new FixedWindowRateLimiter({
      maxRequests: gatewayConfig.rateLimitMaxRequests,
      windowMs: gatewayConfig.rateLimitWindowMs,
    });
  const sources =
    options.sources ??
    createLiveComparePoolsSources({
      timeoutMs: gatewayConfig.sourceTimeoutMs,
    });
  const lendingSources =
    options.lendingSources ??
    createLiveCompareLendingSources({
      timeoutMs: gatewayConfig.sourceTimeoutMs,
    });
  const largeSwapSource =
    options.largeSwapSource ??
    createLiveLargeSwapSource({
      timeoutMs: gatewayConfig.sourceTimeoutMs,
    });
  const rateLimitKey = options.rateLimitKey ?? "compare_pools";
  const lendingRateLimitKey = options.lendingRateLimitKey ?? COMPARE_LENDING_MARKETS_TOOL_NAME;
  const largeSwapRateLimitKey = options.largeSwapRateLimitKey ?? "find_large_swaps";

  const server = new McpServer(serverInfo, {
    instructions: serverInstructions,
  });

  server.registerTool(
    COMPARE_POOLS_TOOL_NAME,
    {
      title: "Compare Base WETH/USDC pools",
      description:
        "Rank the locked Base (chain 8453) native WETH/USDC pools by Graph-reported TVL, volume, or fees for 24h or 7d. Nuthatch adds independent freshness facts only. Read-only; preserve status, warnings, freshness, and provenance.",
      inputSchema: comparePoolsInputSchema,
      outputSchema: comparePoolsOutputSchema,
      annotations: {
        title: "Compare Base WETH/USDC pools",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const response = await rateLimiter.execute(rateLimitKey, () =>
          executeComparePools(args, sources),
        );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(response),
            },
          ],
          structuredContent: response,
        };
      } catch (error) {
        if (error instanceof RateLimitError) {
          return toolErrorResult(error.message);
        }
        if (error instanceof ComparePoolsRequestError) {
          return toolErrorResult(error.message);
        }
        const message = error instanceof Error ? error.message : "compare_pools failed.";
        return toolErrorResult(message);
      }
    },
  );

  server.registerTool(
    COMPARE_LENDING_MARKETS_TOOL_NAME,
    {
      title: "Compare lending markets",
      description:
        "Compare Base USDC lending markets across Aave v3, Seamless, and Moonwell Messari standardized subgraphs. Read-only; preserve status, warnings, freshness, and provenance.",
      inputSchema: compareLendingInputSchema,
      outputSchema: compareLendingOutputSchema,
      annotations: {
        title: "Compare lending markets",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const response = await rateLimiter.execute(lendingRateLimitKey, () =>
          executeCompareLending(args, lendingSources),
        );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(response),
            },
          ],
          structuredContent: response,
        };
      } catch (error) {
        if (error instanceof RateLimitError) {
          return toolErrorResult(error.message);
        }
        if (error instanceof CompareLendingRequestError) {
          return toolErrorResult(error.message);
        }
        const message = error instanceof Error ? error.message : "compare_lending_markets failed.";
        return toolErrorResult(message);
      }
    },
  );

  server.registerTool(
    FIND_LARGE_SWAPS_TOOL_NAME,
    {
      title: "Find large Base WETH/USDC swaps",
      description:
        "Return stable cursor pages of normalized swaps from the locked Base Uniswap V3 WETH/USDC pool. Filter by an exact WETH or USDC human-unit threshold; no USD conversion. Read-only; preserve status, warnings, freshness, and provenance.",
      inputSchema: findLargeSwapsInputSchema,
      outputSchema: findLargeSwapsOutputSchema,
      annotations: {
        title: "Find large Base WETH/USDC swaps",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const response = await rateLimiter.execute(largeSwapRateLimitKey, () =>
          executeFindLargeSwaps(args, largeSwapSource),
        );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(response),
            },
          ],
          structuredContent: response,
        };
      } catch (error) {
        if (error instanceof RateLimitError) {
          return toolErrorResult(error.message);
        }
        if (error instanceof LargeSwapQueryError || error instanceof FindLargeSwapsToolError) {
          return toolErrorResult(error.message);
        }
        return toolErrorResult("find_large_swaps failed.");
      }
    },
  );

  return server;
}
