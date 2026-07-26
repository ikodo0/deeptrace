---
name: deeptrace-pool-research
description: Research the locked Base WETH/USDC scope through DeepTrace MCP. Compare pools with Graph metrics and Nuthatch freshness, or find normalized large swaps with exact WETH/USDC thresholds and stable cursors. Use for pool rankings, 24h/7d metrics, source freshness, large swaps, whale-sized trades, pagination, provenance, and partial or failed source results.
---

# DeepTrace pool and large-swap research

Use `compare_pools` for cross-pool financial rankings. Use
`find_large_swaps` for token-thresholded swap history from the locked Uniswap
V3 pool. Read `structuredContent` when available; otherwise parse the JSON
object in the text result.

For `compare_pools`, complete or partial records are in `data.pools`. For
`find_large_swaps`, a complete page is in `data.swaps`; failed data is null.

## Connect safely

- Use the canonical remote endpoint `https://mcp.ikodo.dev`.
- Use only the DeepTrace connection the user has configured or explicitly
  approved. Verify the hostname exactly before sending a credential.
- Send the access token as an `Authorization: Bearer` header through the
  client's secret or environment-variable support.
- Never ask the user to paste a token into chat. Never put a token in a URL,
  prompt, answer, repository, or log.
- Do not connect to Nuthatch from the user's device. DeepTrace queries the
  private Nuthatch service on the server.
- If the tool is unavailable, explain that the client must support remote
  Streamable HTTP MCP with a Bearer header. Do not substitute direct Graph,
  Nuthatch, or price-API calls.

## Build a pool-comparison request

Always use the locked scope:

- `chain_id`: `8453`
- `token0`: `0x4200000000000000000000000000000000000006` (WETH)
- `token1`: `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` (native USDC)
- `window`: `24h` or `7d`; default to `24h`
- `ranked_by`: `tvl_usd`, `volume_usd`, or `fees_usd`; default to `volume_usd`
- `top_n`: integer from `1` to `3`; default to `3`

Translate “day”, “daily”, or “last 24 hours” to `24h`. Translate “week” or
“last seven days” to `7d`. Ask one concise question only when the ranking
metric materially changes the answer and cannot be inferred.

Refuse unsupported chains, pairs, windows, or metrics by stating the exact
supported scope. Never silently change the requested assets.

## Build a large-swap request

Always use the released LSS scope:

- `chain_id`: `8453`
- `pool_address`: `0x6c561b446416e1a00e8e93e221854d6ea4171372`
- `threshold_token`: WETH
  `0x4200000000000000000000000000000000000006` or native USDC
  `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`
- `min_amount`: a positive decimal string in human units of the selected token
- `limit`: integer `1`–`100`; default `25`
- `cursor`: omit on the first page; then copy `pagination.next_cursor` exactly

Translate a request such as “swaps of at least 10 WETH” to WETH plus
`min_amount: "10"`. Do not translate a dollar request into WETH or USDC without
asking which supported token threshold the user wants. V1 performs no price
join and returns `usd_notional: null`.

When `pagination.has_more` is true, continue only with the returned opaque
cursor and the same chain, pool, threshold token, and minimum amount. Never
decode, edit, synthesize, or reuse a cursor with a different request.
The requested limit is a maximum: a page may return fewer rows with `has_more`
and a warning when the 64 KiB response budget requires a shorter page.

## Interpret the sources

- Treat Graph subgraphs as the source of pool TVL, volume, and fee metrics.
  Preserve every financial value as the exact returned decimal string.
- Treat Nuthatch as an independent freshness fact for indexed Uniswap V3
  `Swap` events on the registered pool. Use
  `data.nuthatch_freshness_fact.recent_swap_count_24h`, its last swap block and
  timestamp, and the corresponding freshness record only as returned.
- Treat `recent_swap_count_24h` as a distinct Nuthatch 24-hour fact. Do not
  equate it with Graph volume, fees, transaction count, or a `7d` financial
  window.
- Do not claim Nuthatch supplies USD metrics, covers every pool, or proves
  parity with a subgraph.
- Do not compare Graph and Nuthatch block heights as parity evidence unless the
  response explicitly returns a parity result.
- For `find_large_swaps`, treat `amount_in_raw` and `amount_out_raw` as signed
  pool deltas and the human amounts as exact normalized strings. The selected
  token's absolute delta is greater than or equal to `min_amount`.
- Preserve swap order, transaction hash, log index, block, timestamp, source
  ID, and cursor exactly. Do not deduplicate or reorder a returned page.
- Join freshness and provenance to results by `source_id`. Name the source,
  returned `deployment_or_view_id`, query ID, and warnings when they affect
  confidence. Do not infer which kind the combined identifier represents.

## Present the answer

1. Lead with what was compared, the window, ranking metric, and overall
   `complete`, `partial`, or `failed` status.
2. List each returned pool in rank order with protocol, pool address, TVL,
   volume, fees, and source IDs. Show `null` as unavailable.
3. Report the Nuthatch freshness fact separately. If it is unavailable or
   stale, say so before explaining the usable Graph results.
4. Surface every warning in plain language. Distinguish missing data from stale
   data and operational failure.
5. Include concise provenance for consequential claims. Keep exact hashes,
   addresses, block numbers, and decimal strings intact.

For a `partial` result, answer with the usable evidence and its limitation.
For a `failed` result, do not rank pools or invent a fallback.
Describe the requested scope from the tool invocation. If the response omits a
request field, do not claim the response independently attests to that field.

For a large-swap page, lead with the selected token threshold and status, then
list each swap in returned order with direction, exact input/output amounts,
transaction hash, block/log identity, and source ID. State when a complete page
contains zero matches. Mention `has_more` and offer to continue when a cursor
is available; do not expose the opaque cursor unless the client needs it for
the next tool call.

## Preserve evidence integrity

- Never replace nulls with estimates or derive USD values from other fields.
- Never convert financial strings through floating-point arithmetic.
- Never infer a fee tier by dividing fees by volume.
- Never suppress warnings or describe stale/unavailable data as fresh.
- Never invent methodology or schema versions when the response returns null.
- Never call Nuthatch SQL directly, accept SQL from a user, or imply the large
  swap search covers another pool, token, chain, or complete market history.
