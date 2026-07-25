-- recent_count_24h: the view's 24h count equals an independent raw-table count
-- over the same anchored window.
SELECT
  v.recent_swap_count_24h = (
    SELECT COUNT(*)
    FROM pool__swap
    WHERE block_timestamp >= (SELECT MAX(block_timestamp) - 86400 FROM pool__swap)
  ) AS count_match
FROM pool_swap_freshness v;
