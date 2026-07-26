import { M0_CORE_POLICY } from "../../policy/index.js";
import type { NuthatchSourceRegistryRecord } from "../../registry/types.js";
import type { ResultFreshness, ResultProvenance, SwapEvent } from "../../schemas/index.js";
import { BASE_CHAIN_ID } from "../../schemas/source-adapter.js";
import { LSS_SCOPE } from "../../scope/large-swaps.js";
import {
  deduplicateSwapEvents,
  normalizeLssSwapEvent,
  NormalizationError,
  swapMeetsTokenThreshold,
} from "../../normalization/index.js";
import type {
  LargeSwapSourceFailureStatus,
  LargeSwapSourceResult,
} from "../../tools/large-swaps-source.js";
import type { LargeSwapQueryContext } from "../../tools/large-swaps-query.js";

import type { NuthatchClient, NuthatchHttpResult } from "./client.js";
import {
  buildLargeSwapHeadQuery,
  buildLargeSwapScanQuery,
  NUTHATCH_LARGE_SWAP_QUERY_ID,
  NUTHATCH_LARGE_SWAP_VIEW,
} from "./large-swaps-query.js";
import {
  parseLargeSwapReady,
  parseLargeSwapReceipt,
  type NuthatchLargeSwapRow,
} from "./large-swaps-response.js";
import { parseNest, parseSchema } from "./response.js";

export interface NuthatchLargeSwapAdapterDeps {
  readonly client: NuthatchClient;
  readonly clock: () => number;
  readonly record: NuthatchSourceRegistryRecord;
}

function provenanceFor(
  record: NuthatchSourceRegistryRecord,
  observedViewId = record.deployment_or_view_id,
  schemaVersion: string | null = record.schema_version,
): ResultProvenance {
  return {
    source_id: record.source_id,
    source_type: record.source_type,
    protocol: record.protocol,
    chain_id: BASE_CHAIN_ID,
    deployment_or_view_id: observedViewId,
    schema_version: schemaVersion,
    methodology_version: record.methodology_version,
    query_id: NUTHATCH_LARGE_SWAP_QUERY_ID,
  };
}

export function largeSwapSourceProvenance(record: NuthatchSourceRegistryRecord): ResultProvenance {
  return provenanceFor(record);
}

function failed(
  record: NuthatchSourceRegistryRecord,
  status: LargeSwapSourceFailureStatus,
  warning: string,
  options: {
    readonly observedViewId?: string;
    readonly schemaVersion?: string | null;
  } = {},
): LargeSwapSourceResult {
  return {
    status,
    events: null,
    indexedHead: null,
    freshness: {
      source_id: record.source_id,
      status: "unavailable",
    },
    provenance: provenanceFor(
      record,
      options.observedViewId ?? record.deployment_or_view_id,
      options.schemaVersion === undefined ? record.schema_version : options.schemaVersion,
    ),
    warnings: [warning],
  };
}

export function createLargeSwapSourceFailure(
  record: NuthatchSourceRegistryRecord,
  status: LargeSwapSourceFailureStatus,
  warning: string,
): LargeSwapSourceResult {
  return failed(record, status, warning);
}

function httpFailureStatus(result: Extract<NuthatchHttpResult, { ok: false }>) {
  return result.error.kind === "timeout" ? ("timeout" as const) : ("error" as const);
}

function rowPosition(row: NuthatchLargeSwapRow) {
  return {
    block_number: row.block_number,
    log_index: row.log_index,
    transaction_hash: row.transaction_hash,
  };
}

function normalizeRow(row: NuthatchLargeSwapRow, sourceId: string) {
  return normalizeLssSwapEvent({
    chain_id: BASE_CHAIN_ID,
    protocol: LSS_SCOPE.protocol,
    pool: row.pool_address,
    transaction_hash: row.transaction_hash,
    log_index: row.log_index,
    block_number: row.block_number,
    timestamp: row.block_timestamp,
    amount0_raw: row.amount0_raw,
    amount1_raw: row.amount1_raw,
    source_id: sourceId,
  });
}

function validateRecord(record: NuthatchSourceRegistryRecord): string | null {
  if (
    record.source_id !== LSS_SCOPE.source.sourceId ||
    record.source_type !== "nuthatch_view" ||
    record.protocol !== LSS_SCOPE.protocol ||
    record.chain_id !== BASE_CHAIN_ID ||
    record.status !== "active" ||
    record.locator.kind !== "nuthatch_view" ||
    record.locator.view_id !== NUTHATCH_LARGE_SWAP_VIEW ||
    !record.supported_entities.includes(NUTHATCH_LARGE_SWAP_VIEW) ||
    record.methodology_version !== LSS_SCOPE.source.methodologyVersion
  ) {
    return `Registry record is not the active ${NUTHATCH_LARGE_SWAP_VIEW} capability.`;
  }
  return null;
}

async function metadata(deps: NuthatchLargeSwapAdapterDeps): Promise<
  | {
      readonly ok: true;
      readonly indexedHead: number;
      readonly observedViewId: string;
      readonly schemaVersion: string | null;
    }
  | { readonly ok: false; readonly result: LargeSwapSourceResult }
> {
  const readyResult = await deps.client.ready();
  if (!readyResult.ok) {
    return {
      ok: false,
      result: failed(
        deps.record,
        readyResult.status === 503 ? "stale" : httpFailureStatus(readyResult),
        readyResult.status === 503
          ? "Nuthatch is not ready to serve a stable large-swap snapshot."
          : readyResult.error.message,
      ),
    };
  }
  const ready = parseLargeSwapReady(readyResult.body);
  if (ready === null) {
    return {
      ok: false,
      result: failed(deps.record, "unsupported", "Nuthatch /ready response shape is unsupported."),
    };
  }
  if (!ready.ready) {
    return {
      ok: false,
      result: failed(deps.record, "stale", "Nuthatch is not ready to serve large swaps."),
    };
  }

  const [nestResult, schemaResult] = await Promise.all([deps.client.nest(), deps.client.schema()]);
  if (!nestResult.ok) {
    return {
      ok: false,
      result: failed(deps.record, httpFailureStatus(nestResult), nestResult.error.message),
    };
  }
  const nest = parseNest(nestResult.body);
  if (!nest.ok) {
    return {
      ok: false,
      result: failed(deps.record, "unsupported", nest.failure.message),
    };
  }
  if (nest.registryHash !== deps.record.deployment_or_view_id) {
    return {
      ok: false,
      result: failed(
        deps.record,
        "unsupported",
        "Nuthatch registry hash does not match the configured large-swap capability.",
        { observedViewId: nest.registryHash },
      ),
    };
  }

  if (!schemaResult.ok) {
    return {
      ok: false,
      result: failed(deps.record, httpFailureStatus(schemaResult), schemaResult.error.message, {
        observedViewId: nest.registryHash,
      }),
    };
  }
  const schema = parseSchema(schemaResult.body);
  if (!schema.ok) {
    return {
      ok: false,
      result: failed(deps.record, "unsupported", schema.failure.message, {
        observedViewId: nest.registryHash,
      }),
    };
  }

  return {
    ok: true,
    indexedHead: ready.indexedHead,
    observedViewId: nest.registryHash,
    schemaVersion: schema.schemaVersion,
  };
}

/**
 * Reads a stable, bounded keyset window from the allowlisted swap-search view.
 * It scans until enough exact post-normalization matches exist for one page
 * plus lookahead, or until the source is exhausted.
 */
export async function fetchNuthatchLargeSwapCandidates(
  deps: NuthatchLargeSwapAdapterDeps,
  context: LargeSwapQueryContext,
): Promise<LargeSwapSourceResult> {
  const startedAt = performance.now();
  const deadlineExceeded = () =>
    performance.now() - startedAt >= M0_CORE_POLICY.gateway.endToEndTimeoutMs;
  const invalidRecord = validateRecord(deps.record);
  if (invalidRecord !== null) {
    return failed(deps.record, "unsupported", invalidRecord);
  }

  try {
    const meta = await metadata(deps);
    if (!meta.ok) {
      return meta.result;
    }
    if (deadlineExceeded()) {
      return failed(deps.record, "timeout", "Large-swap source deadline expired.", {
        observedViewId: meta.observedViewId,
        schemaVersion: meta.schemaVersion,
      });
    }

    const headResult = await deps.client.sql(buildLargeSwapHeadQuery(meta.indexedHead), 1);
    if (!headResult.ok) {
      return failed(deps.record, httpFailureStatus(headResult), headResult.error.message, {
        observedViewId: meta.observedViewId,
        schemaVersion: meta.schemaVersion,
      });
    }
    const headReceipt = parseLargeSwapReceipt(headResult.body, deps.record.deployment_or_view_id);
    if (headReceipt === null) {
      return failed(deps.record, "unsupported", "Large-swap head receipt is invalid.", {
        observedViewId: meta.observedViewId,
        schemaVersion: meta.schemaVersion,
      });
    }
    const head = headReceipt.rows[0];
    if (head === undefined || headReceipt.rows.length !== 1) {
      return failed(
        deps.record,
        "unsupported",
        "Large-swap head receipt must contain exactly one event.",
        {
          observedViewId: meta.observedViewId,
          schemaVersion: meta.schemaVersion,
        },
      );
    }

    // The cursor freezes the latest searchable swap. The /ready indexed head
    // bounds every query but does not expose a block hash or timestamp.
    const currentHead = head.block_number;
    const snapshotHead = context.snapshotHead ?? currentHead;
    if (snapshotHead > currentHead || snapshotHead > meta.indexedHead) {
      return failed(
        deps.record,
        "unsupported",
        "Large-swap source is behind the cursor snapshot.",
        {
          observedViewId: meta.observedViewId,
          schemaVersion: meta.schemaVersion,
        },
      );
    }

    const queriedAt = deps.clock();
    const lagSeconds = queriedAt - head.block_timestamp;
    if (!Number.isSafeInteger(queriedAt) || queriedAt < 0 || lagSeconds < 0) {
      return failed(deps.record, "unsupported", "Large-swap source freshness is invalid.", {
        observedViewId: meta.observedViewId,
        schemaVersion: meta.schemaVersion,
      });
    }
    if (lagSeconds > M0_CORE_POLICY.freshness.qualityStaleAfterSeconds) {
      return failed(deps.record, "stale", "Large-swap source is stale.", {
        observedViewId: meta.observedViewId,
        schemaVersion: meta.schemaVersion,
      });
    }

    const freshness: Extract<ResultFreshness, { status: "fresh" | "stale" }> & {
      readonly status: "fresh";
    } = {
      source_id: deps.record.source_id,
      status: "fresh",
      indexed_block: currentHead,
      indexed_block_timestamp: head.block_timestamp,
      indexed_block_hash: head.block_hash,
      queried_at: queriedAt,
      lag_seconds: lagSeconds,
    };

    const requiredMatches = context.request.limit + 1 + (context.lastEvent === null ? 0 : 1);
    let after = context.lastEvent;
    let includeAfter = context.lastEvent !== null;
    let scanned = 0;
    let normalized: SwapEvent[] = [];

    for (;;) {
      if (deadlineExceeded()) {
        return failed(deps.record, "timeout", "Large-swap source deadline expired.", {
          observedViewId: meta.observedViewId,
          schemaVersion: meta.schemaVersion,
        });
      }
      if (scanned >= LSS_SCOPE.scan.maximumRows) {
        return failed(
          deps.record,
          "error",
          "Large-swap bounded scan reached its safety ceiling before proving page completion.",
          {
            observedViewId: meta.observedViewId,
            schemaVersion: meta.schemaVersion,
          },
        );
      }
      const queryLimit = Math.min(LSS_SCOPE.scan.batchSize, LSS_SCOPE.scan.maximumRows - scanned);
      const query = buildLargeSwapScanQuery({
        snapshotHead,
        after,
        includeAfter,
        limit: queryLimit,
      });
      const pageResult = await deps.client.sql(query, queryLimit);
      if (!pageResult.ok) {
        return failed(deps.record, httpFailureStatus(pageResult), pageResult.error.message, {
          observedViewId: meta.observedViewId,
          schemaVersion: meta.schemaVersion,
        });
      }
      const receipt = parseLargeSwapReceipt(pageResult.body, deps.record.deployment_or_view_id);
      if (receipt === null || receipt.asOf < snapshotHead || receipt.rows.length > queryLimit) {
        return failed(deps.record, "unsupported", "Large-swap page receipt is invalid.", {
          observedViewId: meta.observedViewId,
          schemaVersion: meta.schemaVersion,
        });
      }

      scanned += receipt.rows.length;
      let matches: SwapEvent[];
      try {
        normalized = deduplicateSwapEvents([
          ...normalized,
          ...receipt.rows.map((row) => normalizeRow(row, deps.record.source_id)),
        ]);
        matches = normalized.filter((event) =>
          swapMeetsTokenThreshold(
            event,
            context.request.threshold_token,
            context.request.min_amount,
          ),
        );
      } catch (error) {
        if (error instanceof NormalizationError) {
          return failed(
            deps.record,
            "unsupported",
            "Large-swap receipt violates canonical swap semantics.",
            {
              observedViewId: meta.observedViewId,
              schemaVersion: meta.schemaVersion,
            },
          );
        }
        throw error;
      }
      if (matches.length >= requiredMatches || receipt.rows.length < queryLimit) {
        return {
          status: "ok",
          events: matches,
          indexedHead: currentHead,
          freshness,
          provenance: provenanceFor(deps.record, meta.observedViewId, meta.schemaVersion),
          warnings: [],
        };
      }

      const last = receipt.rows.at(-1);
      if (last === undefined) {
        return {
          status: "ok",
          events: matches,
          indexedHead: currentHead,
          freshness,
          provenance: provenanceFor(deps.record, meta.observedViewId, meta.schemaVersion),
          warnings: [],
        };
      }
      after = rowPosition(last);
      includeAfter = false;
    }
  } catch {
    return failed(
      deps.record,
      "error",
      "Large-swap adapter failed unexpectedly; details were redacted.",
    );
  }
}
