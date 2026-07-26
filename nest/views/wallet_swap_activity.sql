-- wallet_swap_activity: sender/recipient-aware rows for the bounded Wallet
-- Research adapter. Wallet filtering and fixed-snapshot pagination remain in
-- DeepTrace; this view exposes only the indexed allowlisted pool.

CREATE VIEW wallet_swap_activity AS
SELECT
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
FROM pool__swap;
