-- pool_swap_freshness: one row summarizing recent swap activity for the
-- Uniswap V3 Base WETH/USDC 0.3% pool (feeTier 3000). Anchored to the latest indexed
-- swap timestamp — no wall clock, no CURRENT_TIMESTAMP, no now().
-- Described in semantic.toml under [view].

CREATE VIEW pool_swap_freshness AS
SELECT
  '0x6c561b446416e1a00e8e93e221854d6ea4171372' AS pool_address,
  (
    SELECT COUNT(*)
    FROM pool__swap
    WHERE block_timestamp >= (
      SELECT MAX(block_timestamp) - 86400 FROM pool__swap
    )
  ) AS recent_swap_count_24h,
  latest.block_number AS last_swap_block,
  latest.block_timestamp AS last_swap_block_timestamp,
  latest.block_hash AS last_swap_block_hash,
  latest.tx_hash AS last_swap_tx_hash,
  latest.log_index AS last_swap_log_index
FROM (
  SELECT block_number, block_timestamp, block_hash, tx_hash, log_index
  FROM pool__swap
  ORDER BY block_number DESC, log_index DESC
  LIMIT 1
) AS latest;
