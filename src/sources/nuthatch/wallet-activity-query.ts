import { WALLET_RESEARCH_SCOPE } from "../../scope/wallet-research.js";
import type { WalletResearchQueryContext } from "../../tools/wallet-query.js";

const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;

/**
 * Project the indexed pool Swap table into the wallet-activity receipt shape.
 * Query `pool__swap` directly (same projection as `wallet_swap_activity`) so
 * the adapter stays live when authored views are missing or fail to load —
 * freshness already proves `pool__swap` is queryable. Compare address and hash
 * columns with string literals; do not CAST them to VARCHAR (DuckDB rejects
 * that cast for address/bytes32 and Nuthatch returns HTTP 400).
 */
const SELECT_COLUMNS = `SELECT
  address AS pool_address,
  block_number,
  block_hash,
  block_timestamp,
  tx_hash AS transaction_hash,
  log_index,
  sender,
  recipient,
  amount0 AS amount0_raw,
  amount1 AS amount1_raw
FROM pool__swap`;

function safeInteger(value: number, field: string): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer.`);
  }
  return String(value);
}

export function buildWalletActivityHeadQuery(snapshotHead: number | null): string {
  const bound =
    snapshotHead === null
      ? ""
      : `\nWHERE block_number <= ${safeInteger(snapshotHead, "snapshotHead")}`;
  return `${SELECT_COLUMNS}${bound}
ORDER BY block_number DESC, log_index DESC, transaction_hash ASC
LIMIT 1`;
}

export function buildWalletActivityQuery(
  context: WalletResearchQueryContext,
  snapshotHead: number,
  windowStart: number,
): string {
  const wallet = context.request.address;
  if (!ADDRESS_PATTERN.test(wallet)) {
    throw new Error("Wallet address is invalid.");
  }
  const head = safeInteger(snapshotHead, "snapshotHead");
  const start = safeInteger(windowStart, "windowStart");
  const limit = WALLET_RESEARCH_SCOPE.scan.maximumRows + 1;
  return `${SELECT_COLUMNS}
WHERE block_number <= ${head}
  AND block_timestamp >= ${start}
  AND (sender = '${wallet}' OR recipient = '${wallet}')
ORDER BY block_number DESC, log_index DESC, transaction_hash ASC
LIMIT ${String(limit)}`;
}

export const NUTHATCH_WALLET_ACTIVITY_QUERY_ID = WALLET_RESEARCH_SCOPE.nuthatch.queryId;
export const NUTHATCH_WALLET_ACTIVITY_VIEW = WALLET_RESEARCH_SCOPE.nuthatch.viewId;
