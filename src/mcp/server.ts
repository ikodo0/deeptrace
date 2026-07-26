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
import { M0_COMPARE_POOLS_SCOPE } from "../scope/compare-pools.js";
import { BASE_CHAIN_ID } from "../schemas/source-adapter.js";
import {
  CompareLendingRequestError,
  ComparePoolsRequestError,
  createLiveCompareLendingSources,
  createLiveComparePoolsSources,
  executeCompareLending,
  executeComparePools,
  type CompareLendingSourceGateway,
  type ComparePoolsSourceGateway,
} from "../tools/index.js";

export const serverInfo = {
  name: "deeptrace",
  version: "0.1.0",
} as const;

export const COMPARE_POOLS_TOOL_NAME = "compare_pools" as const;

export const COMPARE_LENDING_MARKETS_TOOL_NAME = "compare_lending_markets" as const;

const comparePoolsInputSchema = z
  .object({
    chain_id: z.literal(BASE_CHAIN_ID),
    token0: z.literal(M0_COMPARE_POOLS_SCOPE.token0.address),
    token1: z.literal(M0_COMPARE_POOLS_SCOPE.token1.address),
    window: z.enum(M0_TIME_WINDOWS).optional(),
    ranked_by: z.enum(M0_RANKING_METRICS).optional(),
    top_n: z.number().int().min(1).max(M0_CORE_POLICY.topN.maximum).optional(),
  })
  .strict();

const compareLendingInputSchema = z
  .object({
    chain_id: z.literal(BASE_CHAIN_ID),
    market_token: z.literal(M0_CORE_POLICY.lending.marketToken),
    ranked_by: z.enum(M0_LENDING_RANKING_METRICS).optional(),
    top_n: z.number().int().min(1).max(M0_CORE_POLICY.lending.topN.maximum).optional(),
  })
  .strict();

export interface CreateMcpServerOptions {
  readonly gatewayConfig?: GatewayConfig;
  readonly rateLimiter?: FixedWindowRateLimiter;
  readonly sources?: ComparePoolsSourceGateway;
  readonly rateLimitKey?: string;
  readonly lendingSources?: CompareLendingSourceGateway;
  readonly lendingRateLimitKey?: string;
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
  const lendingSources =
    options.lendingSources ??
    createLiveCompareLendingSources({
      timeoutMs: gatewayConfig.sourceTimeoutMs,
    });
  const lendingRateLimitKey = options.lendingRateLimitKey ?? COMPARE_LENDING_MARKETS_TOOL_NAME;

  const server = new McpServer(serverInfo);

  server.registerTool(
    COMPARE_POOLS_TOOL_NAME,
    {
      title: "Compare pools",
      description:
        "Compare locked Base WETH/USDC pools across configured Graph sources. Read-only.",
      inputSchema: comparePoolsInputSchema,
      annotations: {
        title: "Compare pools",
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
        "Compare Base USDC lending markets across Aave v3, Seamless, and Moonwell Messari standardized subgraphs. Read-only.",
      inputSchema: compareLendingInputSchema,
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

  return server;
}
