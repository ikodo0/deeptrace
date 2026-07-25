export const BASE_CHAIN_ID = 8453 as const;

export type SourceStatus = "ok" | "timeout" | "error" | "unsupported" | "stale";

export type FailureSourceStatus = Exclude<SourceStatus, "ok">;

export type SourceType = "standardized_subgraph" | "native_subgraph" | "nuthatch_view";

export interface SourceFreshness {
  indexed_block: number;
  indexed_block_timestamp: number;
  indexed_block_hash?: string;
  queried_at: number;
  has_indexing_errors?: boolean;
}

export interface SourceProvenance {
  deployment_or_view_id: string;
  schema_version: string | null;
  methodology_version: string | null;
  query_id: string;
}

interface SourceResultBase {
  source_id: string;
  source_type: SourceType;
  protocol: string;
  chain_id: typeof BASE_CHAIN_ID;
  provenance: SourceProvenance;
  warnings: string[];
  latency_ms: number;
}

export interface SuccessfulSourceResult<T> extends SourceResultBase {
  status: "ok";
  data: T;
  freshness: SourceFreshness;
}

export interface FailedSourceResult extends SourceResultBase {
  status: FailureSourceStatus;
  data: null;
  freshness: SourceFreshness | null;
}

export type SourceResult<T> = SuccessfulSourceResult<T> | FailedSourceResult;

export interface TokenMetadata {
  address: string;
  symbol: string;
  decimals: number;
}

export interface PoolSourceData {
  pool_address: string;
  token0: TokenMetadata;
  token1: TokenMetadata;
  fee_tier_bps: number | null;
  tvl_usd: string | null;
  volume_usd_24h: string | null;
  volume_usd_7d: string | null;
  fees_usd_24h: string | null;
  fees_usd_7d: string | null;
}

export interface NuthatchFreshnessData {
  pool_address: string;
  recent_swap_count_24h: number;
  last_swap_block: number;
  last_swap_block_timestamp: number;
  last_swap_block_hash: string;
  last_swap_tx_hash: string;
  last_swap_log_index: number;
}
