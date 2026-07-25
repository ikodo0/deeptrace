# DeepTrace Execution Plan

## Purpose

This document turns `PLAN.md` into small implementation packets for the core logic
and MCP product. It covers Foundation through M5 and defines execution order,
dependencies, branch boundaries, ownership, and verification.

`PLAN.md` remains the product source of truth. `docs/CONTRACT.md` remains the
authoritative source-adapter boundary. This document must not introduce new product
scope.

## Current State

| Packet | State | Evidence or blocker |
| :--- | :--- | :--- |
| Source contract and fixtures | Complete | PR #4, merge `e886676` |
| FND-01 test and CI infrastructure | Complete | PR #5, merge `02b50aa` |
| FND-02 MCP stdio lifecycle | Complete | PR #6, merge `03ac0b2` |
| Source runtime validation | Complete | PR #7, merge `65eacf4` |
| FND-03 gateway primitives | Blocked | Rate limit and environment policy are not approved |
| M0-01 scope and interface freeze | Blocked | Live deployments, Nuthatch view, ranking, limits, and reasoning budget remain unresolved |
| M0-02 onward | Blocked | Depends on M0-01 unless a packet explicitly states otherwise |
| M1 | Blocked | Requires M0 release and an approved USD-threshold price/join methodology |
| M2 onward | Planned | Starts only after the preceding milestone release gate passes |

The completed source-runtime packet validates only the approved source boundary. It
does not complete the public request, canonical record, quality, reasoning, or final
response schemas in M0-02.

## Confirmed and Outstanding Decisions

### Confirmed

- Chain identifier at the source boundary: Base `8453`.
- Source types: standardized subgraph, native subgraph, and Nuthatch view.
- Source statuses: `ok`, `timeout`, `error`, `unsupported`, and `stale`.
- Financial values cross the source boundary as decimal strings or `null`.
- `"0"` is measured zero; `null` is unavailable.
- USD values are source-reported; M0 does not call an external price API or reprice
  them.
- Source responses include freshness, provenance, warnings, and latency.
- Nuthatch freshness includes indexed block hash when freshness is present.
- Source failures do not invalidate successful sibling sources.

### Outstanding for M0

- Confirmed live WETH/USDC pair or another explicit canonical pair.
- Exactly three verified live DEX deployments.
- Exact Nuthatch pool, view, and load-bearing freshness fact.
- Ranking default and deterministic tie-break policy.
- Top-N default and maximum.
- Adapter and end-to-end timeouts.
- Rate-limit values and reset policy.
- Freshness thresholds and cross-source status semantics.
- Reasoning provider order, budget, latency, and response-size limits.
- Demo fixtures derived from verified live examples rather than placeholders.

Do not infer outstanding values from fixtures. Fixtures describe the contract, not
production deployment configuration.

## Ownership and Handoffs

Task IDs in this document (`FND-*`, `M0-*` through `M5-*`) are product execution
packets. They are not source-contract revision labels.

### Source Owner

The source owner controls source retrieval, source-local mappings, registry entries,
per-source timeout/status behavior, and live/parity evidence:

```text
src/sources/
src/registry/
tests/integration/
tests/parity/
```

### Core and MCP Owner

The core owner controls runtime and public schemas, orchestration, canonical
normalization, metrics, ranking, cross-source quality, MCP policy, reasoning, unit
tests, skill, and client documentation:

```text
src/mcp/
src/tools/
src/schemas/
src/normalization/
src/metrics/
src/quality/
src/reasoning/
skill/
tests/unit/
```

### Required Source Handoffs

| Gate | Required from source owner | Needed before |
| :--- | :--- | :--- |
| H1 live scope | Pair, three deployments, Nuthatch pool/view/fact | M0-01 completion |
| H2 contract | Request/result shapes, statuses, timestamps, versions | Complete |
| H3 fixtures | Success, failure, stale, and missing-value examples | Partially complete; live-derived cases remain |
| H4 methodology | TVL, window semantics, source-reported USD policy | M0-04 |
| H5 freshness | Indexed block/time and source-lag semantics | M0-05 |
| H6 live adapters | Three Graph adapters and one Nuthatch adapter | M0-08 |
| H7 live evidence | Expected results and source-disable method | M0 release |

Core development may use validated fixtures. Live integration cannot pass its release
gate without H1 and H4-H7.

## Delivery Protocol

Each packet is one branch and one pull request:

```text
develop
  -> feature/<task-name>
  -> 1-3 focused commits
  -> full quality gate
  -> independent review
  -> squash merge into develop
  -> next dependent branch from updated develop
```

Parallel branches are allowed only when they edit disjoint paths, have no dependency
relationship, and share an already-approved interface.

Every code PR passes:

```text
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Documentation-only PRs run formatting, links/path inspection, and the full gate when
documentation changes affect executable instructions.

Follow the implementation and review policy in `AGENTS.md`.

## Foundation

### FND-01 — Test and CI Infrastructure

State: Complete in PR #5.

Delivered Vitest, test scripts, an MCP factory test, and CI test execution.

### FND-02 — MCP Stdio Lifecycle

State: Complete in PR #6.

Delivered stdio connection, reusable lifecycle construction, clean shutdown, protocol
tests, and startup documentation.

### FND-03 — Shared Gateway Primitives

Branch: `feature/gateway-primitives`

Depends on: approved rate limits, timeouts, and environment policy.

Deliver:

- typed application errors;
- injected-clock in-memory rate limiter;
- environment configuration validation;
- tests for allowed, rejected, reset, and invalid configuration cases.

Do not add authentication, HTTP transport, or persistence.

Verify:

- rejected requests call no downstream callback;
- tests do not depend on wall-clock time;
- secrets do not appear in formatted errors;
- the full quality gate passes.

## Milestone M0 — Pool Comparison

Release result: `compare_pools` compares one configured pair across three live DEX
deployments and includes one load-bearing Nuthatch freshness fact.

### M0-01 — Scope and Interface Freeze

Branch: `docs/m0-scope-interface`

Depends on: H1 plus the outstanding M0 decisions listed above.

Deliver:

- canonical pair and exactly three verified deployments;
- Nuthatch pool/view and freshness fact;
- ranking default and Top-N bounds;
- timeout, rate-limit, freshness, and reasoning limits;
- final source invocation interface;
- verified examples for all source statuses and missing-value behavior.

Verify:

- source and core owners approve the boundary;
- every M0-blocking value is explicit;
- no production value is inferred from a placeholder fixture.

### M0-02 — Public, Canonical, Quality, and Response Schemas

Branch: `feature/compare-pools-schemas`

Depends on: M0-01 and the merged source schemas.

Deliver:

- Zod request, canonical, quality, reasoning, and response schemas;
- `PoolComparisonRecord`;
- inferred TypeScript types;
- complete, partial, and failed response fixtures, including a stale source and an
  unavailable value;
- schema and fixture-validation tests.

The existing source schemas remain authoritative. Change them only through a dedicated
contract/schema PR reviewed by both owners.

Verify:

- unknown fields and unsupported inputs are rejected;
- all fixtures pass the runtime schemas used by production;
- measured zero and unavailable values remain distinct;
- source wire shapes do not leak into the public response;
- the full quality gate passes.

### M0-03 — Canonical Normalization

Branch: `feature/pool-normalization`

Depends on: M0-02.

Deliver:

- chain-aware token and pool identities;
- deterministic pair ordering independent of source token order;
- address normalization;
- deterministic pool deduplication;
- explicit handling of source-reported USD values.

M0 does not invent raw token amounts, prices, or repricing inputs that are absent from
the approved source boundary.

Verify:

- token order and address casing do not change canonical identity;
- decimal strings never pass through JavaScript floating-point arithmetic;
- unavailable USD stays explicit;
- duplicate pools collapse deterministically.

### M0-04 — Metrics and Ranking

Branch: `feature/pool-metrics-ranking`

Depends on: M0-03 and H4.

Deliver:

- versioned TVL, volume, and fee selection methodology;
- window, source, unit, and methodology references;
- deterministic descending ranking and tie-breaking;
- Top-N after normalization, validation, and deduplication.

Verify:

- fixed fixtures produce known values;
- input order does not change output;
- ties and Top-N are stable;
- fee-to-TVL ratios are not labeled APR or APY.

### M0-05 — Coverage, Freshness, Provenance, and Failure Isolation

Branch: `feature/pool-result-quality`

Depends on: M0-04 and H5.

Deliver:

- coverage for every attempted source;
- indexed block/time, query time, and known lag;
- versioned provenance and stable warnings;
- independent source settlement;
- deterministic `complete`, `partial`, and `failed` status.

Verify:

- one failed DEX preserves successful DEX records;
- Nuthatch failure preserves Graph results;
- stale and unavailable-value states are visible;
- every metric resolves to valid provenance.

### M0-06 — `compare_pools` MCP Tool

Branch: `feature/compare-pools-tool`

Depends on: M0-05 and FND-03.

Deliver:

- exactly one registered public tool, `compare_pools`;
- allowlisted validation before source access;
- injected fixture/live adapter interface;
- rate-limit and read-only enforcement;
- compact runtime-validated response.

Verify:

- invalid and rate-limited requests call no adapter;
- fixture requests return ranked canonical records;
- `tools/list` exposes only implemented public tools;
- no signing or transaction capability exists.

### M0-07 — Grounded Reasoning

Branch: `feature/pool-grounded-reasoning`

Depends on: M0-06 and approved reasoning limits.

Deliver:

- one bounded reasoning call after structured data is final;
- typed summary, highlights, caveats, and provenance references;
- citation validation;
- provider fallback and `ai_reasoning.status = "unavailable"`.

Verify:

- reasoning cannot modify structured fields;
- invalid citations are rejected;
- provider failure preserves structured data;
- latency and response-size limits are tested.

### M0-08 — Skill, Live Integration, and Release

Branch: `integration/compare-pools-live`

Depends on: M0-07 and H6-H7.

Deliver:

- live adapter wiring without public-schema changes;
- `skill/SKILL.md` for `compare_pools`;
- MCP client configuration and methodology limitations;
- live integration, source-failure, parity, and demo tests.

Verify:

- one live request returns three comparable pools;
- a returned fact depends on Nuthatch;
- identical inputs produce identical canonical ranking;
- one disabled source returns a partial result;
- reasoning cites only returned facts and provenance;
- the demo completes in under two minutes.

M0 release gate: squash-merge all M0 packets into `develop`, run the complete live
demo, then open a dedicated release PR from the reviewed `develop` state to `main`.

## Milestone M1 — Large Swap Search

Release result: `find_large_swaps` returns normalized recent swaps above an approved
threshold over a stable block range.

M1 is blocked by a product contradiction: Nuthatch is unpriced while a USD threshold
requires USD notional. Before M1-01, approve either a bounded USD join/source and
methodology or a different threshold semantic. Do not fabricate prices.

### M1-01 — Scope, Contract, and Fixtures

Branch: `feature/large-swaps-schema`

Depends on: M0 release, verified Nuthatch swap access, and resolved threshold pricing.

Deliver bounded scope, request/response schemas, canonical `SwapEvent`, and success,
duplicate, unavailable-price, partial-source, and pagination fixtures.

Verify transaction hash, log index, raw amounts, block, time, and pricing provenance
are present where applicable.

### M1-02 — Swap Normalization and Deduplication

Branch: `feature/swap-normalization`

Depends on: M1-01.

Deliver token direction, decimal normalization, event identity by chain/transaction/log
index, and approved notional handling.

Verify reversed direction, duplicates, precision, and unavailable-price cases.

### M1-03 — Thresholds and Stable Pagination

Branch: `feature/large-swap-query`

Depends on: M1-02.

Deliver threshold application after normalization, deterministic order, fixed-range
cursor pagination, page metadata, and cursor validation.

Verify no below-threshold events, duplicates, or page omissions.

### M1-04 — Tool and Release

Branch: `feature/find-large-swaps-tool`

Depends on: M1-03.

Deliver MCP registration, quality envelope, partial results, grounded reasoning, skill
updates, live integration, and parity tests.

Verify existing tools remain compatible and provider/source failure preserves valid
structured results.

## Milestone M2 — DEX Metrics

Release result: `get_dex_metrics` returns comparable protocol-level aggregates from
approved standardized DEX adapters.

### M2-01 — Scope, `MarketMetric`, and Fixtures

Branch: `feature/dex-metrics-schema`

Depends on: M1 release and verified aggregate coverage.

Deliver bounded scope, request/response schemas, canonical `MarketMetric`, and fixtures
for TVL, volume, fees, revenue, usage, and unavailable metrics.

### M2-02 — Protocol Aggregation

Branch: `feature/dex-metric-aggregation`

Depends on: M2-01.

Deliver deterministic pool-to-protocol aggregation, comparability and double-counting
rules, methodology registry entries, and requested ranking/Top-N.

Verify totals reconcile, duplicates are not counted twice, and input order is inert.

### M2-03 — APR and APY Methodologies

Branch: `feature/dex-fee-yield`

Depends on: M2-02 and verified average-TVL history.

Deliver versioned seven-day fee APR and APY only with an explicit compounding
assumption. This packet may be deferred without blocking the base M2 release.

### M2-04 — Tool and Release

Branch: `feature/get-dex-metrics-tool`

Depends on: M2-02 and optionally M2-03.

Deliver MCP registration, quality and partial-source behavior, grounded reasoning,
skill updates, and live aggregate tests.

## Milestone M3 — Wallet Research

Release result: `research_wallet` returns supported public wallet activity, assets,
protocol usage, counterparties, observable inflows, and available positions.

### M3-01 — Privacy, Scope, and Wallet Schemas

Branch: `feature/wallet-research-schema`

Depends on: M2 release and verified wallet-source coverage.

Deliver bounded scope, public-address validation, wallet schemas and fixtures, and
explicit observable-data limitations.

### M3-02 — Wallet Event Normalization

Branch: `feature/wallet-events`

Depends on: M3-01 and verified Nuthatch Transfer/Swap views.

Deliver normalized swaps/transfers, assets, counterparties, protocol usage, observable
inflows, deduplication, classification, and stable pagination.

### M3-03 — Base DeFi Positions

Branch: `feature/wallet-positions`

Depends on: M3-01 and verified position-manager coverage.

Deliver canonical `DeFiPosition`, supported LP events, asset legs, and canonical
position identity. Keep unsupported ownership and valuation explicit.

### M3-04 — Tool and Release

Branch: `feature/research-wallet-tool`

Depends on: M3-02 and M3-03.

Deliver MCP registration, section-aware coverage, partial results, compact reasoning,
skill updates, and live tests using public test addresses.

## Milestone M4 — Lending and DeFi Positions

Release result: wallet research includes selected standardized lending supply,
collateral, and borrow positions.

### M4-01 — Lending Scope and Adapter Interface

Branch: `feature/lending-position-schema`

Depends on: M3 release and verified standardized lending deployments.

Deliver bounded scope, source interface, supply/collateral/borrow fixtures, and only
methodologically supported health/risk fields.

### M4-02 — Lending Position Normalization

Branch: `feature/lending-positions`

Depends on: M4-01.

Deliver standardized `DeFiPosition` conversion, market identity, asset roles,
deduplication, valuation provenance, and partial protocol coverage.

### M4-03 — Wallet Integration and Release

Branch: `integration/wallet-lending`

Depends on: M4-02.

Deliver wallet integration, quality/reasoning/skill updates, client examples, and live
multi-protocol tests.

## Milestone M5 — Expansion

Release result: approved chains, deployments, and vault positions are added without
breaking existing tools.

### M5-01 — Registry Expansion

Branch: `feature/registry-expansion`

Depends on: approved expansion scope.

Deliver versioned registry entries, chain-aware validation, capability discovery, and
regression fixtures.

### M5-02 — Contract Discovery

Branch: `feature/contract-discovery`

Depends on: M5-01 and a verified discovery source.

Deliver bounded discovery, trust metadata, contract validation, cache/version behavior,
and unsupported-result handling. Never allow unbounded fan-out.

### M5-03 — Vault and ERC-4626 Positions

Branch: `feature/vault-positions`

Depends on: M5-01 and verified vault sources.

Deliver vault/container mapping, share/asset normalization, valuation provenance,
wallet integration, quality, reasoning, and skill updates.

### M5-04 — Expansion Regression and Release

Branch: `integration/product-expansion`

Depends on: selected M5 packets.

Deliver a cross-chain regression matrix, compatibility tests for all public tools,
updated source coverage, known limitations, and final demos.

## Release Gates

For every milestone:

1. All selected packets are squash-merged into `develop`.
2. Unit, integration, parity, reasoning, and client tests pass as applicable.
3. The milestone demo and documented rollback path are verified.
4. A dedicated release PR promotes the selected `develop` state to `main`.
5. `develop` remains the integration and recovery branch.

Do not automatically promote every experimental `develop` change to `main`.

## Agent Assignment Templates

Implementation worker:

```text
Implement <TASK-ID> from docs/EXECUTION_PLAN.md.

Read PLAN.md, docs/CONTRACT.md, AGENTS.md, and the full task section. Confirm
dependencies before editing. Work only in the assigned paths. Do not invent
unresolved product or source decisions. Add the required tests and run focused
verification plus the full quality gate. Report changed files, checks, assumptions,
and blockers. Do not commit, push, merge, or open a PR.
```

Independent review worker:

```text
Review <TASK-ID> against PLAN.md, docs/CONTRACT.md, AGENTS.md, and
docs/EXECUTION_PLAN.md.

Inspect the complete diff and relevant tests. Check correctness, compatibility,
determinism, precision, failure isolation, read-only behavior, and scope. Report
findings first by severity with file and line references. If there are no findings,
state that and list residual risks. Do not edit files.
```

## Documentation Policy

Commit:

- `PLAN.md`;
- `AGENTS.md`;
- this execution plan;
- setup, skill, methodology, source-coverage, and architecture documentation that
  remains useful after implementation.

Do not commit:

- raw agent conversations;
- temporary prompts or transcripts;
- abandoned plans;
- per-task scratch notes duplicated by a task ID or PR;
- generated status reports that immediately become stale.

When a decision changes, update an existing source-of-truth document instead of
creating another overlapping plan.
