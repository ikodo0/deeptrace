# DeepTrace — Product Direction and Three-Tool MVP Plan

DeepTrace is a read-only Graph Research MCP for builders and AI agents. It combines comparable protocol data from Messari Standardized Subgraphs with focused custom indexes from Nuthatch and returns compact, verifiable results.

This file is the shared product and implementation reference:

* **Global Product Goals** describe the intended DeepTrace product.
* The **three-tool MVP** is the current implementation commitment.
* Its tools ship sequentially as M0, LSS and WR.
* Protocol DEX Metrics, broader lending and expansion remain post-MVP.

## Global Product Goals

DeepTrace supports four research workflows:

1. **Wallet Research** — supported DeFi positions, swaps, protocol usage, assets and counterparties.
2. **DEX Metrics** — TVL, volume, fees, revenue and usage across three or four standardized DEX deployments.
3. **Pool Comparison** — the same token pair compared across selected protocols and chains.
4. **Large Swap Search** — recent swaps above a user-provided token-denominated
   human-unit threshold, without required USD pricing.

The first users are builders integrating on-chain research into applications and AI agents that need a small, typed tool surface.

## Current Build Target — Three-Tool MVP

The MVP public surface is implemented and accepted in this order:

```text
compare_pools
find_large_swaps
research_wallet
```

`get_dex_metrics` is post-MVP. The server registers only implemented tools.

### Tool 1 — Pool Comparison (M0)

The first implementation is one complete vertical slice:

```text
compare_pools
```

M0 compares one token pair across two same-tier DEX deployments on one chain.

It must:

* query the same compatible DEX pattern across both deployments;
* query one Nuthatch source for fresh data from a selected pool;
* normalize the results into one `PoolComparisonRecord`;
* return TVL, volume and fees for a fixed time window;
* rank the pools by one requested metric;
* return coverage, freshness and provenance;
* preserve successful results when one source is unavailable;
* return verified structured data only (no internal model call);
* expose the flow through MCP and the single `SKILL.md` for client-side presentation.

### Scope to Lock Before Coding

| Item | MVP-0 value |
| :--- | :--- |
| Chain | Base (`8453`) |
| Token pair | WETH `0x4200000000000000000000000000000000000006` / native USDC `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` |
| Standardized DEX deployments | Two Uniswap-V3-lineage native deployments (owner-amended from three): Uniswap V3 `QmVeyHjXivX8mY7bzWdbHDyA5z9ojgJdTu6uwFJsJvUzYR`, PancakeSwap V3 `QmQ1fMMrEjnmeDXn7BZMhWtFZYUQQuiDJrJP3c9oghRC9g` — see `docs/source-scope.md` |
| Nuthatch contracts/views | One of the two confirmed pools; final pick in M4.1 (prefer Uniswap V3 WETH/USDC 0.3%) |
| Time windows | `24h` and `7d` |
| Initial metrics | TVL, volume and fees |
| Ranking metric | `volume_usd` by default; TVL and fees are selectable |
| Top-N | Default and maximum `3` |
| USD price source | Source-reported USD values only; no repricing in MVP-0 |
| Public tools implemented through LSS | `compare_pools`, `find_large_swaps` |

Base does not yield three live Messari-standardized DEX deployments; MVP-0 standardizes on the Uniswap-V3 native schema family instead (`source_type: "native_subgraph"`), with an owner-approved reduction to two Graph sources. See `docs/source-scope.md`.
Core policy values are executable constants in `src/policy/m0.ts`.

### MVP-0 Definition of Done

MVP-0 is complete when:

* one live request returns comparable records for the two locked Graph pools;
* at least one returned fact depends on Nuthatch;
* repeated requests over the same source blocks are deterministic;
* one unavailable source produces a partial result rather than total failure;
* every metric identifies its source and time window;
* the client skill presents only returned facts and provenance IDs (no invented metrics);
* the complete flow can be demonstrated in under two minutes.

### Tool 2 — Large Swap Search (LSS)

`find_large_swaps` reuses the indexed Uniswap V3 pool events through a
dedicated Nuthatch swap adapter. It applies an exact WETH- or USDC-denominated
human-unit threshold and returns deterministic fixed-snapshot cursor pages. It
does not query The Graph or invent USD notionals in v1.

### Tool 3 — Wallet Research (WR)

`research_wallet` composes verified Graph wallet/account facts with Nuthatch
activity from explicitly indexed contracts. It remains Base-only,
source-bounded and section-aware; observed assets are not complete balances.

### Post-MVP Milestones

1. **Protocol DEX Metrics** — protocol-level aggregates.
2. **Lending and DeFi Positions** — broader lending within wallet research.
3. **Expansion** — additional chains, deployments, discovery and vaults.

## Project Context

DeepTrace is designed for The Graph developer-tooling, AI-use-case and composable-data tracks.

The submission should demonstrate:

* live blockchain data rather than fixtures;
* one reusable query pattern across the two verified DEX deployments in the same schema family;
* Nuthatch as a load-bearing source of a fresh pool fact;
* a reusable MCP interface and one agent skill;
* transparent composition of multiple sources;
* a short demo proving cross-protocol reuse and a Nuthatch-backed result.

Wallet-specific research remains part of the global product direction, but it is not required to prove the first vertical slice.

DeepTrace is a semantic research layer rather than another raw GraphQL gateway. Existing tools already provide generic Subgraph access and broad lending queries. DeepTrace adds:

* three MVP research operations instead of many low-level source tools;
* one canonical response contract across Graph and Nuthatch data;
* wallet- and pool-centric Nuthatch views;
* deterministic cross-source normalization and calculations;
* shared coverage, freshness and provenance semantics;
* client-side presentation via `SKILL.md` over verified structured results (no internal LLM).

## Public Interface

The MVP interface contains one `SKILL.md` and three high-level MCP tools:

```text
compare_pools
find_large_swaps
research_wallet
```

The server registers only implemented tools. `compare_pools` ships first,
`find_large_swaps` second and `research_wallet` third.

The user's AI chooses the appropriate available tool. DeepTrace retrieves and verifies the data and returns structured facts only. The user's AI + `SKILL.md` turn that payload into prose.

### Tool Contracts

| Tool | Stage | Core request | Core result |
| :--- | :--- | :--- | :--- |
| `compare_pools` | MVP tool 1 (M0) | Locked pair and chain, time window, ranking metric and Top-N | Canonical pool records plus Nuthatch freshness and deterministic cross-DEX ranking |
| `find_large_swaps` | MVP tool 2 (LSS) | Locked pool and chain, threshold token, human-unit minimum amount, limit and cursor | Stable pages of normalized Nuthatch swaps passing the non-USD threshold |
| `research_wallet` | MVP tool 3 (WR) | Public address, Base, requested supported sections, window, limit and cursor | Supported Graph positions plus Nuthatch activity, counterparties, protocol usage and observable flows |
| `get_dex_metrics` | Post-MVP | Protocols, chains, time window and requested metrics | Comparable protocol TVL, volume, fees, revenue and usage |

Every tool receives an explicit scope and returns the scope that was actually searched.

For M0 and LSS, the chain, pair, two Graph deployments, locked Uniswap pool and
Nuthatch capabilities are configuration-backed allowlisted values. Inputs
outside that scope return a clear unsupported-scope error.

### One Skill Contract

The single `SKILL.md` teaches the user's AI:

* which currently available tool matches a request;
* how to specify address, chain, protocol, pair and time-window scope;
* when to request Top-N versus paginated history;
* how to continue using `next_cursor`;
* how to interpret metric methodology;
* how to report coverage, freshness and provenance;
* how to present structured results without inventing metrics or replacing facts.

The skill documents only tools present in `tools/list`; it now covers
`compare_pools` and `find_large_swaps`.

## Global Reference Architecture

The diagram shows the intended full system. Pool Comparison and Large Swap
Search are implemented before Wallet Research.

```text
User / User's AI
        │
        ▼
DeepTrace MCP Gateway
typed tools · validation · rate limits · read-only policy
        │
        ▼
Request Validator + Deterministic Router
        │
        ├── Wallet Research       later
        ├── DEX Metrics           next
        ├── Pool Comparison       MVP-0
        └── Large Swap Search     next
        │
        ▼
Source + Coverage Registry
        │
        ├── Messari Standardized Subgraphs
        │   broad historical and cross-protocol metrics
        │
        └── Nuthatch
            selected contracts, fresh events and custom views
        │
        ▼
Canonical Normalization
identity · decimals · USD values · time windows · deduplication
        │
        ▼
Deterministic Metrics
totals · rankings · Top-N · later Fee APR/APY · threshold filters
        │
        ▼
Coverage + Freshness + Provenance
        │
        ├── Complete structured result
        └── Partial result with explicit warnings
        │
        ▼
Final MCP Response
structured facts only (status · data · coverage · freshness · provenance · warnings)
        │
        ▼
User's AI + SKILL.md
presentation · highlights · caveats · source citations (outside DeepTrace)
```

Messari and Nuthatch are parallel data backends. Nuthatch does not run remote Subgraphs, and Standardized Subgraphs do not replace the custom Nuthatch indexes.

## Architecture Rules

1. **Parallel backends:** Nuthatch does not execute or wrap remote Messari Subgraphs. DeepTrace queries both backends and merges their normalized outputs.
2. **Category-level standardization:** one query pattern is reusable across compatible DEX deployments. DEX, lending and vault categories still use separate adapters.
3. **Small public surface:** only implemented high-level tools are registered through MCP—one in MVP-0 and four at the global target. Source queries, registries, normalizers and calculators are internal code.
4. **Deterministic data path:** validation, routing, querying, unit conversion, deduplication, formulas, ranking and pagination run in code.
5. **No internal generative step:** DeepTrace never calls a model provider. Presentation belongs to the user's AI and `SKILL.md`.
6. **Read-only operation:** DeepTrace reads and explains data; it does not sign or submit blockchain transactions.
7. **Bounded research:** every result identifies the exact sources and scope that were searched.

## Data Sources

### Messari Standardized Subgraphs

Used for broad, comparable metrics across supported deployments:

* DEX protocol and pool snapshots;
* volume, TVL, fees and revenue;
* standardized lending markets and supported positions in the Wallet Research milestone;
* historical windows for ranking and comparison.

DeepTrace queries supported deployments directly through version-aware GraphQL adapters.

Standardized Schemas provide common entities and metrics inside one protocol category. They reduce adapter work but do not guarantee identical deployment freshness, schema versions or account-level coverage. The source registry records these differences.

### Existing Graph MCPs

Existing MCP projects are implementation inputs and references, not additional public DeepTrace tools:

* **Graph Lending MCP:** reference or reusable MIT-licensed implementation for lending registries, schema-version handling, positions, fan-out and graceful failures.
* **Subgraph MCP:** development-time discovery, schema inspection and raw-query verification. It is not required in the normal request path.

Compatible open-source components should be reused with attribution. The builder still connects only to DeepTrace.

### Nuthatch

Nuthatch provides focused wallet- and pool-centric indexing on one selected chain and a small verified set of contracts:

* selected pool `Swap` events for MVP-0 freshness and later large-swap filtering;
* selected ERC-20 `Transfer` events for later wallet flows and token activity;
* concentrated-liquidity position-manager events for later Wallet Research: `Transfer`, `IncreaseLiquidity`, `DecreaseLiquidity` and `Collect`;
* indexed block metadata for every returned Nuthatch view.

DeepTrace uses the query surface supported by the selected Nuthatch version, such as its HTTP API, built-in MCP or available SQL views. The integration path is verified before implementation.

### Source Registry Contract

Every configured backend has a versioned registry record:

```json
{
  "source_id": "dex-uniswap-v3-base",
  "source_type": "standardized_subgraph",
  "category": "dex",
  "protocol": "uniswap-v3",
  "chain_id": 8453,
  "deployment_or_view_id": "Qm...",
  "schema_version": "4.0.1",
  "methodology_version": "1.0.0",
  "supported_entities": ["pools", "swaps", "snapshots"],
  "status": "active"
}
```

The registry drives source selection, compatible query templates, fallback order, coverage, freshness and provenance.

## Canonical Records

Source-specific responses are converted into a small set of internal records before aggregation.

### `PoolComparisonRecord` — MVP-0

Represents one comparable pool result:

```text
chain_id
protocol
pool_address
pair
tvl_usd
volume_usd
fees_usd
window
rank
source_ids[]
```

The two DEX adapters must produce this same record before ranking. Source-specific fields may be retained in provenance, but they must not change the public comparison shape.

### `DeFiPosition` — Wallet Research milestone

A position represents one wallet's observable exposure inside one protocol container: a lending market, liquidity pool or vault.

Required fields:

```text
id
chain_id
protocol
position_type
container
assets[]
valuation
observed_at
source_ids[]
```

Planned position types:

* lending supply, collateral and borrow;
* AMM LP where the configured source exposes ownership;
* concentrated-liquidity LP from the selected position manager.

Each asset leg contains token address, symbol, decimals, role, raw amount, normalized amount, USD price and USD value when available.

### `MarketMetric`

Represents one metric for one protocol or market:

```text
metric
value
unit
window
methodology_id
input_source_ids[]
```

### `SwapEvent`

Represents one normalized swap:

```text
chain_id
protocol
pool
transaction_hash
log_index
timestamp
asset_in
asset_out
amounts
usd_notional
source_id
```

Events are deduplicated by:

```text
chain_id + transaction_hash + log_index
```

Positions are deduplicated by:

```text
chain_id + protocol + position_id
```

## Research Terminology

* **Coverage:** chains, protocols, deployments, Nuthatch views, entities and time ranges actually searched, including unavailable or unsupported portions.
* **Freshness:** last indexed block, source timestamp, query timestamp and known source lag.
* **Provenance:** evidence path for a fact or metric: chain, protocol, source type, deployment or nest/view, schema/methodology version and block/time range.
* **Protocol usage:** observable interactions with supported protocol contracts and entities, aggregated by activity type, count and available volume.
* **Observable inflows:** incoming transfers, swap outputs, lending borrows, LP withdrawals and reward claims classified by on-chain event type.
* **Large swap:** a normalized swap whose selected WETH or USDC absolute pool
  delta meets the positive human-unit threshold supplied in the request.

## Data Pipeline

For every tool call, DeepTrace:

1. validates the applicable address, pair, chain, protocol, time-window and limit inputs;
2. selects registered Subgraph deployments and Nuthatch views;
3. queries independent sources in parallel;
4. converts source responses into canonical records;
5. normalizes token identity, decimals, prices and time windows;
6. deduplicates pools, positions or events as required by the workflow;
7. calculates declared metrics in code;
8. applies ranking, Top-N and page limits;
9. attaches coverage, freshness and provenance;
10. returns successful data even when another source is unavailable.

Financial values are serialized as decimal strings. Derived metrics identify their formula, input sources and time window.

## Metric Methodology

Derived analytics are reproducible and versioned.

### MVP-0 Metrics

The first vertical slice returns TVL, volume and fees. Each value records its time window, source, unit and methodology version. DeepTrace does not label a fee-to-TVL ratio as APY.

### 7-Day Fee APR — later

```text
fee_apr = (fees_7d / average_tvl_7d) × (365 / 7)
```

The result records the seven-day window, annualization basis, TVL averaging method, methodology version, input sources and comparability warnings.

### Fee APY — after APR

APY is returned only when DeepTrace declares a compounding assumption:

```text
fee_apy = (1 + fees_7d / average_tvl_7d)^(365 / 7) - 1
```

This is a pool-level historical fee yield, not an individual LP return or a prediction. Concentrated-liquidity positions can experience different returns because of range selection, liquidity share, compounding, token prices and impermanent loss.

### USD Values

MVP-0 consumes the USD values reported by each selected source without external
repricing. Every normalized value keeps its source ID, time window, unit, methodology
version and availability status. `"0"` is measured zero; `null` is unavailable.
Missing values remain explicit rather than being replaced with model-generated
estimates. Any later feature that calculates USD values from token amounts must first
lock a separate price source and timestamp methodology.

### Rankings and Thresholds

* Rankings use the requested metric in descending order with unavailable values last.
* Ties use normalized protocol ascending, pool address ascending and source ID
  ascending, in that order.
* Top-N is applied after filtering and normalization.
* MVP-0 defaults to Top-3 and rejects values above three.
* Large-swap selection applies the request threshold after normalization using
  exact selected-token base-unit arithmetic; no USD conversion occurs.

## Reliability and Operations

* Source queries run in parallel with a default 5-second and maximum 8-second timeout.
* The complete request has a 15-second deadline and a 64 KiB response limit.
* Known source lag is `queried_at - indexed_block_timestamp`. The core quality layer
  treats lag above 300 seconds as stale coverage without rewriting the adapter-owned
  source status. Validated `ok` data is preserved, while the overall response becomes
  `partial` and includes a freshness warning.
* A failed source does not erase successful source results.
* `complete` requires all three Graph pool results and the required Nuthatch fact,
  with none stale under the core quality threshold.
* `partial` requires at least one valid Graph pool result while expected coverage is
  missing, stale or unavailable.
* `failed` means no valid Graph pool record can be compared. A Nuthatch-only result
  does not make pool comparison successful.
* Partial responses list missing coverage and explicit warnings.
* Warnings are ordered by configured source order and then warning text.
* API keys and endpoint credentials never appear in output.
* Tool inputs have size and range limits.
* Histories use cursor pagination over a stable source block range.
* Read-only policy and rate limits are enforced at the gateway.
* The default rate limit is 30 requests per 60-second fixed window. Deployment
  overrides cannot exceed 300 requests or a one-hour window, and reset occurs at the
  fixed-window boundary.

## Result Contract

Every tool returns the same top-level envelope:

```json
{
  "status": "complete",
  "data": {},
  "coverage": {},
  "freshness": {},
  "provenance": [],
  "warnings": [],
  "pagination": {
    "limit": 50,
    "returned": 0,
    "has_more": false,
    "next_cursor": null
  }
}
```

Histories use cursor pagination. The client sends `next_cursor` to continue from the last returned item; ranked analytics use Top-N by default.

### MVP-0 `compare_pools` Shape

The exact numeric values below are placeholders; the shape is the contract that builders can implement against:

```json
{
  "status": "complete",
  "data": {
    "chain_id": 8453,
    "pair": ["WETH", "USDC"],
    "window": "24h",
    "ranked_by": "volume_usd",
    "pools": [
      {
        "protocol": "protocol-a",
        "pool_address": "0x...",
        "tvl_usd": "0",
        "volume_usd": "0",
        "fees_usd": "0",
        "rank": 1,
        "source_ids": ["dex-a"]
      }
    ],
    "nuthatch_freshness_fact": {
      "pool_address": "0x...",
      "recent_swap_count": 0,
      "last_swap_block": 0,
      "source_id": "nuthatch-pool-swaps"
    }
  },
  "coverage": {
    "requested_deployments": 3,
    "successful_deployments": 3
  },
  "freshness": {},
  "provenance": [],
  "warnings": [],
  "pagination": null
}
```

`compare_pools` returns a bounded ranked set and therefore does not require pagination in MVP-0.

## Presentation Boundary (No Internal AI)

Decided 2026-07-25: DeepTrace does **not** call a model provider. After
coverage/freshness/provenance settlement, the MCP returns the verified structured
envelope only. There is no `ai_reasoning` field.

Presentation is the job of the **user's AI** guided by `SKILL.md`. That skill must:

* present only values present in `data`;
* cite `source_ids` / `provenance` when claiming facts;
* always surface `warnings`, coverage holes, and freshness status;
* never invent rankings, USD values, or Nuthatch facts.

Do not implement `src/reasoning/` or provider keys unless a later milestone
explicitly reopens internal AI.

## Suggested Project Structure

```text
src/
  mcp/             gateway, validation, routing and rate limits
  tools/           implemented public tool handlers
  sources/
    graph/         standardized GraphQL adapters and queries
    nuthatch/      Nuthatch client and view adapters
  registry/        source, schema and methodology registry
  schemas/         public and canonical typed contracts
  normalization/   identities, decimals, prices and deduplication
  metrics/         deterministic calculations and rankings
  quality/         coverage, freshness, provenance and warnings
skill/
  SKILL.md
tests/
  unit/
  integration/
  parity/
```

Internal modules may contain many functions, but only implemented high-level
handlers are registered as public MCP tools. Through LSS the registered surface
is `compare_pools` plus `find_large_swaps`.

## MVP Build Order

### 1. Freeze the Live Scope

* select the implementation language and MCP SDK;
* resolve every `TBD` in **Scope to Lock Before Coding**;
* verify that the two locked live DEX deployments expose comparable pool metrics;
* select the Nuthatch pool and the fresh fact it uniquely contributes;
* define the USD price source and timestamp policy;
* finalize `PoolComparisonRecord`, the `compare_pools` request/response schema, limits and timeouts;
* select the deployment transport.

### 2. Build the Nuthatch Path

* index `Swap` events for the selected pool or small verified pool set;
* expose the minimal view required for the declared freshness fact;
* attach indexed block metadata;
* verify sample events against chain receipts.

### 3. Build the Standardized Graph Path

* implement the source registry;
* implement one version-aware pool query pattern across the two locked DEX deployments;
* implement timeouts and independent source failures.

### 4. Build the DeepTrace Data Layer

* implement `PoolComparisonRecord`;
* decimal and price normalization;
* pool identity and deduplication;
* TVL, volume and fee methodologies;
* deterministic ranking and Top-N;
* coverage, freshness and provenance.

### 5. Expose the MCP

* implement `compare_pools`;
* write one `SKILL.md` for the available tool;
* add rate limits and read-only policy;
* add setup and client configuration.

### 6. Ship

* write one `SKILL.md` that teaches the client AI to present only returned facts;
* live integration and parity tests;
* documented source coverage;
* open-source attribution and license;
* public repository;
* demo under two minutes.

## Test Strategy

### Unit

* pair, chain, protocol, window and limit validation;
* decimal and USD normalization;
* pool identity and event deduplication;
* TVL, volume and fee methodology versions;
* deterministic ranking and Top-N;
* coverage and status calculation;
* provenance reference validation.

### Live Integration

* Nuthatch view queries;
* the two locked DEX deployments;
* a request with one intentionally unavailable source;
* block and timestamp freshness metadata.

### Parity

For selected events visible in both Graph and Nuthatch, compare transaction hash, log index, token addresses, raw amounts, pool identity and source block.

### Client Presentation (skill)

* skill instructs the client AI to cite only returned `source_ids` and surface warnings/freshness;
* no DeepTrace provider/model tests (no internal AI).

## Demo Flow

1. Submit one `compare_pools` request for the locked pair and chain.
2. Show the two normalized pool records ranked by the locked metric.
3. Show the fresh fact contributed by Nuthatch.
4. Repeat with one unavailable source and show the partial result.
5. Run `find_large_swaps`, follow one returned cursor, and show exact amounts,
   stable ordering, freshness and provenance.
6. Let the client chat pane narrate only from the structured data.
