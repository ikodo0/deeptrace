import { WALLET_RESEARCH_SCOPE } from "../../scope/wallet-research.js";
import type { WalletResearchQueryContext } from "../../tools/wallet-query.js";

const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;

const SELECT_COLUMNS = `SELECT
  pool_address,
  block_number,
  block_hash,
  block_timestamp,
  transaction_hash,
  log_index,
  sender,
  recipient,
  amount0_raw,
  amount1_raw
FROM ${WALLET_RESEARCH_SCOPE.nuthatch.viewId}`;

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
ORDER BY block_number DESC, log_index DESC, CAST(transaction_hash AS VARCHAR) ASC
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
  AND (CAST(sender AS VARCHAR) = '${wallet}' OR CAST(recipient AS VARCHAR) = '${wallet}')
ORDER BY block_number DESC, log_index DESC, CAST(transaction_hash AS VARCHAR) ASC
LIMIT ${String(limit)}`;
}

export const NUTHATCH_WALLET_ACTIVITY_QUERY_ID = WALLET_RESEARCH_SCOPE.nuthatch.queryId;
export const NUTHATCH_WALLET_ACTIVITY_VIEW = WALLET_RESEARCH_SCOPE.nuthatch.viewId;
