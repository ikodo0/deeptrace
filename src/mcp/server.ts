import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { loadGatewayConfig, type GatewayConfig } from "../config/env.js";
import { RateLimitError } from "../errors/application-error.js";
import { FixedWindowRateLimiter } from "../gateway/index.js";
import { M0_CORE_POLICY, M0_RANKING_METRICS, M0_TIME_WINDOWS } from "../policy/index.js";
import {
  comparePoolsResponseSchema,
  coverageSchema,
  poolComparisonDataSchema,
  resultFreshnessSchema,
  resultProvenanceSchema,
} from "../schemas/index.js";
import { BASE_CHAIN_ID } from "../schemas/source-adapter.js";
import { M0_COMPARE_POOLS_SCOPE } from "../scope/compare-pools.js";
import {
  ComparePoolsRequestError,
  createLiveComparePoolsSources,
  executeComparePools,
  type ComparePoolsSourceGateway,
} from "../tools/index.js";

export const serverInfo = {
  name: "deeptrace",
  version: "0.1.0",
} as const;

export const COMPARE_POOLS_TOOL_NAME = "compare_pools" as const;

export const serverInstructions =
  "DeepTrace is read-only and supports only the locked Base (chain 8453) native WETH/USDC pair. Use compare_pools for 24h or 7d rankings by TVL, volume, or fees. Graph subgraphs supply pool financial metrics; Nuthatch supplies independent indexed-block and recent-swap freshness facts, never financial values. Always report status and warnings, distinguish stale or unavailable sources, cite source_ids with provenance, and never present partial results as complete.";

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

export interface CreateMcpServerOptions {
  readonly gatewayConfig?: GatewayConfig;
  readonly rateLimiter?: FixedWindowRateLimiter;
  readonly sources?: ComparePoolsSourceGateway;
  readonly rateLimitKey?: string;
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
  const rateLimitKey = options.rateLimitKey ?? "compare_pools";

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

  return server;
}
