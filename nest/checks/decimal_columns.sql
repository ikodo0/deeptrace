-- decimal_columns: sampled amount decimal siblings are populated when their
-- overflow flags are false. Checks the last 100 swaps.
SELECT
  COUNT(*) AS total_sampled,
  COUNT(amount0_dec) AS has_amount0_dec,
  COUNT(amount1_dec) AS has_amount1_dec,
  SUM(CASE WHEN amount0_dec IS NULL THEN 1 ELSE 0 END) AS amount0_dec_nulls,
  SUM(CASE WHEN amount1_dec IS NULL THEN 1 ELSE 0 END) AS amount1_dec_nulls
FROM pool__swap
WHERE block_number >= (SELECT MAX(block_number) - 1000 FROM pool__swap);
