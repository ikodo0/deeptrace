import { GATEWAY_DEFAULTS, GATEWAY_MAXIMUMS } from "../../config/defaults.js";
import type { CompareLendingGraphSource } from "../../registry/index.js";
import {
  BASE_CHAIN_ID,
  type LendingMarketSourceData,
  type LendingMarketSourceResult,
  type SourceFreshness,
  type SourceProvenance,
  type TokenMetadata,
} from "../../schemas/source-adapter.js";

import { assertDeployment, deploymentMismatchWarning } from "./deployment-assertion.js";
import {
  TIER_A_LENDING_METRICS_QUERY,
  TIER_A_LENDING_METRICS_QUERY_ID,
} from "./lending-queries.js";
import {
  isRecord,
  normalizeAddress,
  parseFinancial,
  parseFreshness,
  parseToken,
  resolveGraphApiKey,
} from "./response.js";
import { postGraphGateway, type GraphTransportResult } from "./transport.js";

export interface FetchCompareLendingGraphOptions {
  /** Bearer token for the Graph gateway. Prefer injection in tests. */
  readonly apiKey?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /** Unix seconds recorded as `queried_at`. */
  readonly nowSeconds?: number;
  readonly gatewayOrigin?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** The rate sides and types the Messari lending standard publishes. */
type RateSide = "LENDER" | "BORROWER";
type RateType = "VARIABLE" | "STABLE";

interface SelectedRate {
  readonly value: string | null;
  readonly warning: string | null;
}

/**
 * The `network` every shipped binding must self-report. Messari deployments
 * are published per network but a subgraph can be indexed against a different
 * one than its listing implies — the Compound v3 "base" deployment reports
 * MAINNET — so the response is required to agree with the locked scope.
 */
const EXPECTED_NETWORK = "BASE" as const;

interface ParsedMarket {
  readonly market_id: string;
  readonly market_name: string | null;
  readonly input_token: TokenMetadata;
  readonly is_active: boolean;
  readonly can_borrow_from: boolean;
  readonly can_use_as_collateral: boolean;
  readonly tvl_usd: string | null;
  readonly total_deposit_balance_usd: string | null;
  readonly total_borrow_balance_usd: string | null;
  readonly rates: readonly Record<string, unknown>[];
}

function provenanceFor(
  source: CompareLendingGraphSource,
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
  source: CompareLendingGraphSource,
  status: Extract<LendingMarketSourceResult, { data: null }>["status"],
  options: {
    readonly warnings: readonly string[];
    readonly latencyMs: number;
    readonly freshness: SourceFreshness | null;
    readonly deploymentOrViewId?: string;
  },
): LendingMarketSourceResult {
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

/** `null` for an absent value, `undefined` for one that failed validation. */
function parseOptionalFinancial(raw: unknown): string | null | undefined {
  if (raw === null || raw === undefined) {
    return null;
  }
  return parseFinancial(raw) ?? undefined;
}

/** `null` for an absent or blank name, `undefined` for a non-string one. */
function parseMarketName(raw: unknown): string | null | undefined {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== "string") {
    return undefined;
  }
  const name = raw.trim();
  return name === "" ? null : name;
}

/** Reads the network off the single protocol entity, or `null` if unreadable. */
function parseProtocolNetwork(raw: unknown): string | null {
  if (!Array.isArray(raw) || raw.length !== 1 || !isRecord(raw[0])) {
    return null;
  }
  const network = raw[0].network;
  return typeof network === "string" && network !== "" ? network : null;
}

function parseMarket(raw: Record<string, unknown>): ParsedMarket | null {
  const marketId = typeof raw.id === "string" ? normalizeAddress(raw.id) : null;
  const marketName = parseMarketName(raw.name);
  const inputToken = parseToken(raw.inputToken);
  const tvlUsd = parseOptionalFinancial(raw.totalValueLockedUSD);
  const depositUsd = parseOptionalFinancial(raw.totalDepositBalanceUSD);
  const borrowUsd = parseOptionalFinancial(raw.totalBorrowBalanceUSD);

  if (
    marketId === null ||
    marketName === undefined ||
    inputToken === null ||
    typeof raw.isActive !== "boolean" ||
    typeof raw.canBorrowFrom !== "boolean" ||
    typeof raw.canUseAsCollateral !== "boolean" ||
    tvlUsd === undefined ||
    depositUsd === undefined ||
    borrowUsd === undefined ||
    !Array.isArray(raw.rates) ||
    !raw.rates.every(isRecord)
  ) {
    return null;
  }

  return {
    market_id: marketId,
    market_name: marketName,
    input_token: inputToken,
    is_active: raw.isActive,
    can_borrow_from: raw.canBorrowFrom,
    can_use_as_collateral: raw.canUseAsCollateral,
    tvl_usd: tvlUsd,
    total_deposit_balance_usd: depositUsd,
    total_borrow_balance_usd: borrowUsd,
    rates: raw.rates,
  };
}

/**
 * Picks the single rate for one side/type pair.
 *
 * An absent pair is a real protocol fact (Moonwell publishes no stable borrow
 * rate) and stays silent. A malformed or ambiguous pair yields `null` plus a
 * warning, because both a defaulted value and an arbitrary pick would invent a
 * number the source never reported.
 */
function selectRate(
  rates: readonly Record<string, unknown>[],
  side: RateSide,
  type: RateType,
  sourceId: string,
): SelectedRate {
  const matches = rates.filter((rate) => rate.side === side && rate.type === type);

  if (matches.length === 0) {
    return { value: null, warning: null };
  }
  if (matches.length > 1) {
    return {
      value: null,
      warning: `${sourceId} reported ${String(matches.length)} ${side}/${type} rates for the selected market.`,
    };
  }

  const value = parseFinancial(matches[0]!.rate);
  if (value === null) {
    return {
      value: null,
      warning: `${sourceId} reported a ${side}/${type} rate that failed decimal validation.`,
    };
  }
  return { value, warning: null };
}

/**
 * Queries one locked compare-lending Graph binding and maps it to a
 * `LendingMarketSourceResult`. Operational and shape failures stay inside this
 * boundary as non-`ok` statuses.
 */
export async function fetchCompareLendingGraphSource(
  source: CompareLendingGraphSource,
  options: FetchCompareLendingGraphOptions = {},
): Promise<LendingMarketSourceResult> {
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const requestedTimeoutMs = options.timeoutMs ?? GATEWAY_DEFAULTS.sourceTimeoutMs;
  const timeoutMs = Math.min(Math.max(1, requestedTimeoutMs), GATEWAY_MAXIMUMS.sourceTimeoutMs);

  if (source.query_id !== TIER_A_LENDING_METRICS_QUERY_ID) {
    return failedResult(source, "unsupported", {
      warnings: [
        `Unsupported Graph query_id "${source.query_id}"; expected "${TIER_A_LENDING_METRICS_QUERY_ID}".`,
      ],
      latencyMs: 0,
      freshness: null,
    });
  }

  if (source.record.locator.kind !== "graph_subgraph") {
    return failedResult(source, "unsupported", {
      warnings: ["Compare-lending Graph adapter requires a graph_subgraph locator."],
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

  const marketToken = normalizeAddress(source.market_token);
  if (marketToken === null) {
    return failedResult(source, "unsupported", {
      warnings: ["Registry market_token is not a valid lowercaseable Ethereum address."],
      latencyMs: 0,
      freshness: null,
    });
  }

  const gatewayOrigin =
    options.gatewayOrigin ?? `https://${source.record.locator.gateway_host}/api`;

  const transport: GraphTransportResult = await postGraphGateway(
    source.record.locator.subgraph_id,
    TIER_A_LENDING_METRICS_QUERY,
    { token: marketToken },
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

  if (freshness === null) {
    return failedResult(source, "unsupported", {
      warnings: ["Graph response is missing usable _meta block freshness."],
      latencyMs: transport.latencyMs,
      freshness: null,
      deploymentOrViewId: data._meta.deployment,
    });
  }

  const network = parseProtocolNetwork(data.lendingProtocols);
  if (network === null) {
    return failedResult(source, "unsupported", {
      warnings: ["Graph response is missing a usable lendingProtocols.network."],
      latencyMs: transport.latencyMs,
      freshness,
      deploymentOrViewId: data._meta.deployment,
    });
  }

  if (network !== EXPECTED_NETWORK) {
    return failedResult(source, "unsupported", {
      warnings: [
        `Graph deployment self-reports network "${network}", expected "${EXPECTED_NETWORK}".`,
      ],
      latencyMs: transport.latencyMs,
      freshness,
      deploymentOrViewId: data._meta.deployment,
    });
  }

  if (!Array.isArray(data.markets) || !data.markets.every(isRecord)) {
    return failedResult(source, "unsupported", {
      warnings: ["Graph markets payload has an unexpected shape."],
      latencyMs: transport.latencyMs,
      freshness,
      deploymentOrViewId: data._meta.deployment,
    });
  }

  const matches = data.markets.filter(
    (market) => parseToken(market.inputToken)?.address === marketToken,
  );

  if (matches.length === 0) {
    return failedResult(source, "unsupported", {
      warnings: [
        `No market for input token ${marketToken} was found on the registered Graph deployment.`,
      ],
      latencyMs: transport.latencyMs,
      freshness,
      deploymentOrViewId: data._meta.deployment,
    });
  }

  if (matches.length > 1) {
    // Selecting one of several would be an invented editorial choice, so the
    // ambiguity is surfaced instead.
    return failedResult(source, "unsupported", {
      warnings: [
        `Graph deployment reported ${String(matches.length)} markets for input token ${marketToken}.`,
      ],
      latencyMs: transport.latencyMs,
      freshness,
      deploymentOrViewId: data._meta.deployment,
    });
  }

  const market = parseMarket(matches[0]!);
  if (market === null) {
    return failedResult(source, "unsupported", {
      warnings: ["Graph lending market payload failed shape validation."],
      latencyMs: transport.latencyMs,
      freshness,
      deploymentOrViewId: data._meta.deployment,
    });
  }

  const lenderVariable = selectRate(market.rates, "LENDER", "VARIABLE", source.source_id);
  const borrowerVariable = selectRate(market.rates, "BORROWER", "VARIABLE", source.source_id);
  const borrowerStable = selectRate(market.rates, "BORROWER", "STABLE", source.source_id);

  const warnings = [
    lenderVariable.warning,
    borrowerVariable.warning,
    borrowerStable.warning,
  ].filter((warning): warning is string => warning !== null);

  if (freshness.has_indexing_errors === true) {
    warnings.push("Graph _meta.hasIndexingErrors is true for this response.");
  }
  if (!market.is_active) {
    warnings.push(`${source.source_id} market ${market.market_id} is reported as inactive.`);
  }

  const marketData: LendingMarketSourceData = {
    market_id: market.market_id,
    market_name: market.market_name,
    input_token: market.input_token,
    is_active: market.is_active,
    can_borrow_from: market.can_borrow_from,
    can_use_as_collateral: market.can_use_as_collateral,
    tvl_usd: market.tvl_usd,
    total_deposit_balance_usd: market.total_deposit_balance_usd,
    total_borrow_balance_usd: market.total_borrow_balance_usd,
    lender_variable_rate_percent: lenderVariable.value,
    borrower_variable_rate_percent: borrowerVariable.value,
    borrower_stable_rate_percent: borrowerStable.value,
  };

  return {
    source_id: source.source_id,
    source_type: source.record.source_type,
    protocol: source.record.protocol,
    chain_id: BASE_CHAIN_ID,
    status: "ok",
    data: marketData,
    freshness,
    provenance: provenanceFor(source, data._meta.deployment),
    warnings,
    latency_ms: transport.latencyMs,
  };
}
