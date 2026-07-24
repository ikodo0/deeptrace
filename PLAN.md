# DeepTrace — Product Direction and MVP-0 Plan

DeepTrace is a read-only Graph Research MCP for builders and AI agents. It combines comparable protocol data from Messari Standardized Subgraphs with focused custom indexes from Nuthatch and returns compact, verifiable results.

This file is the shared product and implementation reference:

* **Global Product Goals** describe the intended DeepTrace product.
* **MVP-0** is the only current implementation commitment.
* **Next Milestones** become active only after MVP-0 meets its definition of done.

## Global Product Goals

DeepTrace supports four research workflows:

1. **Wallet Research** — supported DeFi positions, swaps, protocol usage, assets and counterparties.
2. **DEX Metrics** — TVL, volume, fees, revenue and usage across three or four standardized DEX deployments.
3. **Pool Comparison** — the same token pair compared across selected protocols and chains.
4. **Large Swap Search** — recent swaps above a user-provided USD threshold.

The first users are builders integrating on-chain research into applications and AI agents that need a small, typed tool surface.

## Current Build Target — MVP-0

The first implementation is one complete vertical slice:

```text
compare_pools
```

MVP-0 compares one token pair across three DEX deployments on one chain.

It must:

* query the same compatible Standardized DEX pattern across all three deployments;
* query one Nuthatch source for fresh data from a selected pool;
* normalize the results into one `PoolComparisonRecord`;
* return TVL, volume and fees for a fixed time window;
* rank the pools by one requested metric;
* return coverage, freshness and provenance;
* preserve successful results when one source is unavailable;
* add grounded `ai_reasoning` only after the structured result is verified;
* expose the flow through MCP and the single `SKILL.md`.

### Scope to Lock Before Coding

| Item | MVP-0 value |
| :--- | :--- |
| Chain | `TBD` — exactly one |
| Token pair | `TBD` — exactly one canonical pair |
| Standardized DEX deployments | `TBD` — exactly three verified live deployments |
| Nuthatch contracts/views | `TBD` — one pool or a small verified set |
| Time windows | `24h` and `7d` |
| Initial metrics | TVL, volume and fees |
| Ranking metric | `TBD` from the initial metrics |
| USD price source | `TBD` — one documented source |
| Public tool implemented | `compare_pools` |

Implementation starts only after every `TBD` in this table is resolved.

### MVP-0 Definition of Done

MVP-0 is complete when:

* one live request returns comparable records for three pools;
* at least one returned fact depends on Nuthatch;
* repeated requests over the same source blocks are deterministic;
* one unavailable source produces a partial result rather than total failure;
* every metric identifies its source and time window;
* AI reasoning references only returned facts and provenance IDs;
* the complete flow can be demonstrated in under two minutes.

## Next Milestones

1. **Large Swap Search** — reuse the Nuthatch swap path and add explicit USD-threshold filtering.
2. **DEX Metrics** — expose protocol-level aggregates using the existing standardized adapters.
3. **Wallet Research** — add supported positions, swaps, assets, protocol usage and counterparties.
4. **Lending and DeFi Positions** — add selected standardized lending deployments and `DeFiPosition`.
5. **Expansion** — additional chains, deployments, contract discovery and vault/ERC-4626 positions.

## Project Context

DeepTrace is designed for The Graph developer-tooling, AI-use-case and composable-data tracks.

The submission should demonstrate:

* live blockchain data rather than fixtures;
* one reusable query pattern across exactly three DEX deployments in the same standardized category;
* Nuthatch as a load-bearing source of a fresh pool fact;
* a reusable MCP interface and one agent skill;
* transparent composition of multiple sources;
* a short demo proving cross-protocol reuse and a Nuthatch-backed result.

Wallet-specific research remains part of the global product direction, but it is not required to prove the first vertical slice.

DeepTrace is a semantic research layer rather than another raw GraphQL gateway. Existing tools already provide generic Subgraph access and broad lending queries. DeepTrace adds:

* four stable research operations instead of many low-level source tools;
* one canonical response contract across Graph and Nuthatch data;
* wallet- and pool-centric Nuthatch views;
* deterministic cross-source normalization and calculations;
* shared coverage, freshness and provenance semantics;
* permanent grounded AI reasoning over verified results.

## Public Interface

The planned DeepTrace interface contains one `SKILL.md` and four high-level MCP tools:

```text
research_wallet
get_dex_metrics
compare_pools
find_large_swaps
```

MVP-0 registers only `compare_pools`. The remaining tools are added in the order defined under **Next Milestones**.

The user's AI chooses the appropriate available tool. DeepTrace retrieves and verifies the data, applies its internal reasoning layer, and returns both structured facts and a grounded explanation.

### Tool Contracts

| Tool | Stage | Core request | Core result |
| :--- | :--- | :--- | :--- |
| `compare_pools` | MVP-0 | Configured token pair and chain, time window, ranking metric and Top-N | Canonical pool records and deterministic cross-DEX ranking |
| `find_large_swaps` | Next | Protocols or pools, chains, time window, USD threshold, limit and cursor | Recent swaps whose normalized USD notional passes the threshold |
| `get_dex_metrics` | Next | Protocols, chains, time window and requested metrics | Comparable protocol TVL, volume, fees, revenue and usage |
| `research_wallet` | Later | Address, chains, protocols, requested sections, time window, limit and cursor | Supported positions, swaps, assets, protocol usage, counterparties and observable inflows |

Every tool receives an explicit scope and returns the scope that was actually searched.

For MVP-0, the chain, pair and three deployments are configuration-backed allowlisted values. Inputs outside that locked scope return a clear unsupported-scope error rather than starting open-ended source discovery.

### One Skill Contract

The single `SKILL.md` teaches the user's AI:

* which currently available tool matches a request;
* how to specify address, chain, protocol, pair and time-window scope;
* when to request Top-N versus paginated history;
* how to continue using `next_cursor`;
* how to interpret metric methodology;
* how to report coverage, freshness and provenance;
* how to present `ai_reasoning` without replacing structured facts.

During MVP-0 the skill documents `compare_pools` only. Future tool instructions are added when those tools are implemented.

## Global Reference Architecture

The diagram shows the intended full system. MVP-0 implements only the `Pool Comparison` path and the shared layers below it.

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
DeepTrace AI Reasoning
grounded explanation · highlights · caveats · source references
        │
        ▼
Final MCP Response
structured facts + ai_reasoning
```

Messari and Nuthatch are parallel data backends. Nuthatch does not run remote Subgraphs, and Standardized Subgraphs do not replace the custom Nuthatch indexes.

## Architecture Rules

1. **Parallel backends:** Nuthatch does not execute or wrap remote Messari Subgraphs. DeepTrace queries both backends and merges their normalized outputs.
2. **Category-level standardization:** one query pattern is reusable across compatible DEX deployments. DEX, lending and vault categories still use separate adapters.
3. **Small public surface:** only implemented high-level tools are registered through MCP—one in MVP-0 and four at the global target. Source queries, registries, normalizers and calculators are internal code.
4. **Deterministic data path:** validation, routing, querying, unit conversion, deduplication, formulas, ranking and pagination run in code.
5. **Reasoning after verification:** the internal model receives the final quality-checked payload. It does not create source records or change calculated fields.
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
  "source_id": "dex-uniswap-v3-mainnet",
  "source_type": "standardized_subgraph",
  "category": "dex",
  "protocol": "uniswap-v3",
  "chain_id": 1,
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

The three DEX adapters must produce this same record before ranking. Source-specific fields may be retained in provenance, but they must not change the public comparison shape.

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
* **Large swap:** a normalized swap whose USD notional passes the threshold supplied in the request.

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

Every normalized USD value records:

* price;
* price timestamp;
* price source;
* token amount used;
* status when no supported price is available.

Missing prices remain explicit rather than being replaced with model-generated estimates.

### Rankings and Thresholds

* Rankings use the requested metric and deterministic tie-breaking.
* Top-N is applied after filtering and normalization.
* Large-swap selection applies the request threshold to normalized USD notional.

## Reliability and Operations

* Source queries run in parallel with bounded timeouts.
* A failed source does not erase successful source results.
* Responses use `complete`, `partial` or `failed` status.
* Partial responses list missing coverage and explicit warnings.
* API keys and endpoint credentials never appear in output.
* Tool inputs have size and range limits.
* Histories use cursor pagination over a stable source block range.
* Read-only policy and rate limits are enforced at the gateway.

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
  },
  "ai_reasoning": {
    "status": "complete",
    "summary": "",
    "highlights": [],
    "caveats": [],
    "source_ids": []
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
    "chain_id": 1,
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
  "pagination": null,
  "ai_reasoning": {
    "status": "complete",
    "summary": "",
    "highlights": [],
    "caveats": [],
    "source_ids": []
  }
}
```

`compare_pools` returns a bounded ranked set and therefore does not require pagination in MVP-0.

## AI Reasoning Layer

AI reasoning is a permanent DeepTrace capability. It runs after normalization, deterministic metrics and the coverage gate.

The reasoning layer receives:

* the validated user request;
* the final structured result;
* versioned metric formulas;
* coverage and freshness;
* provenance identifiers.

It produces:

* a concise factual summary;
* important relationships and highlights;
* explanations of derived metrics;
* explicit caveats for partial coverage or stale sources;
* references to provenance records used in the explanation.

The reasoning implementation lives in:

```text
src/reasoning/
```

It uses one bounded model call and writes only to `ai_reasoning`. Structured `data`, metrics, coverage, freshness and provenance remain the source of truth.

The reasoning output follows a typed schema. Every referenced source ID must exist in `provenance`. If the model provider is temporarily unavailable, DeepTrace still returns the verified structured result with `ai_reasoning.status` set to `unavailable`.

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
  reasoning/       permanent grounded AI reasoning
skill/
  SKILL.md
tests/
  unit/
  integration/
  parity/
```

Internal modules may contain many functions, but only implemented high-level handlers are registered as public MCP tools. MVP-0 registers `compare_pools` only.

## MVP Build Order

### 1. Freeze the Live Scope

* select the implementation language and MCP SDK;
* resolve every `TBD` in **Scope to Lock Before Coding**;
* verify that exactly three live DEX deployments expose comparable pool metrics;
* select the Nuthatch pool and the fresh fact it uniquely contributes;
* define the USD price source and timestamp policy;
* finalize `PoolComparisonRecord`, the `compare_pools` request/response schema, limits and timeouts;
* select the model provider, model, reasoning schema and latency budget;
* select the deployment transport.

### 2. Build the Nuthatch Path

* index `Swap` events for the selected pool or small verified pool set;
* expose the minimal view required for the declared freshness fact;
* attach indexed block metadata;
* verify sample events against chain receipts.

### 3. Build the Standardized Graph Path

* implement the source registry;
* implement one version-aware pool query pattern across exactly three DEX deployments;
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

### 6. Integrate AI Reasoning

* implement the reasoning module against its typed output schema;
* add one bounded model call and graceful provider fallback;
* validate every reasoning source reference against provenance;
* test factual consistency, latency and response size.

### 7. Ship

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
* exactly three Standardized DEX deployments;
* a request with one intentionally unavailable source;
* block and timestamp freshness metadata.

### Parity

For selected events visible in both Graph and Nuthatch, compare transaction hash, log index, token addresses, raw amounts, pool identity and source block.

### AI Reasoning

* summary facts exist in the structured payload;
* cited source IDs exist in provenance;
* derived metrics are explained with the registered methodology;
* partial coverage appears in caveats;
* provider failure preserves the structured result;
* latency and output size remain within configured limits.

## Demo Flow

1. Submit one `compare_pools` request for the locked pair and chain.
2. Show three normalized pool records ranked by the locked metric.
3. Show the fresh fact contributed by Nuthatch.
4. Repeat with one unavailable source and show the partial result.
5. Show coverage, freshness, provenance and grounded `ai_reasoning`.
