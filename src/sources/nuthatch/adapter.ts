import type { NuthatchSourceRegistryRecord } from "../../registry/types.js";
import {
  BASE_CHAIN_ID,
  type FailureSourceStatus,
  type NuthatchFreshnessData,
  type NuthatchSourceResult,
  type SourceProvenance,
} from "../../schemas/source-adapter.js";

import type { NuthatchClient, NuthatchHttpResult } from "./client.js";
import {
  NUTHATCH_FRESHNESS_QUERY,
  NUTHATCH_FRESHNESS_QUERY_ID,
  NUTHATCH_FRESHNESS_VIEW,
} from "./freshness-query.js";
import {
  parseFreshnessRows,
  parseNest,
  parseSchema,
  type FreshnessParseResult,
  type NestParseResult,
  type SchemaParseResult,
} from "./response.js";

export interface NuthatchAdapterDeps {
  readonly client: NuthatchClient;
  /** Epoch-second clock; inject for deterministic tests. */
  readonly clock: () => number;
  readonly record: NuthatchSourceRegistryRecord;
}

interface CallFailure {
  readonly status: FailureSourceStatus;
  readonly warning: string;
}

function provenanceFor(
  record: NuthatchSourceRegistryRecord,
  observedViewId: string,
  schemaVersion: string | null,
): SourceProvenance {
  return {
    deployment_or_view_id: observedViewId,
    schema_version: schemaVersion,
    methodology_version: record.methodology_version,
    query_id: NUTHATCH_FRESHNESS_QUERY_ID,
  };
}

function failedResult(
  record: NuthatchSourceRegistryRecord,
  status: Extract<NuthatchSourceResult, { data: null }>["status"],
  options: {
    readonly warnings: readonly string[];
    readonly latencyMs: number;
    readonly freshness: NuthatchFreshness | null;
    readonly observedViewId?: string;
    readonly schemaVersion?: string | null;
  },
): NuthatchSourceResult {
  return {
    source_id: record.source_id,
    source_type: record.source_type,
    protocol: record.protocol,
    chain_id: BASE_CHAIN_ID,
    status,
    data: null,
    freshness: options.freshness,
    provenance: provenanceFor(
      record,
      options.observedViewId ?? record.deployment_or_view_id,
      options.schemaVersion ?? record.schema_version,
    ),
    warnings: [...options.warnings],
    latency_ms: options.latencyMs,
  };
}

/**
 * Builds a contract-valid Nuthatch failure with registry-backed provenance.
 * Live gateway setup failures use this rather than dropping the source or
 * inventing a freshness observation.
 */
export function createNuthatchFailureResult(
  record: NuthatchSourceRegistryRecord,
  status: Extract<NuthatchSourceResult, { data: null }>["status"],
  warning: string,
): NuthatchSourceResult {
  return failedResult(record, status, {
    warnings: [warning],
    latencyMs: 0,
    freshness: null,
  });
}

function classifyHttpFailure(result: NuthatchHttpErr): FailureSourceStatus {
  if (result.error.kind === "timeout") {
    return "timeout";
  }
  return "error";
}

type NuthatchHttpErr = Extract<NuthatchHttpResult, { ok: false }>;

function classifySqlFailure(result: NuthatchHttpErr): FailureSourceStatus {
  return classifyHttpFailure(result);
}

function classifyMetadataFailure(result: NuthatchHttpErr): FailureSourceStatus {
  return classifyHttpFailure(result);
}

/**
 * Freshness shape required on every Nuthatch result: the indexed block hash is
 * mandatory (the frozen `nuthatchSourceFreshnessSchema` re-asserts it as
 * non-optional). The base `SourceFreshness` type leaves it optional, so this
 * alias carries the stricter requirement through the adapter.
 */
interface NuthatchFreshness {
  readonly indexed_block: number;
  readonly indexed_block_timestamp: number;
  readonly indexed_block_hash: string;
  readonly queried_at: number;
  readonly has_indexing_errors?: boolean;
}

function deriveFreshness(row: NuthatchFreshnessData, queriedAt: number): NuthatchFreshness {
  return {
    indexed_block: row.last_swap_block,
    indexed_block_timestamp: row.last_swap_block_timestamp,
    indexed_block_hash: row.last_swap_block_hash,
    queried_at: queriedAt,
  };
}

function precedence(statuses: readonly FailureSourceStatus[]): FailureSourceStatus {
  if (statuses.includes("timeout")) {
    return "timeout";
  }
  if (statuses.includes("unsupported")) {
    return "unsupported";
  }
  return "error";
}

/**
 * Queries the Nuthatch freshness view and maps every operational or shape
 * failure into a contract-valid {@link NuthatchSourceResult}. No exception
 * escapes this boundary; a programmer-unexpected throw becomes `error`.
 */
export async function fetchNuthatchFreshness(
  deps: NuthatchAdapterDeps,
): Promise<NuthatchSourceResult> {
  const startedAt = performance.now();
  const { client, clock, record } = deps;

  const totalLatency = () => Math.round(performance.now() - startedAt);

  try {
    if (
      record.source_type !== "nuthatch_view" ||
      record.chain_id !== BASE_CHAIN_ID ||
      record.status !== "active" ||
      record.locator.kind !== "nuthatch_view" ||
      record.locator.view_id !== NUTHATCH_FRESHNESS_VIEW
    ) {
      return failedResult(record, "unsupported", {
        warnings: [
          `Registry record is not an active nuthatch_view bound to ${NUTHATCH_FRESHNESS_VIEW}.`,
        ],
        latencyMs: totalLatency(),
        freshness: null,
      });
    }

    const ready = await client.ready();

    if (!ready.ok) {
      if (ready.status === 503) {
        // Readiness 503 takes precedence: still call /sql once for last-known
        // freshness, then return stale regardless of SQL outcome.
        const sql = await client.sql(NUTHATCH_FRESHNESS_QUERY, 1);
        let freshness: NuthatchFreshness | null = null;
        if (sql.ok) {
          const parsed = parseFreshnessRows(sql.body);
          if (parsed.ok) {
            freshness = deriveFreshness(parsed.row, clock());
          }
        }
        return failedResult(record, "stale", {
          warnings: [
            "/ready returned HTTP 503; freshness retained from last-known /sql row when available.",
          ],
          latencyMs: totalLatency(),
          freshness,
        });
      }

      const status = classifyHttpFailure(ready);
      return failedResult(record, status, {
        warnings: [ready.error.message],
        latencyMs: totalLatency(),
        freshness: null,
      });
    }

    const [nest, schema, sql] = await Promise.all([
      client.nest(),
      client.schema(),
      client.sql(NUTHATCH_FRESHNESS_QUERY, 1),
    ]);

    const queriedAt = clock();

    // Parse each response. Failures are tracked as outcomes with precedence
    // timeout > unsupported > error. Freshness is retained only from a valid
    // /sql row, even on a non-ok aggregate status.
    let observedViewId = record.deployment_or_view_id;
    let schemaVersion: string | null = record.schema_version;
    const outcomes: CallFailure[] = [];
    const warnings: string[] = [];

    // /nest
    const nestOutcome = evaluateNest(nest, record);
    if (nestOutcome.status !== "ok") {
      outcomes.push({ status: nestOutcome.status, warning: nestOutcome.warning });
    }
    if (nestOutcome.warning !== "") {
      warnings.push(nestOutcome.warning);
    }
    if (nest.ok) {
      const parsed = parseNest(nest.body);
      if (parsed.ok) {
        observedViewId = parsed.registryHash;
      }
    }

    // /schema
    const schemaOutcome = evaluateSchema(schema);
    if (schemaOutcome.status !== "ok") {
      outcomes.push({ status: schemaOutcome.status, warning: schemaOutcome.warning });
    }
    if (schemaOutcome.warning !== "") {
      warnings.push(schemaOutcome.warning);
    }
    if (schema.ok) {
      const parsed = parseSchema(schema.body);
      if (parsed.ok) {
        schemaVersion = parsed.schemaVersion;
      }
    }

    // /sql
    let freshness: NuthatchFreshness | null = null;
    let rowData: NuthatchFreshnessData | null = null;
    const sqlOutcome = evaluateSql(sql);
    if (sqlOutcome.status !== "ok") {
      outcomes.push({ status: sqlOutcome.status, warning: sqlOutcome.warning });
    }
    if (sqlOutcome.warning !== "") {
      warnings.push(sqlOutcome.warning);
    }
    if (sql.ok) {
      const parsed = parseFreshnessRows(sql.body);
      if (parsed.ok) {
        rowData = parsed.row;
        freshness = deriveFreshness(parsed.row, queriedAt);
      }
    }

    if (outcomes.length > 0) {
      const status = precedence(outcomes.map((o) => o.status));
      return failedResult(record, status, {
        warnings,
        latencyMs: totalLatency(),
        freshness,
        observedViewId,
        schemaVersion,
      });
    }

    // All calls succeeded and parsed. rowData and freshness are non-null here.
    if (rowData === null || freshness === null) {
      // Defensive: should be unreachable given the outcomes check above.
      return failedResult(record, "error", {
        warnings,
        latencyMs: totalLatency(),
        freshness,
        observedViewId,
        schemaVersion,
      });
    }

    return {
      source_id: record.source_id,
      source_type: record.source_type,
      protocol: record.protocol,
      chain_id: BASE_CHAIN_ID,
      status: "ok",
      data: rowData,
      freshness,
      provenance: provenanceFor(record, observedViewId, schemaVersion),
      warnings,
      latency_ms: totalLatency(),
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? `Nuthatch adapter failed unexpectedly: ${error.name}`
        : "Nuthatch adapter failed unexpectedly; details were redacted.";
    return failedResult(record, "error", {
      warnings: [message],
      latencyMs: totalLatency(),
      freshness: null,
    });
  }
}

function evaluateNest(
  result: NuthatchHttpResult,
  record: NuthatchSourceRegistryRecord,
): { status: FailureSourceStatus | "ok"; warning: string } {
  if (!result.ok) {
    return {
      status: classifyMetadataFailure(result),
      warning: result.error.message,
    };
  }
  const parsed: NestParseResult = parseNest(result.body);
  if (!parsed.ok) {
    return { status: "unsupported", warning: parsed.failure.message };
  }
  if (parsed.registryHash !== record.deployment_or_view_id) {
    return {
      status: "unsupported",
      warning: `Nest registry_hash mismatch: expected "${record.deployment_or_view_id}", received "${parsed.registryHash}".`,
    };
  }
  return { status: "ok", warning: "" };
}

function evaluateSchema(result: NuthatchHttpResult): {
  status: FailureSourceStatus | "ok";
  warning: string;
} {
  if (!result.ok) {
    return {
      status: classifyMetadataFailure(result),
      warning: result.error.message,
    };
  }
  const parsed: SchemaParseResult = parseSchema(result.body);
  if (!parsed.ok) {
    return { status: "unsupported", warning: parsed.failure.message };
  }
  return { status: "ok", warning: "" };
}

function evaluateSql(result: NuthatchHttpResult): {
  status: FailureSourceStatus | "ok";
  warning: string;
} {
  if (!result.ok) {
    return {
      status: classifySqlFailure(result),
      warning: result.error.message,
    };
  }
  const parsed: FreshnessParseResult = parseFreshnessRows(result.body);
  if (!parsed.ok) {
    return { status: "unsupported", warning: parsed.failure.message };
  }
  return { status: "ok", warning: "" };
}
