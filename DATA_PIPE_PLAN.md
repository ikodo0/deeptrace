# DeepTrace — Person 1 Implementation Plan (Live Data & Sources)

Companion to `PLAN.md`. `PLAN.md` is the shared product reference and stays
authoritative for the product contract; this file is the execution plan for the
**Person 1 / data-pipe** workstream only.

## Milestone Tracker

Tick a box when the task is done and its evidence is committed. A milestone is
only ticked when **every** sub-task under it is ticked *and* its exit criterion
has been demonstrated — not when the code merely exists.

### M0 — Unblock access and credentials

- [ ] **M0 complete** — exit: `/health` answers from the dev box, and one live gateway query returns data
  - [x] M0.1 — Graph API key created, in `.env`, gitignored
  - [x] M0.2 — two Base RPC endpoints chosen and verified
  - [x] M0.3 — CT 104 given a DHCP reservation
  - [x] M0.4 — CT 104 on the tailnet, TUN passthrough working, `tailscale serve --bg 127.0.0.1:8288` live
  - [x] M0.5 — `nuthatch --version` = 0.6.1; systemd unit paths recorded
  - [ ] M0.5a — **re-verify the Nuthatch constraints below against 0.6.1** — they
        were researched against the v0.5.0 docs. Confirm on the live instance:
        `/sql` still GET-only with the same guards, MCP still stdio-only,
        `GET /nest` still returns a registry hash, views still span hot ∪ sealed
  - [x] M0.6 — autodeploy path documented, nest location decided

### M1 — Freeze the integration contract *(day 1 — unblocks Person 2)*

- [x] **M1 complete** — exit: Person 2 can build against fixtures with no further questions
  - [x] M1.1 — `src/schemas/source-adapter.ts` written and agreed
  - [x] M1.2 — `src/registry/types.ts` written
  - [x] M1.3 — five shape-only results handed to Person 2 in complete and partial four-source scenarios
  - [x] M1.4 — `docs/CONTRACT.md` written

### M2 — Freeze the live source scope *(highest external risk)*

Execution plan: `docs/M2_PLAN.md`. Tick the boxes below only against the evidence artifacts defined there.

- [ ] **M2 complete** — exit: 3 deployment IDs + 3 pool addresses + 1 query pattern, with evidence
  - [ ] M2.1 — WETH/USDC addresses verified on-chain; native-vs-bridged USDC decided
  - [ ] M2.2 — candidate Base DEX subgraphs enumerated with subgraph + deployment IDs
  - [ ] M2.3 — every candidate live-probed via `_meta`
  - [ ] M2.4 — Tier A vs Tier B classified
  - [ ] M2.5 — three deployments picked **from one tier**; `docs/source-scope.md` written
  - [ ] M2.6 — real WETH/USDC pool on each confirmed non-zero
  - [ ] M2.7 — deployment-ID assertion strategy implemented
  - [ ] M2.8 — raw evidence captured; Person 2's fixtures replaced with real ones
  - [ ] M2.9 — `PLAN.md` `TBD` table filled in (+ Messari wording amended if Tier B)

### M3 — The Graph adapter

- [ ] **M3 complete** — exit: one call returns three valid `SourceResult`s from live data
  - [ ] M3.1 — `src/registry/index.ts` loading records, no hardcoded URLs
  - [ ] M3.2 — `src/sources/graph/client.ts` with timeout, bounded retry, key redaction
  - [ ] M3.3 — one query template covering all three deployments
  - [ ] M3.4 — `src/sources/graph/adapter.ts` mapping to the contract
  - [ ] M3.5 — schema-drift → `status: "unsupported"`
  - [ ] M3.6 — 7d aggregation implemented; unavailable ⇒ `null`, never estimated

### M4 — Build and deploy the Nuthatch nest

- [ ] **M4 complete** — exit: `/sql` returns a current `pool_swap_freshness` row from the dev box
  - [ ] M4.1 — Nuthatch pool chosen, and it is one a Graph source also covers
  - [ ] M4.2 — `nuthatch init` scaffolded into `nest/`; generated skill loaded
  - [ ] M4.3 — trimmed to `Swap` only; both `rpc_urls` set
  - [ ] M4.4 — history scoped to ~8 days
  - [ ] M4.5 — backfill complete; provenance + `*_dec` columns verified populated
  - [ ] M4.6 — `views/pool_swap_freshness.sql` authored
  - [ ] M4.7 — view described in `semantic.toml`, visible in `/schema`
  - [ ] M4.8 — `checks/*.sql` fixtures recorded; `nuthatch check` wired into CI
  - [ ] M4.9 — bundle hash cross-checked against `GET /nest` registry hash
  - [ ] M4.10 — deployed to C104; `/ready` returns 200

### M5 — The Nuthatch adapter

- [ ] **M5 complete** — exit: live `SourceResult<NuthatchFreshnessData>` with a real block hash
  - [ ] M5.1 — HTTP client against the GET surface
  - [ ] M5.2 — server guards respected (2 concurrent, sub-30 s client timeout, row/byte caps)
  - [ ] M5.3 — adapter written; `/ready` 503 → `status: "stale"`
  - [ ] M5.4 — provenance populated from `/nest` and `/schema`
  - [ ] M5.5 — `/explain` drift guard in CI

### M6 — Resilience and independent failure

- [ ] **M6 complete** — exit: all four resilience tests pass against live sources
  - [ ] M6.1 — bounded parallel fan-out with per-source timeouts
  - [ ] M6.2 — no adapter throws past its boundary
  - [ ] M6.3 — failure-injection test: one bad source, three still `ok`
  - [ ] M6.4 — credential-redaction test
  - [ ] M6.5 — determinism test on a pinned block

### M7 — Parity and live integration tests

- [ ] **M7 complete** — exit: parity report committed; live suite green
  - [ ] M7.1 — live integration tests for all four sources
  - [ ] M7.2 — Graph ↔ Nuthatch parity over a **sealed** block range
  - [ ] M7.3 — sampled rows verified against Base RPC receipts
  - [ ] M7.4 — divergences documented rather than assertions loosened
  - [ ] M7.5 — live tests skippable offline; evidence fixtures as the offline path

### M8 — Documentation and handoff

- [ ] **M8 complete** — exit: joint review passed, demo runs under two minutes
  - [ ] M8.1 — `docs/source-coverage.md`
  - [ ] M8.2 — Nuthatch coverage boundary documented (one pool, `Swap` only, ~8 days)
  - [ ] M8.3 — C104 runbook
  - [ ] M8.4 — AGPL-3.0 obligations confirmed before the repo goes public
  - [ ] M8.5 — joint review of integration and demo flow

---

## Context

`PLAN.md` commits to one vertical slice, MVP-0 `compare_pools`: compare one
token pair across three DEX deployments on one chain, plus one fresh fact that
only Nuthatch can provide, returned with coverage, freshness, provenance and
grounded AI reasoning.

Person 1 owns everything that produces **verified live source data**. Person 2
owns normalization, metrics, MCP and reasoning. Person 2 is blocked on exactly
two things — the frozen adapter contract, and one real sample response per
source — both delivered in M1/M2 so the two workstreams run in parallel from
day two.

Owned areas:

```text
src/sources/       graph/ and nuthatch/ adapters
src/registry/      source, schema and methodology registry
tests/integration/ live source tests
tests/parity/      Graph ↔ Nuthatch ↔ chain-receipt cross-checks
nest/              the Nuthatch nest (new — see M4)
```

### Locked decisions

| Item | Value |
| :--- | :--- |
| Chain | Base, `chain_id` 8453 |
| Token pair | WETH / USDC — canonical addresses resolved in M2.1 |
| Language | TypeScript (Person 2 scaffolds the project; Person 1 writes the adapters) |
| Nuthatch host | Proxmox CT 104 on node `pve`, Nuthatch v0.6.1 |
| Nuthatch transport | HTTP `GET /sql` — **not** MCP (see below) |
| Graph transport | `gateway.thegraph.com`, deployment-pinned by assertion (see M2.7) |
| Permitted data sources | **The Graph and Nuthatch only** (see below) |
| USD price source | **Subgraph-reported USD** — no external price API |

### Source constraint: The Graph and Nuthatch only

DeepTrace may read data from exactly two places: subgraphs on The Graph
decentralized network, and the local Nuthatch instance. No third-party indexed
data APIs — no CoinGecko, Dune, Covalent, Moralis, or provider "enhanced" APIs.

One clarification, because it is load-bearing: **a Base RPC endpoint is not a
data source under this rule.** It is how the chain is read, and Nuthatch cannot
index without one — RPC log polling is its only working ingestion path in
v0.6.1. Chain-direct RPC is therefore permitted for (a) Nuthatch ingestion and
(b) receipt verification in M7.3. It is *not* permitted as a query path for any
value that reaches a `SourceResult`.

Consequences that shape the build:

- **USD prices come from the subgraphs themselves** and are consumed as
  reported. Tier A exposes `lastPriceUSD` / `totalValueLockedUSD`; Tier B
  exposes `bundle.ethPriceUSD` + `token.derivedETH` alongside `totalValueLockedUSD`
  and `poolDayData.volumeUSD` / `feesUSD`. Either way the price timestamp is the
  snapshot's day/block, and the price provenance is the subgraph deployment ID.
  **Person 2's normalization must not re-price anything** — it consumes subgraph
  USD as-is and records where it came from.
- **Token identity comes from the subgraphs**, not from an RPC `decimals()` call
  or an external token list.
- **Nuthatch carries no USD at all.** It indexes raw `Swap` events with raw
  `int256` amounts. That is fine for MVP-0, whose Nuthatch fact is a freshness
  fact needing no pricing — but it means the `find_large_swaps` milestone will
  need a USD notional derived from a Graph source or computed from pool
  reserves, and that decision is deferred, not solved.
- **Backfill runs through Nuthatch's RPC infrastructure**, using two public
  endpoints for failover. RPC remains an ingestion dependency rather than a
  DeepTrace result source. Public rate limits are accepted for MVP-0.

### Hard constraints from Nuthatch v0.6.1

Verified against the published docs and `llms-full.txt`. Not negotiable:

- Supported chains are **Ethereum mainnet, Arbitrum One, Base only**.
- `nuthatch dev` **is** the serve command — there is no separate prod binary. It
  backfills, follows the tip and serves HTTP. Shutdown is graceful on SIGTERM;
  the docs ship systemd/docker recipes that run `dev` unattended.
- The HTTP API is **all GET and has no authentication, by design** — "no
  gateway/auth/metering layer in the core" is an explicit scope decision, and
  fronting it is the operator's job.
- `/sql` takes `?q=…&max_rows=N` and enforces **30 s timeout, 50,000 row cap,
  64 MiB result cap, 2 concurrent queries**. The adapter must respect the
  concurrency limit of 2.
- `nuthatch mcp` speaks MCP over **stdio**. `--url` can bridge it to a running
  instance for interactive/agent use, but the DeepTrace server path should stay
  on plain HTTP rather than depending on a stdio bridge.
- Authored `views/*.sql` span the **live hot tip ∪ sealed Parquet**, so a view
  can back a freshness fact current to the tip. Each view binds against the
  schema at load — a moved column is a loud `nuthatch check` failure.
- Every row carries `block_hash`, `_seq`, `block_timestamp`, plus `*_dec` /
  `*_overflow` siblings for big integers. These are the provenance columns.
- `GET /nest` returns nest identity **including a registry hash**. Results carry
  a citable stamp of the form `as of block N, sealed_through M, registry <hash>`
  — that is the Nuthatch provenance record.
- Factories (`[[templates]]` / `[[factories]]`) ship and are verified against
  Uniswap, if dynamic pool discovery is ever needed. MVP-0 does not need them.

### Stated concern: Messari coverage on Base

Base has the thinnest Messari-standardized DEX subgraph coverage of the three
Nuthatch-supported chains. Three *live, standardized, comparable* DEX
deployments may not exist there. `PLAN.md`'s wording assumes Messari
standardization; this is flagged now rather than discovered in week two.

**M2 resolves it empirically** and picks one tier — **never a mix**, because
mixing breaks Architecture Rule 2 ("one query pattern reusable across compatible
deployments"):

- **Tier A — Messari standardized DEX schema.** Marker entities:
  `dexAmmProtocols`, `liquidityPools`, `liquidityPoolDailySnapshots`.
- **Tier B — Uniswap-V3 native schema family.** Marker entities: `factories`,
  `pools`, `poolDayDatas`. SushiSwap V3, PancakeSwap V3 and Aerodrome Slipstream
  are V3 forks reusing this schema, so Tier B still satisfies "one reusable
  query pattern across exactly three deployments" — it just standardizes on a
  different lineage than `PLAN.md` assumed.

Tier B is a legitimate outcome, not a failure. If M2 lands on Tier B, `PLAN.md`
gets a one-line amendment and the registry records `source_type:
"native_subgraph"` instead of `"standardized_subgraph"`.

---

## The Integration Contract (frozen in M1, owned by Person 1)

Every source — Graph or Nuthatch — returns this single shape. Person 2 builds
fixtures against it; Person 1 guarantees live adapters satisfy it.

```ts
// src/schemas/source-adapter.ts  (authored by P1, lives in P2's dir — agree before editing)
type SourceStatus = "ok" | "timeout" | "error" | "unsupported" | "stale";

interface SourceResult<T> {
  source_id: string;          // matches a registry record
  source_type: "standardized_subgraph" | "native_subgraph" | "nuthatch_view";
  protocol: string;
  chain_id: 8453;
  status: SourceStatus;
  data: T | null;             // null iff status !== "ok"
  freshness: {
    indexed_block: number;
    indexed_block_timestamp: number;   // unix seconds
    indexed_block_hash?: string;       // Nuthatch always; Graph if exposed
    queried_at: number;
    has_indexing_errors?: boolean;
  } | null;
  provenance: {
    deployment_or_view_id: string;     // Qm… hash, or Nuthatch registry hash
    schema_version: string | null;
    methodology_version: string | null;
    query_id: string;                  // names the template that ran
  };
  warnings: string[];
  latency_ms: number;
}

interface PoolSourceData {
  pool_address: string;              // lowercased
  token0: { address: string; symbol: string; decimals: number };
  token1: { address: string; symbol: string; decimals: number };
  fee_tier_bps: number | null;
  tvl_usd: string | null;            // decimal strings, never floats
  volume_usd_24h: string | null;
  volume_usd_7d: string | null;
  fees_usd_24h: string | null;
  fees_usd_7d: string | null;
}

interface NuthatchFreshnessData {
  pool_address: string;
  recent_swap_count_24h: number;
  last_swap_block: number;
  last_swap_block_timestamp: number;
  last_swap_block_hash: string;
  last_swap_tx_hash: string;
  last_swap_log_index: number;
}
```

**Contract rules.** Financial values are decimal strings, never JS numbers. A
failing source returns `status !== "ok"` and `data: null` — it never throws past
the adapter boundary. Nothing beyond this shape crosses into Person 2's code.
Contract changes require both people to agree before implementation.

---

## Milestones

Each task is sized to finish in one sitting. Exit criteria are checkable. The
**Model** line is the recommendation for the agent run on that milestone.

### M0 — Unblock access and credentials

*Nothing else can start without this. Ops-heavy, stateful, easy to break.*

**Current state of C104 (measured):** `/var/lib/nuthatch` exists, owned by the
`nuthatch` user, and is **empty** — no `nuthatch.toml`, no `abis/`, no
`schema.json`. That is why the systemd unit keeps declining to start; it has no
nest to serve. Nothing listens on 8288. The container remains on DHCP at
`192.168.8.248`, pending the M0.3 reservation. Tailscale is installed with TUN
passthrough, and Serve publishes the loopback Nuthatch port at
`https://wallet-intel.tail8ae57d.ts.net`.

- **M0.1 — Graph API key.** Create one in Subgraph Studio (Free Plan = 100k
  queries/month). Store as `GRAPH_API_KEY` in `.env`; confirm `.env` is
  gitignored. The key must never appear in adapter output, warnings or logs — a
  redaction test lands in M6.4.

  Two accepted gateway forms; prefer the header form so the key never sits in a
  URL that could be logged:
  ```
  https://gateway.thegraph.com/api/<KEY>/subgraphs/id/<SUBGRAPH_ID>
  https://gateway.thegraph.com/api/subgraphs/id/<SUBGRAPH_ID>   # + Authorization: Bearer <KEY>
  ```
  Use **POST**; the gateway returns 405 on GET.

- **M0.2 — Base RPC endpoints.** Use `https://mainnet.base.org` and
  `https://base-rpc.publicnode.com`. Nuthatch round-robins `rpc_urls` with
  health-aware failover (a failing endpoint is benched on a cooldown). Both
  return Base chain ID 8453. Probe their `eth_getLogs` range limits before M4;
  the tighter provider limit sets the safe backfill window.

- **M0.3 — Pin CT 104's address.** Set a static IP or a DHCP reservation
  *before* anything points at the container. It has already moved once; the next
  drift would silently break every integration test.

- **M0.4 — Put CT 104 on the tailnet.** Recommended path: an
  identity-authenticated route with no port-forwarding and no LAN exposure, in
  front of an API that has no auth of its own.

  Unprivileged LXC needs TUN passed through. On the `pve` host, in
  `/etc/pve/lxc/104.conf`:
  ```
  lxc.cgroup2.devices.allow: c 10:200 rwm
  lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
  ```
  Then inside CT 104: install Tailscale, `tailscale up`, keep Nuthatch bound to
  `127.0.0.1:8288`, and publish it tailnet-only with:
  ```
  tailscale serve --bg 127.0.0.1:8288
  tailscale serve status
  ```
  Set `NUTHATCH_ADMIN_TOKEN` and run the served instance with `--no-admin`.

  *Fallbacks if TUN passthrough is blocked:* SSH tunnel via `pve`, or bind to
  the container's now-static LAN IP with `nuthatch dev --listen`. Both are
  strictly worse — document them as such if used.

- **M0.5 — Verify the binary and the unit.** `nuthatch --version` reports
  `0.6.1`. Record the systemd unit's `WorkingDirectory`, `User` and `ExecStart`
  now, so M4 drops nest files exactly where the unit expects them.

- **M0.6 — Pin down autodeploy.** Document which GitHub repo autodeploys, what
  it ships (binary vs. nest) and where it lands. Recommended, and it fits
  Nuthatch's model since **a nest is a git repo**: the nest lives in the
  DeepTrace repo under `nest/`, and autodeploy syncs it, runs `nuthatch check`,
  and only then restarts the unit. `nuthatch init --from <git-url>` is the
  supported alternative if the nest gets its own repo.

**Exit:** from the dev box, `curl https://c104.<tailnet>.ts.net/health` returns a
response (not connection-refused), and one authenticated GraphQL query against
any Base subgraph through `gateway.thegraph.com` returns data.

**Model: Claude Code / Opus 5.** Multi-host, stateful, partly irreversible —
networking, systemd, LXC device passthrough. This is the milestone where a
cheaper model costs an afternoon. Run it interactively, not autonomously.

---

### M1 — Freeze the integration contract (day 1 — unblocks Person 2)

*Do this first and ship it fast. Person 2 idles until it exists.*

- **M1.1** Write the `SourceResult` / `PoolSourceData` / `NuthatchFreshnessData`
  types above into `src/schemas/source-adapter.ts`. It sits in Person 2's
  directory — agree the file before writing it.
- **M1.2** Write the registry types in `src/registry/types.ts`, matching
  `PLAN.md`'s Source Registry Contract, with `chain_id: 8453`.
- **M1.3** Hand Person 2 five typed results in `tests/fixtures/sources/`: three
  healthy pool sources, one `status: "timeout"` variant with `data: null`, and
  one Nuthatch freshness result, grouped into complete and partial four-source
  scenarios. Real values are not required yet — shape correctness is.
- **M1.4** Write `docs/CONTRACT.md`: the shape, the decimal-string rule, the
  failure semantics, and the both-people-agree rule for changes.

**Exit:** Person 2 can start building against fixtures without asking anything.

**Model: Claude Code / Opus 5.** Small output, but it is the one artifact both
workstreams are pinned to for the rest of the project.

---

### M2 — Freeze the live source scope (highest external risk)

*Run in parallel with M1. This settles the Base coverage question.*

- **M2.1 — Canonical token addresses, verified via the subgraphs.** Expected:
  WETH `0x4200000000000000000000000000000000000006`, native USDC
  `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`. Do not trust these, and do not
  verify them with an RPC `decimals()` call — query the `token` entities on each
  candidate subgraph and confirm **all three deployments agree** on address,
  symbol and decimals. Cross-source agreement is a stronger check than a single
  RPC read, and it stays inside the source constraint. Explicitly decide native
  USDC vs bridged USDbC (`0xd9aa…b6ca`) and record it — pools exist for both, and
  silently mixing them corrupts every comparison.
- **M2.2 — Enumerate candidates** in Graph Explorer: Uniswap V3 Base, SushiSwap
  V3 Base, PancakeSwap V3 Base, Aerodrome / Slipstream, BaseSwap, Balancer V2
  Base. Capture the **subgraph ID and current deployment ID (`Qm…`)** for each.
- **M2.3 — Live-probe every candidate** through the gateway:
  ```graphql
  { _meta { block { number timestamp } hasIndexingErrors deployment } }
  ```
  Discard anything with `hasIndexingErrors: true` or a block far behind tip.
- **M2.4 — Classify Tier A vs Tier B** by introspecting for the marker entities
  above. Record any `schemaVersion` / `methodologyVersion` exposed.
- **M2.5 — Pick three deployments from a single tier.** Record the tier and the
  reasoning in `docs/source-scope.md`.
- **M2.6 — Find the real WETH/USDC pool on each** and confirm non-zero TVL, 24h
  volume and 24h fees. A pool that exists but is dead is not a valid source.
- **M2.7 — Pin deployments by assertion.** The gateway exposes
  `/subgraphs/id/<ID>`; there is no documented `/deployments/id/<Qm…>` route. So
  record the deployment ID in the registry and **assert `_meta.deployment`
  matches it on every query**, returning `status: "unsupported"` on mismatch.
  Subgraph IDs move when the publisher upgrades — without this assertion that
  drift silently breaks the determinism requirement in the MVP checklist.
- **M2.8 — Capture evidence.** Save one raw response per source to
  `tests/integration/__evidence__/`, and hand these to Person 2 to replace the
  M1.3 hand-written fixtures with real ones.
- **M2.9 — Fill in the `TBD` table in `PLAN.md`.** If the outcome is Tier B,
  amend the Messari wording in the same commit.

**Exit:** three deployment IDs + three pool addresses + one query pattern
returning TVL / volume / fees for all three, with captured evidence.

**Model: Sonnet 5 for the probing sweep** (M2.2–M2.3 is high-volume mechanical
HTTP work), then **Opus 5 for M2.4–M2.7** — schema-equivalence judgement and the
tier decision are exactly where a weaker model declares two incompatible schemas
"close enough" and poisons everything downstream.

---

### M3 — The Graph adapter: one query pattern, three deployments

- **M3.1** `src/registry/index.ts` — load registry records from config, expose
  lookup by `source_id` and the active set for `compare_pools`. The registry
  drives source selection, template choice, fallback order and provenance;
  nothing hardcodes a URL.
- **M3.2** `src/sources/graph/client.ts` — POST client for the gateway with a
  per-source `AbortController` timeout, one retry on 5xx/429 only, and hard key
  redaction on every error path.
- **M3.3** One tier-appropriate query template in `src/sources/graph/queries/`,
  parameterized by pool address and window. **One template, three deployments.**
  If a second template becomes necessary, M2's tier decision was wrong — stop
  and revisit it rather than papering over it.
- **M3.4** `src/sources/graph/adapter.ts` — map raw responses to
  `SourceResult<PoolSourceData>`, including `_meta.block` → `freshness` and the
  M2.7 deployment assertion.
- **M3.5** Schema-drift handling: if an introspected shape does not match the
  registered `schema_version`, return `status: "unsupported"` with a warning
  rather than silently mismapping fields.
- **M3.6** Derive 7d volume/fees from daily snapshots and record which
  aggregation was used. If a source cannot produce a 7d figure, return `null` —
  never a substitute or an estimate.

**Exit:** one function call returns three valid `SourceResult`s from live data.

**Model: Sonnet 5.** Well-specified once M2 is frozen. Escalate to Opus 5 only
if M3.5's drift handling turns subtle.

---

### M4 — Build and deploy the Nuthatch nest

- **M4.1 — Choose the Nuthatch pool.** It **must be one of the three pools
  already covered by a Graph source**, or the M7 parity tests are unwritable.
  Recommended: the Uniswap V3 Base WETH/USDC 0.05% pool.
- **M4.2 — Scaffold locally** into `nest/`:
  ```
  nuthatch init <pool_address> --chain base --alias pool
  ```
  This produces `nuthatch.toml`, `abis/`, `schema.json`, `semantic.toml`, a
  commented `views/` starter, an `llms.txt` and a Claude Code skill. **Load that
  generated skill** before authoring views — it carries the real query surface
  for this specific nest.
- **M4.3 — Trim to `Swap` only** (`events = ["Swap"]`) to keep table count and
  RSS minimal; measured footprint for a single contract is ~37 MB. Set both
  `rpc_urls` from M0.2.
- **M4.4 — Scope the history to ~8 days.** Base is ~2 s blocks, so ~345,600
  blocks. Eight days covers the 7d window with margin. Either set `start_block`
  explicitly or use `nuthatch dev --backfill N` recent-history mode. A
  full-history backfill is unnecessary for a freshness fact and wastes hours.
- **M4.5 — Backfill:**
  ```
  nuthatch dev --seal-direct --concurrency 6
  ```
  `--seal-direct` is the ~20× faster phased cold start. The docs recommend
  `--concurrency 8–16`, but that assumes a keyed provider; on public RPC start at
  **6** and tune from the 429 rate rather than starting high and getting benched.
  Use `--window` if an endpoint's `eth_getLogs` range cap (M0.2) is tighter than
  the adaptive chunker's default. Confirm rows land in `pool__swap` with
  `block_hash`, `_seq`, `block_timestamp` and the `amount0_dec` / `amount1_dec` /
  `*_overflow` siblings populated.
- **M4.6 — Author `nest/views/pool_swap_freshness.sql`** returning exactly the
  `NuthatchFreshnessData` fields: pool address, 24h swap count, last swap block /
  timestamp / hash, last swap tx hash and log index. Views span hot ∪ sealed, so
  this is current to the tip. Iterate with `nuthatch sql "…" --json`.
- **M4.7 — Describe the view in `semantic.toml`** so it surfaces through
  `/schema` with real meaning rather than raw column names.
- **M4.8 — Add `nest/checks/*.sql` fixtures** and wire `nuthatch check` into CI
  (`nuthatch check --update` records the first fixtures). This is the drift gate:
  a moved column becomes a loud failure instead of a silently wrong number.
- **M4.9 — Bundle and record identity:**
  ```
  nuthatch nest bundle
  ```
  Cross-check the content-addressed bundle hash against `GET /nest`'s registry
  hash. That value becomes the registry's `deployment_or_view_id` and the
  Nuthatch provenance stamp (`as of block N, sealed_through M, registry <hash>`).
- **M4.10 — Deploy to C104** via the M0.6 autodeploy path: sync `nest/`, run
  `nuthatch check`, restart the unit. Confirm `GET /ready` returns **200**
  (fresh), not 503 (stalled).

**Exit:**
```
curl 'https://c104.<tailnet>.ts.net/sql?q=SELECT+*+FROM+pool_swap_freshness'
```
returns a current row from the dev box.

**Model: Opus 5.** The SQL view and `semantic.toml` are small but carry the
entire "at least one returned fact depends on Nuthatch" MVP requirement, and
M4.10 touches a live service. The backfill itself (M4.5) is just waiting — run it
in the background rather than paying a model to watch it.

---

### M5 — The Nuthatch adapter

- **M5.1** `src/sources/nuthatch/client.ts` against the **GET** surface —
  `/sql?q=…&max_rows=N`, `/explain?q=…`, `/ready`, `/health`, `/schema`,
  `/nest`. Everything is GET; there are no POST bodies.
- **M5.2** Respect the server guards: **max 2 concurrent `/sql` queries**, 30 s
  server-side timeout (set the client timeout below it), 50,000 row cap, 64 MiB
  result cap. Exceeding the concurrency limit queues requests and blows the
  latency budget.
- **M5.3** `src/sources/nuthatch/adapter.ts` returning
  `SourceResult<NuthatchFreshnessData>`. Map `/ready` 503 → `status: "stale"`
  with a warning, not a hard failure — a stale-but-answering index is still
  partial coverage.
- **M5.4** Populate `provenance.deployment_or_view_id` from `GET /nest`'s
  registry hash and `schema_version` from `GET /schema`.
- **M5.5** Use `/explain` in a CI test to validate the freshness query without
  executing it — a cheap regression guard against view drift.

**Exit:** `SourceResult<NuthatchFreshnessData>` from live C104, with a real block
hash in `freshness`.

**Model: Sonnet 5.** Small, well-bounded HTTP client work against a documented
surface.

---

### M6 — Resilience, timeouts and independent failure

- **M6.1** Bounded parallel fan-out across all four sources with per-source
  timeouts. One slow source must not extend the others.
- **M6.2** No adapter ever throws past its boundary — every failure path returns
  a typed `SourceResult` with a non-`ok` status.
- **M6.3** Failure-injection test (required by the MVP checklist): point one
  Graph source at a bad deployment ID and confirm the other three still return
  `ok`.
- **M6.4** Credential-redaction test: force a gateway error and assert
  `GRAPH_API_KEY` appears nowhere in the `SourceResult`, its warnings, or the
  logs.
- **M6.5** Determinism test: query the same source twice pinned to the same
  block and assert byte-identical `data`. This is the MVP's "repeated requests
  over the same source blocks are deterministic" requirement, and it is a
  Person 1 obligation because only the adapter controls block pinning.

**Exit:** the four resilience tests pass against live sources.

**Model: Sonnet 5.** Straightforward once M3 and M5 exist; test scaffolding is
high-volume and low-judgement.

---

### M7 — Parity and live integration tests

- **M7.1** `tests/integration/` — live tests for all three Graph sources and the
  Nuthatch view, asserting contract shape and non-null freshness.
- **M7.2** `tests/parity/` — for the M4.1 pool, pull swaps from **both** the
  Graph source and Nuthatch over an identical **sealed (finalized)** block range
  and compare transaction hash, log index, token addresses, raw amounts, pool
  identity and source block. Comparing across the tip produces false mismatches
  from ordinary lag.
- **M7.3** Spot-verify N sampled Nuthatch swap rows against Base RPC
  `eth_getTransactionReceipt`, matching topic0, log index and raw data. This
  closes `PLAN.md`'s "verify sample Nuthatch events against chain receipts".
- **M7.4** Record any parity divergence as a documented known limitation rather
  than silently loosening the assertions.
- **M7.5** Mark live tests skippable in offline CI; the M2.8 evidence fixtures
  are the offline path.

**Exit:** parity report committed; live suite green.

**Model: Opus 5.** Parity failures are almost always subtle — decimal scaling,
signed `int256` amounts, log-index offsets, finality lag. Diagnosing them well is
worth the stronger model.

---

### M8 — Documentation and handoff

- **M8.1** `docs/source-coverage.md` — every registered source with tier,
  deployment ID, schema version, observed freshness lag and known limitations.
- **M8.2** Document Nuthatch's coverage boundary explicitly — one pool, `Swap`
  events only, ~8-day history, **and no USD pricing** — so Person 2's coverage
  and warnings layer states the truth rather than implying full history or
  priced data.
- **M8.3** C104 runbook: restart, re-backfill, rotate RPC endpoints, interpret
  `/ready` 503, and what autodeploy does on push.
- **M8.4** Attribution and licensing. Nuthatch is **AGPL-3.0-only**; the nest
  ships inside this repo. Confirm the obligations before the repo goes public.
- **M8.5** Joint review with Person 2 of the integration and the sub-two-minute
  demo flow.

**Model: Haiku 4.5** for M8.1–M8.3 (summarizing completed work), **Opus 5** for
M8.4 — license obligations on an AGPL dependency in a public repo are worth
careful reading.

---

## Where the Variant B control plane touches Person 1

Under Variant B the internal planner LLM may select tools and the summary LLM may
narrate, but **all source queries, normalization, calculation, coverage and
provenance stay deterministic**. For Person 1 that is one rule with no
exceptions: *no model output ever enters the source path.* The planner may choose
which registered `source_id`s to query, and nothing more — it never constructs a
GraphQL query, never writes SQL against `/sql`, never edits a freshness value.
The registry is the only thing mapping a plan to an actual endpoint, and it is
code and config, not generation. Every adapter must be callable and testable with
the LLM layer switched off entirely.

## Critical path

```text
M0 ──┬── M1 ──────────────────────────► Person 2 unblocked (day 1)
     └── M2 ──┬── M3 ──┐
              └── M4 ── M5 ──┴── M6 ── M7 ── M8
```

M4's backfill is the longest wall-clock item — start it as soon as M2.1 resolves
the pool address, and do M3 while it runs.

## Verification

End to end, once M0–M7 are done:

1. `curl https://c104.<tailnet>.ts.net/ready` → **200**.
2. `curl 'https://c104.<tailnet>.ts.net/sql?q=SELECT+*+FROM+pool_swap_freshness'`
   → a row whose `last_swap_block` is within a few blocks of Base's tip.
3. `npm test -- tests/integration` → all three Graph sources plus Nuthatch return
   `status: "ok"` with non-null freshness.
4. `npm test -- tests/parity` → Graph ↔ Nuthatch ↔ RPC receipts agree over a
   sealed range.
5. Break one source (bad deployment ID in the registry) and re-run → three `ok`,
   one non-`ok`, no exception escapes.
6. Run the same query twice against a pinned block → byte-identical `data`.
7. Force a gateway error → `GRAPH_API_KEY` appears nowhere in output or logs.

## Open items to confirm during execution

- Whether Tailscale can run inside CT 104 — unprivileged containers need the TUN
  passthrough in M0.4; the SSH-tunnel fallback is documented there.
- Whether Base yields three Tier A deployments or forces Tier B — decided in M2,
  with `PLAN.md` amended in the same commit either way.
- Native USDC vs bridged USDbC — decided in M2.1 and recorded; it must be the
  same choice across all three pools.
