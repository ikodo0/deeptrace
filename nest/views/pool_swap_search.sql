-- pool_swap_search: canonical raw fields needed by the bounded Large Swap
-- Search adapter. Thresholding remains in DeepTrace so int256 pool deltas are
-- compared with exact BigInt arithmetic after canonical normalization.

CREATE VIEW pool_swap_search AS
SELECT
  address AS pool_address,
  block_number,
  block_hash,
  block_timestamp,
  tx_hash AS transaction_hash,
  log_index,
  amount0 AS amount0_raw,
  amount1 AS amount1_raw
FROM pool__swap;
