-- provenance_not_null: every sampled swap row has populated block and
-- transaction provenance columns.
SELECT
  COUNT(*) AS total_rows,
  COUNT(block_number) AS has_block_number,
  COUNT(block_hash) AS has_block_hash,
  COUNT(block_timestamp) AS has_block_timestamp,
  COUNT(tx_hash) AS has_tx_hash,
  COUNT(log_index) AS has_log_index,
  COUNT(_seq) AS has_seq
FROM pool__swap
WHERE block_number >= (SELECT MAX(block_number) - 1000 FROM pool__swap);
