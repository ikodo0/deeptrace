import { z } from "zod";

import { M0_CORE_POLICY } from "../policy/index.js";
import { rankCanonicalPools } from "../metrics/index.js";
import { bindComparePoolsGraphResults } from "../normalization/index.js";
import { settleComparePoolsResult } from "../quality/index.js";
import {
  comparePoolsRequestSchema,
  type ComparePoolsRequest,
  type ComparePoolsRequestInput,
} from "../schemas/compare-pools-request.js";
import {
  comparePoolsResponseSchema,
  type CanonicalPair,
  type ComparePoolsResponse,
} from "../schemas/compare-pools.js";
import { M0_COMPARE_POOLS_SCOPE } from "../scope/compare-pools.js";

import type { ComparePoolsSourceGateway } from "./compare-pools-sources.js";

export class ComparePoolsRequestError extends Error {
  constructor(message = "Invalid compare_pools request.") {
    super(message);
    this.name = "ComparePoolsRequestError";
  }
}

export class ComparePoolsToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComparePoolsToolError";
  }
}

function lockedPair(): CanonicalPair {
  return [
    {
      chain_id: M0_COMPARE_POOLS_SCOPE.chainId,
      address: M0_COMPARE_POOLS_SCOPE.token0.address,
      symbol: M0_COMPARE_POOLS_SCOPE.token0.symbol,
      decimals: M0_COMPARE_POOLS_SCOPE.token0.decimals,
    },
    {
      chain_id: M0_COMPARE_POOLS_SCOPE.chainId,
      address: M0_COMPARE_POOLS_SCOPE.token1.address,
      symbol: M0_COMPARE_POOLS_SCOPE.token1.symbol,
      decimals: M0_COMPARE_POOLS_SCOPE.token1.decimals,
    },
  ];
}

/**
 * Validate a public request, fetch injected sources, normalize, rank, and settle.
 * Does not register MCP transport concerns (rate limits belong to the tool wrapper).
 */
export async function executeComparePools(
  rawRequest: ComparePoolsRequestInput,
  sources: ComparePoolsSourceGateway,
): Promise<ComparePoolsResponse> {
  let request: ComparePoolsRequest;
  try {
    request = comparePoolsRequestSchema.parse(rawRequest);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ComparePoolsRequestError();
    }
    throw error;
  }

  const graphPromise = sources.fetchGraphResults(request);
  const nuthatchPromise = sources.fetchNuthatchResult(request);
  const [graphResults, nuthatchResult] = await Promise.all([graphPromise, nuthatchPromise]);

  const candidates = bindComparePoolsGraphResults(graphResults, request.window);
  const pools = rankCanonicalPools(candidates, {
    rankedBy: request.ranked_by,
    topN: request.top_n,
  });

  const response = settleComparePoolsResult({
    pair: lockedPair(),
    window: request.window,
    rankedBy: request.ranked_by,
    pools,
    graphResults,
    nuthatchResult,
  });

  let validated: ComparePoolsResponse;
  try {
    validated = comparePoolsResponseSchema.parse(response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ComparePoolsToolError("compare_pools response failed schema validation.");
    }
    throw error;
  }

  const encoded = JSON.stringify(validated);
  if (Buffer.byteLength(encoded, "utf8") > M0_CORE_POLICY.gateway.maximumResponseBytes) {
    throw new ComparePoolsToolError("compare_pools response exceeded the maximum response size.");
  }

  return validated;
}

export type { ComparePoolsRequest, ComparePoolsRequestInput };
