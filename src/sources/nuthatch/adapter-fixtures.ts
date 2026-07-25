/**
 * Shared fixtures and a scripted fake client for the Nuthatch adapter tests.
 * Kept out of the test files so each matrix row can be covered in a focused
 * commit without exceeding the repo's per-commit line guard.
 */
import type { NuthatchSourceRegistryRecord } from "../../registry/types.js";
import { fetchNuthatchFreshness } from "./adapter.js";
import type { NuthatchClient, NuthatchHttpResult } from "./client.js";

export const REGISTRY_HASH = "0x46e57ffd7f6fb47e80c49314a5522bd588fd8f6ba2194528bd560be10d78da25";
export const OTHER_HASH = "0x0000000000000000000000000000000000000000000000000000000000000abc";
export const POOL = "0x6c561b446416e1a00e8e93e221854d6ea4171372";
export const BLOCK_HASH = "0xc2fd40c2f6b9a9b1e59737d6053354885b3336ac801a3f7c0340902420ec9dc2";
export const TX_HASH = "0x5a02a9e244c5191381b04066377bd9b06cec47b962074200dc0d9a4702357733";

export const ROW = {
  pool_address: POOL,
  recent_swap_count_24h: 42,
  last_swap_block: 48756852,
  last_swap_block_timestamp: 1784303051,
  last_swap_block_hash: BLOCK_HASH,
  last_swap_tx_hash: TX_HASH,
  last_swap_log_index: 21,
} as const;

export const READY_OK: NuthatchHttpResult = {
  ok: true,
  status: 200,
  body: { ready: true },
  latencyMs: 1,
};
export const NEST_OK: NuthatchHttpResult = {
  ok: true,
  status: 200,
  body: {
    chain: "base",
    chain_id: 8453,
    registry_hash: REGISTRY_HASH,
    name: "deeptrace-pool-freshness",
    table_count: 9,
  },
  latencyMs: 2,
};
export const SCHEMA_OK: NuthatchHttpResult = {
  ok: true,
  status: 200,
  body: "nuthatch data model\n\nTABLES...",
  latencyMs: 2,
};
export const SQL_OK: NuthatchHttpResult = {
  ok: true,
  status: 200,
  body: { count: 1, provenance: {}, rows: [ROW], truncated: false },
  latencyMs: 3,
};

export const QUERIED_AT = 1_784_995_000;

export const RECORD = {
  source_id: "nuthatch-pool-swaps",
  category: "dex",
  protocol: "uniswap-v3",
  chain_id: 8453,
  source_type: "nuthatch_view",
  deployment_or_view_id: REGISTRY_HASH,
  schema_version: null,
  methodology_version: null,
  supported_entities: ["pool_swap_freshness"],
  status: "active",
  locator: {
    kind: "nuthatch_view",
    base_url_env: "NUTHATCH_BASE_URL",
    view_id: "pool_swap_freshness",
  },
} as const satisfies NuthatchSourceRegistryRecord;

export interface Script {
  readonly ready?: NuthatchHttpResult | NuthatchHttpResult[];
  readonly nest?: NuthatchHttpResult | NuthatchHttpResult[];
  readonly schema?: NuthatchHttpResult | NuthatchHttpResult[];
  readonly sql?: NuthatchHttpResult | NuthatchHttpResult[];
}

function asQueue(
  value: NuthatchHttpResult | NuthatchHttpResult[] | undefined,
): NuthatchHttpResult[] {
  if (value === undefined) {
    return [READY_OK];
  }
  return Array.isArray(value) ? [...value] : [value];
}

export function scriptClient(script: Script): NuthatchClient {
  const readyQueue = asQueue(script.ready);
  const nestQueue = asQueue(script.nest ?? NEST_OK);
  const schemaQueue = asQueue(script.schema ?? SCHEMA_OK);
  const sqlQueue = asQueue(script.sql ?? SQL_OK);

  function pop(queue: NuthatchHttpResult[]): NuthatchHttpResult {
    const next = queue.shift();
    if (next === undefined) {
      return {
        ok: false,
        status: null,
        error: { kind: "transport", message: "script exhausted" },
        latencyMs: 0,
      };
    }
    return next;
  }

  return {
    health: () => Promise.resolve(pop(readyQueue)),
    ready: () => Promise.resolve(pop(readyQueue)),
    nest: () => Promise.resolve(pop(nestQueue)),
    schema: () => Promise.resolve(pop(schemaQueue)),
    explain: () => Promise.resolve(pop(schemaQueue)),
    sql: () => Promise.resolve(pop(sqlQueue)),
  };
}

export function err(
  kind: "timeout" | "transport" | "http" | "invalid_json" | "oversize",
  status: number | null = null,
  message = "scripted failure",
): NuthatchHttpResult {
  return { ok: false, status, error: { kind, message }, latencyMs: 1 };
}

export function run(script: Script) {
  return fetchNuthatchFreshness({
    client: scriptClient(script),
    clock: () => QUERIED_AT,
    record: RECORD,
  });
}
