-- latest_swap_identity: the view's latest-swap fields match the raw table's
-- latest row ordered by (block_number DESC, log_index DESC).
SELECT
  v.last_swap_block = r.block_number AS block_match,
  v.last_swap_block_timestamp = r.block_timestamp AS timestamp_match,
  v.last_swap_block_hash = r.block_hash AS hash_match,
  v.last_swap_tx_hash = r.tx_hash AS tx_match,
  v.last_swap_log_index = r.log_index AS log_index_match
FROM pool_swap_freshness v
CROSS JOIN (
  SELECT block_number, block_timestamp, block_hash, tx_hash, log_index
  FROM pool__swap
  ORDER BY block_number DESC, log_index DESC
  LIMIT 1
) r;
