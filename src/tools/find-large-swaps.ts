import { z } from "zod";

import { M0_CORE_POLICY } from "../policy/index.js";
import {
  findLargeSwapsResponseSchema,
  type FindLargeSwapsRequestInput,
  type FindLargeSwapsResponse,
} from "../schemas/index.js";
import { LSS_SCOPE } from "../scope/large-swaps.js";

import {
  inspectLargeSwapQuery,
  queryLargeSwapPage,
  type LargeSwapQueryPage,
} from "./large-swaps-query.js";
import type {
  LargeSwapSourceFailure,
  LargeSwapSourceGateway,
  LargeSwapSourceSuccess,
} from "./large-swaps-source.js";

const RESPONSE_BUDGET_WARNING =
  "Page was shortened below the requested limit to preserve the response-size budget.";

export class FindLargeSwapsToolError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FindLargeSwapsToolError";
  }
}

function failedResponse(
  request: ReturnType<typeof inspectLargeSwapQuery>["request"],
  source: Pick<LargeSwapSourceFailure, "freshness" | "provenance" | "warnings">,
): FindLargeSwapsResponse {
  return findLargeSwapsResponseSchema.parse({
    status: "failed",
    data: null,
    coverage: {
      requested_sources: 1,
      successful_sources: 0,
    },
    freshness: [source.freshness],
    provenance: [source.provenance],
    warnings: [...source.warnings],
    pagination: {
      limit: request.limit,
      returned: 0,
      has_more: false,
      next_cursor: null,
    },
  });
}

function assertResponseSize(response: FindLargeSwapsResponse): void {
  if (
    Buffer.byteLength(JSON.stringify(response), "utf8") >
    M0_CORE_POLICY.gateway.maximumResponseBytes
  ) {
    throw new FindLargeSwapsToolError(
      "find_large_swaps response exceeded the maximum response size.",
    );
  }
}

function completeResponse(
  request: ReturnType<typeof inspectLargeSwapQuery>["request"],
  source: LargeSwapSourceSuccess,
  page: LargeSwapQueryPage,
  shortened: boolean,
): FindLargeSwapsResponse {
  return findLargeSwapsResponseSchema.parse({
    status: "complete",
    data: {
      chain_id: LSS_SCOPE.chainId,
      pool_address: LSS_SCOPE.poolAddress,
      threshold_token: request.threshold_token,
      min_amount: request.min_amount,
      swaps: page.swaps,
    },
    coverage: {
      requested_sources: 1,
      successful_sources: 1,
    },
    freshness: [source.freshness],
    provenance: [source.provenance],
    warnings: shortened ? [...source.warnings, RESPONSE_BUDGET_WARNING] : [...source.warnings],
    pagination: {
      ...page.pagination,
      limit: request.limit,
    },
  });
}

/**
 * Validates the request, obtains one bounded source window, applies the stable
 * page engine, and settles the sole-source quality envelope.
 */
export async function executeFindLargeSwaps(
  rawRequest: FindLargeSwapsRequestInput,
  source: LargeSwapSourceGateway,
): Promise<FindLargeSwapsResponse> {
  const context = inspectLargeSwapQuery(rawRequest);

  let sourceResult;
  try {
    sourceResult = await source.fetchCandidates(context);
  } catch {
    sourceResult = {
      status: "error" as const,
      events: null,
      indexedHead: null,
      freshness: {
        source_id: source.provenance.source_id,
        status: "unavailable" as const,
      },
      provenance: source.provenance,
      warnings: ["Large-swap source failed unexpectedly; details were redacted."],
    };
  }

  if (sourceResult.status !== "ok") {
    const response = failedResponse(context.request, sourceResult);
    assertResponseSize(response);
    return response;
  }

  try {
    for (let pageSize = context.request.limit; pageSize >= 1; pageSize -= 1) {
      const page = queryLargeSwapPage({
        events: sourceResult.events,
        indexedHead: sourceResult.indexedHead,
        request: {
          ...context.request,
          limit: pageSize,
        },
      });
      const response = completeResponse(
        context.request,
        sourceResult,
        page,
        pageSize < context.request.limit,
      );
      if (
        Buffer.byteLength(JSON.stringify(response), "utf8") <=
        M0_CORE_POLICY.gateway.maximumResponseBytes
      ) {
        return response;
      }
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new FindLargeSwapsToolError("find_large_swaps response failed schema validation.", {
        cause: error,
      });
    }
    throw error;
  }

  throw new FindLargeSwapsToolError(
    "find_large_swaps could not fit one event within the maximum response size.",
  );
}
