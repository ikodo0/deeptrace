-- swap_search_parity: every search-view row matches its raw event receipt.
SELECT
  COUNT(*) AS mismatches
FROM pool_swap_search v
JOIN pool__swap r
  ON v.block_number = r.block_number
 AND v.transaction_hash = r.tx_hash
 AND v.log_index = r.log_index
WHERE v.pool_address <> r.address
   OR v.block_hash <> r.block_hash
   OR v.block_timestamp <> r.block_timestamp
   OR v.amount0_raw <> r.amount0
   OR v.amount1_raw <> r.amount1;
