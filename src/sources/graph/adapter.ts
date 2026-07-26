import { GATEWAY_DEFAULTS, GATEWAY_MAXIMUMS } from "../../config/defaults.js";
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
import {
  TIER_A_METRICS_QUERY,
  TIER_A_METRICS_QUERY_ID,
  TIER_B_METRICS_QUERY,
  TIER_B_METRICS_QUERY_ID,
} from "./queries.js";
import {
  isRecord,
  NON_NEGATIVE_DECIMAL,
  NON_NEGATIVE_INT_STRING,
  normalizeAddress,
  parseFinancial,
  parseFreshness,
  parseToken,
  resolveGraphApiKey,
} from "./response.js";
import { postGraphGateway, type GraphTransportResult } from "./transport.js";

const SECONDS_PER_DAY = 86_400;

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

/** Everything a metrics query yields before window aggregation is applied. */
interface ParsedPoolMetrics {
  readonly pool_address: string;
  readonly token0: TokenMetadata;
  readonly token1: TokenMetadata;
  readonly fee_tier_bps: number | null;
  readonly tvl_usd: string | null;
  readonly snapshots: readonly DailySnapshot[];
}

/**
 * One supported metrics query: the document to send, the response field that
 * carries the pool entity, and the parser that flattens the two schema tiers
 * onto one shape.
 */
interface PoolMetricsQuery {
  readonly query: string;
  readonly poolField: string;
  readonly parse: (
    data: Record<string, unknown>,
    pool: Record<string, unknown>,
  ) => ParsedPoolMetrics | null;
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

/** Native `feeTier` is expressed in hundredths of a basis point (3000 = 30 bps). */
function parseNativeFeeTierBps(raw: unknown): number | null {
  if (typeof raw !== "string" || !NON_NEGATIVE_INT_STRING.test(raw)) {
    return null;
  }
  const feeTier = Number(raw);
  if (!Number.isSafeInteger(feeTier) || feeTier < 0 || feeTier % 100 !== 0) {
    return null;
  }
  return feeTier / 100;
}

/**
 * Messari expresses a fee as a percentage decimal string ("0.3" = 30 bps).
 * Scaling by 100 digitwise keeps the conversion off IEEE-754; a tier finer
 * than one basis point has no integer representation and stays null.
 */
function parsePercentageFeeBps(raw: unknown): number | null {
  if (typeof raw !== "string" || !NON_NEGATIVE_DECIMAL.test(raw)) {
    return null;
  }
  const [whole = "0", fraction = ""] = raw.split(".");
  if (fraction.length > 2) {
    return null;
  }
  const bps = Number(`${whole}${fraction.padEnd(2, "0")}`);
  return Number.isSafeInteger(bps) && bps >= 0 ? bps : null;
}

function parseTradingFeeBps(raw: unknown): number | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const trading = raw.filter(
    (entry) => isRecord(entry) && entry.feeType === "FIXED_TRADING_FEE",
  ) as Record<string, unknown>[];
  if (trading.length !== 1) {
    return null;
  }
  return parsePercentageFeeBps(trading[0]!.feePercentage);
}

/** Reads a `volumeUSD`-style metric that the source may legitimately omit. */
function parseOptionalMetric(raw: unknown): { value: string | null; valid: boolean } {
  if (raw === null || raw === undefined) {
    return { value: null, valid: true };
  }
  if (typeof raw !== "string") {
    return { value: null, valid: false };
  }
  return { value: raw, valid: true };
}

function parseTierBSnapshots(raw: unknown): DailySnapshot[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const days: DailySnapshot[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      return null;
    }
    if (typeof entry.date !== "number" || !Number.isInteger(entry.date) || entry.date < 0) {
      return null;
    }
    const volume = parseOptionalMetric(entry.volumeUSD);
    const fees = parseOptionalMetric(entry.feesUSD);
    if (!volume.valid || !fees.valid) {
      return null;
    }
    days.push({ date: entry.date, volumeUSD: volume.value, feesUSD: fees.value });
  }
  return days;
}

/**
 * Messari snapshots are keyed by `day`, the count of days since the unix
 * epoch. Aggregation works in UTC-midnight seconds, so convert on the way in.
 */
function parseTierASnapshots(raw: unknown): DailySnapshot[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const days: DailySnapshot[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      return null;
    }
    if (typeof entry.day !== "number" || !Number.isInteger(entry.day) || entry.day < 0) {
      return null;
    }
    const volume = parseOptionalMetric(entry.dailyVolumeUSD);
    const revenue = parseOptionalMetric(entry.dailyTotalRevenueUSD);
    if (!volume.valid || !revenue.valid) {
      return null;
    }
    days.push({
      date: entry.day * SECONDS_PER_DAY,
      volumeUSD: volume.value,
      feesUSD: revenue.value,
    });
  }
  return days;
}

function parseTierAPool(
  data: Record<string, unknown>,
  pool: Record<string, unknown>,
): ParsedPoolMetrics | null {
  const poolAddress = typeof pool.id === "string" ? normalizeAddress(pool.id) : null;
  const snapshots = parseTierASnapshots(data.liquidityPoolDailySnapshots);
  if (poolAddress === null || snapshots === null || !Array.isArray(pool.inputTokens)) {
    return null;
  }

  // A two-sided pool is the only shape the locked pair can be checked against.
  if (pool.inputTokens.length !== 2) {
    return null;
  }
  const token0 = parseToken(pool.inputTokens[0]);
  const token1 = parseToken(pool.inputTokens[1]);
  if (token0 === null || token1 === null) {
    return null;
  }

  return {
    pool_address: poolAddress,
    token0,
    token1,
    fee_tier_bps: parseTradingFeeBps(pool.fees),
    tvl_usd: parseFinancial(pool.totalValueLockedUSD),
    snapshots,
  };
}

function parseTierBPool(
  data: Record<string, unknown>,
  pool: Record<string, unknown>,
): ParsedPoolMetrics | null {
  const poolAddress = typeof pool.id === "string" ? normalizeAddress(pool.id) : null;
  const token0 = parseToken(pool.token0);
  const token1 = parseToken(pool.token1);
  const snapshots = parseTierBSnapshots(data.poolDayDatas);
  if (poolAddress === null || token0 === null || token1 === null || snapshots === null) {
    return null;
  }

  return {
    pool_address: poolAddress,
    token0,
    token1,
    fee_tier_bps: parseNativeFeeTierBps(pool.feeTier),
    tvl_usd: parseFinancial(pool.totalValueLockedUSD),
    snapshots,
  };
}

const POOL_METRICS_QUERIES: Readonly<Record<string, PoolMetricsQuery>> = {
  [TIER_A_METRICS_QUERY_ID]: {
    query: TIER_A_METRICS_QUERY,
    poolField: "liquidityPool",
    parse: parseTierAPool,
  },
  [TIER_B_METRICS_QUERY_ID]: {
    query: TIER_B_METRICS_QUERY,
    poolField: "pool",
    parse: parseTierBPool,
  },
};

/**
 * Queries one locked compare-pools Graph binding and maps it to `PoolSourceResult`.
 * Operational and shape failures stay inside this boundary as non-`ok` statuses.
 */
export async function fetchComparePoolGraphSource(
  source: ComparePoolGraphSource,
  options: FetchComparePoolGraphOptions = {},
): Promise<PoolSourceResult> {
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const requestedTimeoutMs = options.timeoutMs ?? GATEWAY_DEFAULTS.sourceTimeoutMs;
  const timeoutMs = Math.min(Math.max(1, requestedTimeoutMs), GATEWAY_MAXIMUMS.sourceTimeoutMs);

  const selected = POOL_METRICS_QUERIES[source.query_id];
  if (selected === undefined) {
    return failedResult(source, "unsupported", {
      warnings: [
        `Unsupported Graph query_id "${source.query_id}"; expected one of ${Object.keys(POOL_METRICS_QUERIES).join(", ")}.`,
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

  const apiKey = resolveGraphApiKey(options);
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
    selected.query,
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

  const poolEntity = data[selected.poolField];
  if (poolEntity === null || poolEntity === undefined) {
    return failedResult(source, "unsupported", {
      warnings: [`Pool ${poolVariable} was not found on the registered Graph deployment.`],
      latencyMs: transport.latencyMs,
      freshness,
      deploymentOrViewId: data._meta.deployment,
    });
  }

  if (!isRecord(poolEntity)) {
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

  const parsed = selected.parse(data, poolEntity);
  if (parsed === null) {
    return failedResult(source, "unsupported", {
      warnings: ["Graph pool metrics payload failed shape validation."],
      latencyMs: transport.latencyMs,
      freshness,
      deploymentOrViewId: data._meta.deployment,
    });
  }

  if (parsed.pool_address !== poolVariable) {
    return failedResult(source, "unsupported", {
      warnings: [
        `Graph pool id "${parsed.pool_address}" does not match the registry pool "${poolVariable}".`,
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
    parsed.token0.address !== expectedToken0 ||
    parsed.token1.address !== expectedToken1
  ) {
    return failedResult(source, "unsupported", {
      warnings: ["Graph pool tokens do not match the locked compare-pools pair."],
      latencyMs: transport.latencyMs,
      freshness,
      deploymentOrViewId: data._meta.deployment,
    });
  }

  const aggregation = aggregateDailySnapshots(parsed.snapshots, nowSeconds);
  const warnings = aggregation.warnings.map((warning) => warning.message);
  if (freshness.has_indexing_errors === true) {
    warnings.push("Graph _meta.hasIndexingErrors is true for this response.");
  }

  const poolData: PoolSourceData = {
    pool_address: parsed.pool_address,
    token0: parsed.token0,
    token1: parsed.token1,
    fee_tier_bps: parsed.fee_tier_bps,
    tvl_usd: parsed.tvl_usd,
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
