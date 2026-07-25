-- view_shape: the freshness view returns exactly one row with all seven columns.
SELECT
  COUNT(*) AS row_count,
  COUNT(pool_address) AS has_pool_address,
  COUNT(recent_swap_count_24h) AS has_count,
  COUNT(last_swap_block) AS has_block,
  COUNT(last_swap_block_timestamp) AS has_timestamp,
  COUNT(last_swap_block_hash) AS has_block_hash,
  COUNT(last_swap_tx_hash) AS has_tx_hash,
  COUNT(last_swap_log_index) AS has_log_index
FROM pool_swap_freshness;
