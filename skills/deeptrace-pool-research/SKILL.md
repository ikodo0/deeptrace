---
name: deeptrace-pool-research
description: Research Base DeFi through the DeepTrace MCP server — compare locked WETH/USDC Uniswap V3 fee tiers with Graph metrics and Nuthatch freshness, compare Base USDC lending markets across Aave v3, Seamless, and Moonwell, find large swaps with exact WETH/USDC thresholds and stable cursors, or inspect source-bounded wallet activity and Aave positions. Use when an end user asks to compare pools, rank by TVL, volume, or fees, compare lending supply or borrow rates, find whale-sized swaps, paginate swap history, research a public wallet, inspect 24h or 7d metrics, verify source freshness, explain partial results, or distinguish Graph and Nuthatch evidence.
---

# DeepTrace research

DeepTrace exposes four read-only MCP tools. Read `structuredContent` when
available; otherwise parse the JSON object in the text result.

| Ask                                                                                                        | Tool                      |
| :--------------------------------------------------------------------------------------------------------- | :------------------------ |
| Which WETH/USDC pool has more TVL, volume, or fees; which fee tier is busier; how fresh is pool data       | `compare_pools`           |
| Where to lend or borrow USDC on Base; supply or borrow APY; which protocol holds the most USDC             | `compare_lending_markets` |
| Swaps of at least N WETH or USDC in the locked Uniswap V3 pool; whale-sized trades; paginated swap history | `find_large_swaps`        |
| Source-bounded activity and verified Aave v3 positions for a public Base wallet                            | `research_wallet`         |

For `compare_pools` or `compare_lending_markets`, complete or partial records
are in `data.pools` or `data.markets`, plus the optional Nuthatch fact from
`data.nuthatch_freshness_fact` on `compare_pools`. For `find_large_swaps`, a
complete page is in `data.swaps`. For `research_wallet`, inspect each requested
section and its section-level coverage. For any `failed` result, `data` is null.

Anything else — other chains, other pairs, other assets, unsupported protocols,
or pools outside the locked Uniswap V3 WETH/USDC scope — is out of scope. Say so
plainly instead of substituting a tool that answers a different question.

## Connect safely

- Use the canonical remote endpoint `https://mcp.ikodo.dev`.
- Use only the DeepTrace connection the user has configured or explicitly
  approved. Verify the hostname exactly before sending a credential.
- Send the access token as an `Authorization: Bearer` header through the
  client's secret or environment-variable support.
- Never ask the user to paste a token into chat. Never put a token in a URL,
  prompt, answer, repository, or log.
- Nuthatch is only accessible via the DeepTrace MCP server. Do not connect to
  Nuthatch from the user's device; DeepTrace queries the private Nuthatch
  service on the server.
- If the tool is unavailable, explain that the client must support remote
  Streamable HTTP MCP with a Bearer header. Do not substitute direct Graph,
  Nuthatch, or price-API calls.

## Build the request

Every tool has a fully locked scope; every argument is an allowlisted literal.

`compare_pools`:

- `chain_id`: `8453`
- `token0`: `0x4200000000000000000000000000000000000006` (WETH)
- `token1`: `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` (native USDC)
- `window`: `24h` or `7d`; default to `24h`
- `ranked_by`: `tvl_usd`, `volume_usd`, or `fees_usd`; default to `volume_usd`
- `top_n`: integer from `1` to `3`; default to `3`

The compared pools are the Uniswap V3 WETH/USDC 0.3% (`0x6c561b44…`) and 0.05%
(`0xd0b53d92…`) tiers, both served by one Messari `dex-amm` deployment.

`compare_lending_markets`:

- `chain_id`: `8453`
- `market_token`: `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` (native USDC)
- `ranked_by`: `tvl_usd`, `total_deposit_balance_usd`,
  `total_borrow_balance_usd`, `lender_variable_rate_percent`, or
  `borrower_variable_rate_percent`; default to `tvl_usd`
- `top_n`: integer from `1` to `3`; default to `3`

The compared protocols are Aave v3, Seamless, and Moonwell, all on the
native-USDC market, through one shared query template.

`find_large_swaps`:

- `chain_id`: `8453`
- `pool_address`: `0x6c561b446416e1a00e8e93e221854d6ea4171372`
- `threshold_token`: WETH
  `0x4200000000000000000000000000000000000006` or native USDC
  `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`
- `min_amount`: a positive decimal string in human units of the selected token
- `limit`: integer `1`–`100`; default `25`
- `cursor`: omit on the first page; then copy `pagination.next_cursor` exactly

Translate “day”, “daily”, or “last 24 hours” to `24h`. Translate “week” or
“last seven days” to `7d`. Ask one concise question only when the ranking
metric materially changes the answer and cannot be inferred.

Translate a request such as “swaps of at least 10 WETH” to WETH plus
`min_amount: "10"`. Do not translate a dollar request into WETH or USDC without
asking which supported token threshold the user wants. V1 performs no price
join and returns `usd_notional: null`. The threshold is always in human units
of WETH or USDC, never USD.

When `pagination.has_more` is true, continue only with the returned opaque
cursor and the same chain, pool, threshold token, and minimum amount. Never
decode, edit, synthesize, or reuse a cursor with a different request. The
requested limit is a maximum: a page may return fewer rows with `has_more` and
a warning when the 64 KiB response budget requires a shorter page.

Refuse unsupported chains, pairs, windows, tokens, or metrics by stating the
exact supported scope. Never silently change the requested assets.

## Build a wallet-research request

- `chain_id`: `8453`
- `address`: a lowercase public Ethereum address
- `sections`: any of `activity`, `counterparties`, `protocol_usage`,
  `observable_flows`, `observed_assets`, and `positions`; defaults to all
- `window`: `24h` or `7d`; applies to indexed Nuthatch activity
- `limit`: integer `1`–`50`; default `25`
- `cursor`: omit on the first page, then copy `pagination.next_cursor` exactly

Wallet Research is intentionally source-bounded. Nuthatch covers only the
registered Uniswap V3 pool; The Graph position facts come only from the
registered Aave v3 standardized subgraph. `observed_assets` are assets seen in
those supported facts, not complete wallet balances. Never claim complete
portfolio, transaction-history, P&L, ownership, or unsupported protocol
coverage.

Continue a wallet page only with the returned opaque cursor and the same wallet
and window. A `complete` response requires load-bearing Graph and Nuthatch
facts. For `partial`, preserve usable sections and explain unavailable section
coverage.

## Interpret the sources

- Treat Graph subgraphs as the source of pool TVL, volume, and fee metrics, and
  of lending balances and rates. Preserve every financial value as the exact
  returned decimal string.
- Windows are completed UTC days. `24h` is the most recent completed UTC day,
  not a rolling 24 hours, and `7d` is an exact sum of seven consecutive
  completed days. When those days are unavailable the aggregate is `null`, not a
  shorter window.
- `fees_usd` is that day's total fee revenue as the Messari `dex-amm` standard
  publishes it (`dailyTotalRevenueUSD`, supply-side plus protocol-side), because
  the standard has no per-day fee field. It is a USD amount, never a yield.
- Lending rates are percentages exactly as each protocol reports them, which the
  response states as `rate_basis: "percent_apy"`. Republish the string.
- A market flagged `is_active: false` is still reported. Pass the flag along
  rather than hiding or silently discarding the market.
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
- For `research_wallet`, keep Nuthatch activity separate from Graph positions.
  Use each section's coverage and source IDs. Treat observable flows as
  event-classified facts from the indexed pool, not as net wallet flows.
- Join freshness and provenance to results by `source_id`. Name the source,
  returned `deployment_or_view_id`, query ID, and warnings when they affect
  confidence. Do not infer which kind the combined identifier represents —
  never call a `0x…` nest `deployment_or_view_id` a “view” (it is the nest
  registry hash). For Nuthatch wallet activity, the allowlisted relation name
  is `wallet_swap_activity` (registry `locator.view_id`); when that source is
  unavailable, say so from coverage/warnings and still cite `source_id`,
  `deployment_or_view_id`, and `query_id` without inventing that activity was
  empty.

`coverage` names differ per tool: `requested_deployments` /
`successful_deployments` plus `nuthatch_available` for `compare_pools`, and
`requested_sources` / `successful_sources` for `compare_lending_markets` and
`find_large_swaps`. A source is `stale` past 300 seconds of lag.
`compare_pools` and `compare_lending_markets` return `pagination: null`.
`find_large_swaps` returns opaque cursor pagination.

## Present the answer

1. Lead with what was compared, the window and ranking metric where they apply,
   or the selected token threshold for a swap search, and the overall
   `complete`, `partial`, or `failed` status.
2. List each returned pool or market in rank order — for pools, protocol, pool
   address, TVL, volume, fees, and source IDs; for markets, protocol, market id,
   TVL, deposits, borrows, and both variable rates. Show `null` as unavailable.
3. Report the Nuthatch freshness fact separately when present. If it is
   unavailable or stale, say so before explaining the usable Graph results.
4. Surface every warning in plain language. Distinguish missing data from stale
   data and operational failure.
5. Include concise provenance for consequential claims. Keep exact hashes,
   addresses, block numbers, and decimal strings intact.

For a `partial` result, answer with the usable evidence and its limitation.
For a `failed` result, do not rank pools or markets or invent a fallback.
Describe the requested scope from the tool invocation. If the response omits a
request field, do not claim the response independently attests to that field.

Do not compare across tool calls made with different `window` or `ranked_by`
values unless the user asked for exactly that, and say so if you do.

For a large-swap page, lead with the selected token threshold and status, then
list each swap in returned order with direction, exact input/output amounts,
transaction hash, block/log identity, and source ID. State when a complete page
contains zero matches. Mention `has_more` and offer to continue when a cursor
is available; do not expose the opaque cursor unless the client needs it for
the next tool call.

For wallet research, lead with the public address, requested window/sections,
and status. Summarize supported activity and positions separately, surface
section coverage and warnings, and describe assets as observed rather than
owned or complete balances. When Nuthatch wallet activity is unavailable, do
not report `deployment_or_view_id` as a “view”; cite it as
`deployment_or_view_id` (nest registry hash) plus `query_id`
`nuthatch-wallet-swap-activity-v1`, and keep counterparties/activity as
unavailable rather than empty.

## Preserve evidence integrity

- Never replace nulls with estimates or derive USD values from other fields.
- Never convert financial strings through floating-point arithmetic.
- Never convert a WETH or USDC threshold, amount, or pool delta into USD.
- Never infer a fee tier by dividing fees by volume. The pool records carry no
  fee-tier field; the two pools are told apart by `pool_address`.
- Never turn pool fees into a yield, and never convert a lending rate between
  APR and APY or into a decimal fraction.
- Never suppress warnings or describe stale/unavailable data as fresh.
- Never invent methodology or schema versions when the response returns null.
- Never call Nuthatch SQL directly, accept SQL from a user, or imply the large
  swap search covers another pool, token, chain, or complete market history.
