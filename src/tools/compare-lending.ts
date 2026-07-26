import { z } from "zod";

import { M0_CORE_POLICY } from "../policy/index.js";
import { rankLendingMarkets } from "../metrics/index.js";
import { settleCompareLendingResult } from "../quality/index.js";
import {
  compareLendingRequestSchema,
  type CompareLendingRequest,
  type CompareLendingRequestInput,
} from "../schemas/compare-lending-request.js";
import {
  compareLendingResponseSchema,
  type CompareLendingResponse,
  type LendingToken,
} from "../schemas/compare-lending.js";
import { M0_COMPARE_LENDING_SCOPE } from "../scope/compare-lending.js";

import type { CompareLendingSourceGateway } from "./compare-lending-sources.js";

export class CompareLendingRequestError extends Error {
  constructor(message = "Invalid compare_lending_markets request.") {
    super(message);
    this.name = "CompareLendingRequestError";
  }
}

export class CompareLendingToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompareLendingToolError";
  }
}

function lockedMarketToken(): LendingToken {
  return {
    chain_id: M0_COMPARE_LENDING_SCOPE.chainId,
    address: M0_COMPARE_LENDING_SCOPE.marketToken.address,
    symbol: M0_COMPARE_LENDING_SCOPE.marketToken.symbol,
    decimals: M0_COMPARE_LENDING_SCOPE.marketToken.decimals,
  };
}

/**
 * Validate a public request, fetch injected sources, rank, and settle.
 * Does not register MCP transport concerns (rate limits belong to the tool wrapper).
 */
export async function executeCompareLending(
  rawRequest: CompareLendingRequestInput,
  sources: CompareLendingSourceGateway,
): Promise<CompareLendingResponse> {
  let request: CompareLendingRequest;
  try {
    request = compareLendingRequestSchema.parse(rawRequest);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new CompareLendingRequestError();
    }
    throw error;
  }

  const sourceResults = await sources.fetchLendingResults(request);

  const markets = rankLendingMarkets(sourceResults, {
    rankedBy: request.ranked_by,
    topN: request.top_n,
  });

  const response = settleCompareLendingResult({
    marketToken: lockedMarketToken(),
    rankedBy: request.ranked_by,
    markets,
    sourceResults,
  });

  let validated: CompareLendingResponse;
  try {
    validated = compareLendingResponseSchema.parse(response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new CompareLendingToolError(
        "compare_lending_markets response failed schema validation.",
      );
    }
    throw error;
  }

  const encoded = JSON.stringify(validated);
  if (Buffer.byteLength(encoded, "utf8") > M0_CORE_POLICY.gateway.maximumResponseBytes) {
    throw new CompareLendingToolError(
      "compare_lending_markets response exceeded the maximum response size.",
    );
  }

  return validated;
}

export type { CompareLendingRequest, CompareLendingRequestInput };
