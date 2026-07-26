---
name: deeptrace-pool-research
description: Research and compare Base DeFi markets through the DeepTrace MCP server — the locked WETH/USDC Uniswap V3 fee tiers using Graph subgraph metrics with Nuthatch swap freshness, and the Base USDC lending markets across Aave v3, Seamless, and Moonwell. Use when an end user asks to compare pools, rank by TVL, volume, or fees, compare lending supply or borrow rates, inspect 24h or 7d metrics, verify source freshness, explain partial results, or distinguish Graph and Nuthatch evidence.
---

# DeepTrace research

DeepTrace exposes two read-only MCP tools over Messari standardized subgraphs on
Base. Read `structuredContent` when available; otherwise parse the JSON object in
the text result.

| Ask | Tool |
| :--- | :--- |
| Which WETH/USDC pool has more TVL, volume, or fees; which fee tier is busier; how fresh is pool data | `compare_pools` |
| Where to lend or borrow USDC on Base; supply or borrow APY; which protocol holds the most USDC | `compare_lending_markets` |

For `complete` or `partial`, read ranked records from `data.pools` or
`data.markets`, plus the optional Nuthatch fact from
`data.nuthatch_freshness_fact` on `compare_pools`. For `failed`, `data` is null.

Anything else — other chains, other pairs, other assets, wallet positions,
individual swaps — is out of scope. Say so plainly instead of substituting a tool
that answers a different question.

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

## Build the request

Both tools have fully locked scopes; every argument is an allowlisted literal.

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

Translate “day”, “daily”, or “last 24 hours” to `24h`. Translate “week” or
“last seven days” to `7d`. Ask one concise question only when the ranking
metric materially changes the answer and cannot be inferred.

Refuse unsupported chains, pairs, windows, or metrics by stating the exact
supported scope. Never silently change the requested assets.

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
- Join freshness and provenance to results by `source_id`. Name the source,
  returned `deployment_or_view_id`, query ID, and warnings when they affect
  confidence. Do not infer which kind the combined identifier represents.

`coverage` names differ per tool: `requested_deployments` /
`successful_deployments` plus `nuthatch_available` for `compare_pools`, and
`requested_sources` / `successful_sources` for `compare_lending_markets`. A
source is `stale` past 300 seconds of lag. `pagination` is always `null`; there
is no next page to offer.

## Present the answer

1. Lead with what was compared, the window and ranking metric where they apply,
   and the overall `complete`, `partial`, or `failed` status.
2. List each returned pool or market in rank order — for pools, protocol, pool
   address, TVL, volume, fees, and source IDs; for markets, protocol, market id,
   TVL, deposits, borrows, and both variable rates. Show `null` as unavailable.
3. Report the Nuthatch freshness fact separately. If it is unavailable or
   stale, say so before explaining the usable Graph results.
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

## Preserve evidence integrity

- Never replace nulls with estimates or derive USD values from other fields.
- Never convert financial strings through floating-point arithmetic.
- Never infer a fee tier by dividing fees by volume. The pool records carry no
  fee-tier field; the two pools are told apart by `pool_address`.
- Never turn pool fees into a yield, and never convert a lending rate between
  APR and APY or into a decimal fraction.
- Never suppress warnings or describe stale/unavailable data as fresh.
- Never invent methodology or schema versions when the response returns null.
