import { GATEWAY_DEFAULTS } from "../../config/defaults.js";
import type { ComparePoolGraphSource } from "../../registry/index.js";
import {
  BASE_CHAIN_ID,
  type PoolSourceData,
  type PoolSourceResult,
  type SourceFreshness,
  type SourceProvenance,
  type TokenMetadata,
} from "../../schemas/source-adapter.js";

import { aggregateDailySnapshots, type DailySnapshot } from "./aggregation.js";
import { assertDeployment, deploymentMismatchWarning } from "./deployment-assertion.js";
import { TIER_B_METRICS_QUERY, TIER_B_METRICS_QUERY_ID } from "./queries.js";
import { postGraphGateway, type GraphTransportResult } from "./transport.js";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BLOCK_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const NON_NEGATIVE_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const NON_NEGATIVE_INT_STRING = /^(?:0|[1-9]\d*)$/;

export interface FetchComparePoolGraphOptions {
  /** Bearer token for the Graph gateway. Prefer injection in tests. */
  readonly apiKey?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /** Unix seconds used as aggregation "now" and `queried_at`. */
  readonly nowSeconds?: number;
  readonly gatewayOrigin?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

function resolveApiKey(options: FetchComparePoolGraphOptions): string | null {
  if (options.apiKey !== undefined && options.apiKey.trim() !== "") {
    return options.apiKey;
  }
  const env = options.env ?? process.env;
  const fromEnv = env.GRAPH_API_KEY;
  if (fromEnv !== undefined && fromEnv.trim() !== "") {
    return fromEnv;
  }
  return null;
}

function provenanceFor(
  source: ComparePoolGraphSource,
  deploymentOrViewId: string,
): SourceProvenance {
  return {
    deployment_or_view_id: deploymentOrViewId,
    schema_version: source.record.schema_version,
    methodology_version: source.record.methodology_version,
    query_id: source.query_id,
  };
}

function failedResult(
  source: ComparePoolGraphSource,
  status: Extract<PoolSourceResult, { data: null }>["status"],
  options: {
    readonly warnings: readonly string[];
    readonly latencyMs: number;
    readonly freshness: SourceFreshness | null;
    readonly deploymentOrViewId?: string;
  },
): PoolSourceResult {
  return {
    source_id: source.source_id,
    source_type: source.record.source_type,
    protocol: source.record.protocol,
    chain_id: BASE_CHAIN_ID,
    status,
    data: null,
    freshness: options.freshness,
    provenance: provenanceFor(
      source,
      options.deploymentOrViewId ?? source.record.deployment_or_view_id,
    ),
    warnings: [...options.warnings],
    latency_ms: options.latencyMs,
  };
}

function normalizeAddress(value: string): string | null {
  if (!ADDRESS_PATTERN.test(value)) {
    return null;
  }
  return value.toLowerCase();
}

function parseToken(raw: unknown): TokenMetadata | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const token = raw as Record<string, unknown>;
  if (
    typeof token.id !== "string" ||
    typeof token.symbol !== "string" ||
    typeof token.decimals !== "string"
  ) {
    return null;
  }
  const address = normalizeAddress(token.id);
  if (address === null) {
    return null;
  }
  const symbol = token.symbol.trim();
  if (symbol === "") {
    return null;
  }
  if (!NON_NEGATIVE_INT_STRING.test(token.decimals)) {
    return null;
  }
  const decimals = Number(token.decimals);
  if (!Number.isSafeInteger(decimals) || decimals < 0) {
    return null;
  }
  return { address, symbol, decimals };
}

function parseFeeTierBps(raw: unknown): number | null {
  if (typeof raw !== "string" || !NON_NEGATIVE_INT_STRING.test(raw)) {
    return null;
  }
  const feeTier = Number(raw);
  if (!Number.isSafeInteger(feeTier) || feeTier < 0 || feeTier % 100 !== 0) {
    return null;
  }
  return feeTier / 100;
}

function parseFinancial(raw: unknown): string | null {
  if (typeof raw !== "string" || !NON_NEGATIVE_DECIMAL.test(raw)) {
    return null;
  }
  return raw;
}

function parseDayDatas(raw: unknown): DailySnapshot[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const days: DailySnapshot[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") {
      return null;
    }
    const day = entry as Record<string, unknown>;
    if (typeof day.date !== "number" || !Number.isInteger(day.date) || day.date < 0) {
      return null;
    }
    const volumeUSD =
      day.volumeUSD === null || day.volumeUSD === undefined
        ? null
        : typeof day.volumeUSD === "string"
          ? day.volumeUSD
          : null;
    const feesUSD =
      day.feesUSD === null || day.feesUSD === undefined
        ? null
        : typeof day.feesUSD === "string"
          ? day.feesUSD
          : null;
    if (day.volumeUSD !== null && day.volumeUSD !== undefined && volumeUSD === null) {
      return null;
    }
    if (day.feesUSD !== null && day.feesUSD !== undefined && feesUSD === null) {
      return null;
    }
    days.push({ date: day.date, volumeUSD, feesUSD });
  }
  return days;
}

function parseFreshness(meta: Record<string, unknown>, queriedAt: number): SourceFreshness | null {
  const block = meta.block;
  if (block === null || typeof block !== "object") {
    return null;
  }
  const blockRecord = block as Record<string, unknown>;
  if (
    typeof blockRecord.number !== "number" ||
    !Number.isInteger(blockRecord.number) ||
    blockRecord.number < 0 ||
    typeof blockRecord.timestamp !== "number" ||
    !Number.isInteger(blockRecord.timestamp) ||
    blockRecord.timestamp < 0
  ) {
    return null;
  }

  const freshness: SourceFreshness = {
    indexed_block: blockRecord.number,
    indexed_block_timestamp: blockRecord.timestamp,
    queried_at: queriedAt,
  };

  if (typeof blockRecord.hash === "string" && BLOCK_HASH_PATTERN.test(blockRecord.hash)) {
    freshness.indexed_block_hash = blockRecord.hash.toLowerCase();
  }

  if (typeof meta.hasIndexingErrors === "boolean") {
    freshness.has_indexing_errors = meta.hasIndexingErrors;
  }

  return freshness;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Queries one locked compare-pools Graph binding and maps it to `PoolSourceResult`.
 * Operational and shape failures stay inside this boundary as non-`ok` statuses.
 */
export async function fetchComparePoolGraphSource(
  source: ComparePoolGraphSource,
  options: FetchComparePoolGraphOptions = {},
): Promise<PoolSourceResult> {
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const timeoutMs = options.timeoutMs ?? GATEWAY_DEFAULTS.sourceTimeoutMs;

  if (source.query_id !== TIER_B_METRICS_QUERY_ID) {
    return failedResult(source, "unsupported", {
      warnings: [
        `Unsupported Graph query_id "${source.query_id}"; expected "${TIER_B_METRICS_QUERY_ID}".`,
      ],
      latencyMs: 0,
      freshness: null,
    });
  }

  if (source.record.locator.kind !== "graph_subgraph") {
    return failedResult(source, "unsupported", {
      warnings: ["Compare-pools Graph adapter requires a graph_subgraph locator."],
      latencyMs: 0,
      freshness: null,
    });
  }

  const apiKey = resolveApiKey(options);
  if (apiKey === null) {
    return failedResult(source, "error", {
      warnings: ["GRAPH_API_KEY is unset or empty."],
      latencyMs: 0,
      freshness: null,
    });
  }

  const poolVariable = normalizeAddress(source.pool_address);
  if (poolVariable === null) {
    return failedResult(source, "unsupported", {
      warnings: ["Registry pool_address is not a valid lowercaseable Ethereum address."],
      latencyMs: 0,
      freshness: null,
    });
  }

  const gatewayOrigin =
    options.gatewayOrigin ?? `https://${source.record.locator.gateway_host}/api`;

  const transport: GraphTransportResult = await postGraphGateway(
    source.record.locator.subgraph_id,
    TIER_B_METRICS_QUERY,
    { pool: poolVariable },
    {
      apiKey,
      timeoutMs,
      gatewayOrigin,
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    },
  );

  if (transport.error?.kind === "timeout") {
    return failedResult(source, "timeout", {
      warnings: [transport.error.message],
      latencyMs: transport.latencyMs,
      freshness: null,
    });
  }

  if (transport.error !== null) {
    return failedResult(source, "error", {
      warnings: [transport.error.message],
      latencyMs: transport.latencyMs,
      freshness: null,
    });
  }

  if (!isRecord(transport.body)) {
    return failedResult(source, "error", {
      warnings: ["Graph gateway returned an unexpected response body."],
      latencyMs: transport.latencyMs,
      freshness: null,
    });
  }

  if (Array.isArray(transport.body.errors) && transport.body.errors.length > 0) {
    return failedResult(source, "error", {
      warnings: ["Graph gateway returned GraphQL errors."],
      latencyMs: transport.latencyMs,
      freshness: null,
    });
  }

  const data = transport.body.data;
  if (!isRecord(data)) {
    return failedResult(source, "error", {
      warnings: ["Graph gateway response is missing a data object."],
      latencyMs: transport.latencyMs,
      freshness: null,
    });
  }

  if (!isRecord(data._meta) || typeof data._meta.deployment !== "string") {
    return failedResult(source, "unsupported", {
      warnings: ["Graph response is missing a usable _meta.deployment."],
      latencyMs: transport.latencyMs,
      freshness: null,
    });
  }

  const freshness = parseFreshness(data._meta, nowSeconds);
  const deploymentCheck = assertDeployment(
    source.record.deployment_or_view_id,
    data._meta.deployment,
  );

  if (!deploymentCheck.ok) {
    return failedResult(source, "unsupported", {
      warnings: [deploymentMismatchWarning(deploymentCheck.expected, deploymentCheck.actual)],
      latencyMs: transport.latencyMs,
      freshness,
      deploymentOrViewId: deploymentCheck.actual,
    });
  }

  if (data.pool === null) {
    return failedResult(source, "unsupported", {
      warnings: [`Pool ${poolVariable} was not found on the registered Graph deployment.`],
      latencyMs: transport.latencyMs,
      freshness,
      deploymentOrViewId: data._meta.deployment,
    });
  }

  if (!isRecord(data.pool)) {
    return failedResult(source, "unsupported", {
      warnings: ["Graph pool payload has an unexpected shape."],
      latencyMs: transport.latencyMs,
      freshness,
      deploymentOrViewId: data._meta.deployment,
    });
  }

  if (freshness === null) {
    return failedResult(source, "unsupported", {
      warnings: ["Graph response is missing usable _meta block freshness."],
      latencyMs: transport.latencyMs,
      freshness: null,
      deploymentOrViewId: data._meta.deployment,
    });
  }

  const poolAddress = typeof data.pool.id === "string" ? normalizeAddress(data.pool.id) : null;
  const token0 = parseToken(data.pool.token0);
  const token1 = parseToken(data.pool.token1);
  const dayDatas = parseDayDatas(data.poolDayDatas);

  if (poolAddress === null || token0 === null || token1 === null || dayDatas === null) {
    return failedResult(source, "unsupported", {
      warnings: ["Graph pool metrics payload failed shape validation."],
      latencyMs: transport.latencyMs,
      freshness,
      deploymentOrViewId: data._meta.deployment,
    });
  }

  if (poolAddress !== poolVariable) {
    return failedResult(source, "unsupported", {
      warnings: [
        `Graph pool id "${poolAddress}" does not match the registry pool "${poolVariable}".`,
      ],
      latencyMs: transport.latencyMs,
      freshness,
      deploymentOrViewId: data._meta.deployment,
    });
  }

  const expectedToken0 = normalizeAddress(source.token0);
  const expectedToken1 = normalizeAddress(source.token1);
  if (
    expectedToken0 === null ||
    expectedToken1 === null ||
    token0.address !== expectedToken0 ||
    token1.address !== expectedToken1
  ) {
    return failedResult(source, "unsupported", {
      warnings: ["Graph pool tokens do not match the locked compare-pools pair."],
      latencyMs: transport.latencyMs,
      freshness,
      deploymentOrViewId: data._meta.deployment,
    });
  }

  const aggregation = aggregateDailySnapshots(dayDatas, nowSeconds);
  const warnings = aggregation.warnings.map((warning) => warning.message);
  if (freshness.has_indexing_errors === true) {
    warnings.push("Graph _meta.hasIndexingErrors is true for this response.");
  }

  const poolData: PoolSourceData = {
    pool_address: poolAddress,
    token0,
    token1,
    fee_tier_bps: parseFeeTierBps(data.pool.feeTier),
    tvl_usd: parseFinancial(data.pool.totalValueLockedUSD),
    volume_usd_24h: aggregation.aggregates.volume_usd_24h,
    volume_usd_7d: aggregation.aggregates.volume_usd_7d,
    fees_usd_24h: aggregation.aggregates.fees_usd_24h,
    fees_usd_7d: aggregation.aggregates.fees_usd_7d,
  };

  return {
    source_id: source.source_id,
    source_type: source.record.source_type,
    protocol: source.record.protocol,
    chain_id: BASE_CHAIN_ID,
    status: "ok",
    data: poolData,
    freshness,
    provenance: provenanceFor(source, data._meta.deployment),
    warnings,
    latency_ms: transport.latencyMs,
  };
}
