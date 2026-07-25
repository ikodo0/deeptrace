-- hot_sealed_no_duplicates: no duplicate logical event identity exists
-- across the hot/sealed storage seam.
SELECT
  COUNT(*) AS duplicate_count
FROM (
  SELECT block_number, tx_hash, log_index, COUNT(*) AS cnt
  FROM pool__swap
  GROUP BY block_number, tx_hash, log_index
  HAVING COUNT(*) > 1
) dups;
