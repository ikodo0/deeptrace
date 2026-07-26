import { LSS_SCOPE } from "../../scope/large-swaps.js";
import type { LargeSwapEventPosition } from "../../tools/large-swaps-query.js";

const TRANSACTION_HASH_PATTERN = /^0x[0-9a-f]{64}$/;

/**
 * Project the indexed pool Swap table into the large-swap receipt shape.
 * Query `pool__swap` directly (same projection as `pool_swap_search`) so scans
 * stay live when authored views are missing. Order and keyset-compare `tx_hash`
 * with string literals — do not CAST bytes32 to VARCHAR (Nuthatch/DuckDB
 * returns HTTP 400 for that cast).
 */
const SELECT_COLUMNS = `SELECT
  address AS pool_address,
  block_number,
  block_hash,
  block_timestamp,
  tx_hash AS transaction_hash,
  log_index,
  amount0 AS amount0_raw,
  amount1 AS amount1_raw
FROM pool__swap`;

function safeInteger(value: number, name: string): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`);
  }
  return String(value);
}

function assertPosition(position: LargeSwapEventPosition): void {
  safeInteger(position.block_number, "position.block_number");
  safeInteger(position.log_index, "position.log_index");
  if (!TRANSACTION_HASH_PATTERN.test(position.transaction_hash)) {
    throw new Error("position.transaction_hash must be a lowercase transaction hash.");
  }
}

export function buildLargeSwapHeadQuery(indexedHead: number): string {
  const head = safeInteger(indexedHead, "indexedHead");
  return `${SELECT_COLUMNS}
WHERE block_number <= ${head}
ORDER BY block_number DESC, log_index DESC, transaction_hash ASC
LIMIT 1`;
}

export interface LargeSwapScanQueryOptions {
  readonly snapshotHead: number;
  readonly after: LargeSwapEventPosition | null;
  readonly includeAfter: boolean;
  readonly limit: number;
}

/**
 * Builds only from validated numeric coordinates and a lowercase hash. Pool,
 * token, threshold, and arbitrary request text never enter the SQL template.
 */
export function buildLargeSwapScanQuery(options: LargeSwapScanQueryOptions): string {
  const snapshotHead = safeInteger(options.snapshotHead, "snapshotHead");
  if (
    !Number.isSafeInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > LSS_SCOPE.scan.batchSize
  ) {
    throw new Error("Large-swap scan limit is outside the internal batch bound.");
  }

  let keyset = "";
  if (options.after !== null) {
    assertPosition(options.after);
    const block = safeInteger(options.after.block_number, "after.block_number");
    const log = safeInteger(options.after.log_index, "after.log_index");
    const hashOperator = options.includeAfter ? ">=" : ">";
    keyset = `
  AND (
    block_number < ${block}
    OR (block_number = ${block} AND log_index < ${log})
    OR (
      block_number = ${block}
      AND log_index = ${log}
      AND tx_hash ${hashOperator} '${options.after.transaction_hash}'
    )
  )`;
  }

  return `${SELECT_COLUMNS}
WHERE block_number <= ${snapshotHead}${keyset}
ORDER BY block_number DESC, log_index DESC, transaction_hash ASC
LIMIT ${String(options.limit)}`;
}

export const NUTHATCH_LARGE_SWAP_QUERY_ID = LSS_SCOPE.source.queryId;
export const NUTHATCH_LARGE_SWAP_VIEW = LSS_SCOPE.source.viewId;
