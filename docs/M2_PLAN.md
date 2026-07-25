# M2 Execution Plan — Freeze the Live Source Scope

Detailed execution plan for `DATA_PIPE_PLAN.md` milestone **M2**. The tracker in
`DATA_PIPE_PLAN.md` stays authoritative for what is ticked; this document is the
how. Tick M2.x boxes only against the evidence artifacts defined here.

- **Owner:** Person 1 (data pipe)
- **Exit criterion:** three deployment IDs + three pool addresses + one query
  pattern returning TVL / volume / fees for all three, with captured evidence.
- **Hard dependency:** `GRAPH_API_KEY` in `.env` (M0.1) — required from Stage B
  onward. Nothing else in M0 gates M2. Nuthatch infra (M0.2–M0.6) is irrelevant
  to this milestone.
- **Parallel work:** Person 2 builds against the M1 fixtures throughout; M2.8
  swaps those fixtures to real values at the end.

## Execution order

The tracker numbering is not the execution order. Execute in dependency order:

```text
Stage A — no credentials needed (start now, while M0 finishes)
  A1  M2.2   enumerate candidates ............... Sonnet 5
  A2  harness build (scripts/m2/) + M2.7 helper . Sonnet 5

Stage B — needs GRAPH_API_KEY (M0.1)
  B1  M2.3   liveness sweep via _meta ........... Sonnet 5
  B2  M2.4   tier classification ................ Opus 5
  B3  M2.1   token verification + USDC decision . Opus 5
  B4  M2.5   pick three from one tier; source-scope.md ... Opus 5
  B5  M2.6   pool discovery + non-zero check .... Opus 5
  B6  M2.7   assertion validated on live traffic  Sonnet 5
  B7  M2.8   evidence packaged; fixtures real .... Sonnet 5
  B8  M2.9   PLAN.md TBD table (+ amendment?) ... Opus 5
```

M2.7 is deliberately split: the pure helper and its unit tests land in Stage A
(no network needed); the strategy is validated on live traffic in B6 because
every Stage B probe records `_meta.deployment`.

Estimated wall clock: Stage A one sitting; Stage B two sittings once the key
exists.

## Conventions (binding for all of M2)

### Gateway access

- `POST https://gateway.thegraph.com/api/subgraphs/id/<SUBGRAPH_ID>` with
  `Authorization: Bearer <GRAPH_API_KEY>`. **Never** the key-in-URL form — a
  keyed URL can leak into logs, shell history and evidence files.
- The gateway returns **405 on GET**. All probes POST.
- 15 s timeout per probe, **no retries** during scouting — a failure is itself
  evidence and must be recorded, not masked.
- Sequential requests with a ~250 ms gap. The full sweep is ~30 requests;
  politeness is free.
- The key must never appear in any artifact: harness reads `.env`, sends the
  header, and writes only `gateway_host` + `subgraph_id` into evidence.

### ID vocabulary (do not confuse these)

- **Subgraph ID** — the stable network-level identifier used in the gateway
  path. Recorded per candidate in `candidates.json`.
- **Deployment ID** — the `Qm…` hash of the deployment a subgraph ID currently
  resolves to, returned by `_meta.deployment`. It **changes when the publisher
  upgrades**. This is the value the registry pins and the M2.7 assertion checks.

### Tier markers

| Tier | Lineage | Marker entities | Versions |
| :--- | :--- | :--- | :--- |
| A | Messari standardized DEX | `dexAmmProtocols`, `liquidityPools`, `liquidityPoolDailySnapshots` | `schemaVersion` / `methodologyVersion` on the protocol entity |
| B | Uniswap-V3 native schema family | `factories`, `pools`, `poolDayDatas` | none published → registry records `null` |

- Pick three deployments **from one tier — never a mix** (Architecture Rule 2:
  one query pattern reusable across compatible deployments).
- Prefer **Tier A** if three healthy Tier A deployments exist (matches
  `PLAN.md`'s Messari wording); otherwise Tier B with the M2.9 amendment.
- A fork that renames marker entities breaks the one-template rule and is
  discarded for that reason — that is the rule working, not a problem.

### Liveness thresholds (applied in B1)

Reference block = max `_meta.block.number` seen across all candidates in the
same sweep (Base ≈ 2 s blocks, so 500 blocks ≈ 17 min).

| Verdict | Rule |
| :--- | :--- |
| healthy | ≤ 500 blocks behind reference **and** block timestamp ≤ 15 min old |
| suspect | 500–5000 behind, or 15–60 min stale → manual review, do not auto-pick |
| reject | > 5000 behind, > 60 min stale, or `hasIndexingErrors: true` |

### Token rules (B3)

- Verify **via the subgraphs**, never via RPC `decimals()` — cross-source
  agreement inside the source constraint is the stronger check.
- Expected values (verify, do not trust):
  - WETH `0x4200000000000000000000000000000000000006`, 18 decimals
  - native USDC `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`, 6 decimals
  - bridged USDbC `0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca`, 6 decimals
- **Agreement rule:** all three final deployments must agree on address, symbol
  and decimals for both pair tokens. Any disagreement halts B4.
- **USDC decision rule:** default to **native USDC**. Switch to USDbC only if
  pool liveness data forces it, uniformly across all three pools, and record
  the reason in `docs/source-scope.md`. Never mix.

### Pool selection rule (B5)

Per deployment, among pools whose tokens match the decided pair exactly:

1. highest current TVL (USD as reported by the subgraph);
2. tie-break: higher latest-complete-day volume;
3. tie-break: lexicographically lowest pool address (determinism).

A pool is valid only with TVL > 0 **and** a recent daily snapshot with
volume > 0 **and** fees > 0. A dead pool is not a source. Record the rejected
pools and why in `source-scope.md`.

### Evidence format (B7)

- Location: `tests/integration/__evidence__/m2/`, committed to git.
- One directory per candidate slug; files numbered by step:
  `01-meta.json`, `02-tier-a-marker.json`, `03-tier-b-marker.json`,
  `04-tokens.json`, `05-pools.json`, `06-snapshots.json`.
- Each file:

```json
{
  "captured_at": "2026-07-25T00:00:00Z",
  "gateway_host": "gateway.thegraph.com",
  "subgraph_id": "...",
  "query_id": "m2-meta-v1",
  "request": { "query": "..." },
  "response": { }
}
```

- No headers, no key, no keyed URL — ever. A CI-grep for the key over
  `tests/integration/__evidence__/` is part of B7 (prefigures M6.4).
- `tests/integration/__evidence__/m2/manifest.json` summarizes the sweep:
  capture time, reference block, per-candidate verdict (healthy/suspect/
  reject + tier), and the final three selections.

### Probe harness (Stage A2)

No `package.json` exists and M2 must not wait for Person 2's scaffold. The
harness is **dependency-free TypeScript run directly by Node ≥ 22.6** (dev box
has Node 26, which strips types natively):

```text
scripts/m2/
  candidates.json        M2.2 output; input to every probe
  lib/gateway.ts         POST + bearer, 15 s timeout, .env parsing, redacted errors
  lib/evidence.ts        evidence writer + manifest updater
  lib/queries.ts         the query templates below
  run-sweep.ts           B1+B2: meta + both markers per candidate
  probe-tokens.ts        B3
  probe-pools.ts         B5 (pool discovery + snapshot check)
```

Run: `node scripts/m2/run-sweep.ts`. No installs, no jq (not on the box).

`.env` parsing is five lines in `lib/gateway.ts`; fail loudly if
`GRAPH_API_KEY` is unset, and never echo it.

## Query templates

All templates live in `lib/queries.ts` with a `query_id` each (`m2-meta-v1`
etc.) so evidence names the template that ran — the same discipline the M3
adapter will follow.

**Q1 — liveness / deployment pin (B1, every candidate):**

```graphql
{ _meta { block { number timestamp hash } hasIndexingErrors deployment } }
```

**Q2 / Q3 — tier markers (B2, both sent to every candidate).** Exactly one
returning data classifies the tier; both erroring means unknown schema
(reject); both returning data is pathological (escalate).

```graphql
# Q2 Tier A marker — also harvests versions when present
{ dexAmmProtocols(first: 1) { id name schemaVersion methodologyVersion network } }

# Q3 Tier B marker
{ factories(first: 1) { id poolCount totalValueLockedUSD } }
```

**Q4 — token verification (B3, run on every healthy candidate):**

```graphql
{
  tokens(where: { id_in: [
    "0x4200000000000000000000000000000000000006",
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca"
  ] }) { id symbol name decimals }
}
```

Both lineages key `Token` by lowercase address; if a candidate errors on this
shape, introspect `__type(name: "Token")` before assuming the tokens are
absent.

**Q5 — pool discovery (B5), tier-appropriate variant only:**

```graphql
# Tier B — token0/token1 are address-sorted (WETH < USDC on Base)
{
  pools(
    where: { token0: "0x4200...0006", token1: "0x8335...2913" }
    orderBy: totalValueLockedUSD
    orderDirection: desc
  ) {
    id feeTier totalValueLockedUSD
    token0 { id symbol decimals }
    token1 { id symbol decimals }
  }
}

# Tier A — confirm field names against the live schema first (they vary by
# schema version); fallback: filter by one token, match the second client-side
{
  liquidityPools(where: { inputTokens_contains: ["0x4200...0006", "0x8335...2913"] }) {
    id name totalValueLockedUSD
    inputTokens { id symbol decimals }
  }
}
```

**Q6 — non-zero confirmation (B5), per candidate pool:**

```graphql
# Tier B
{ poolDayDatas(first: 7, orderBy: date, orderDirection: desc, where: { pool: "0x..." }) {
    date volumeUSD feesUSD tvlUSD } }

# Tier A — verify field names via
#   { __type(name: "LiquidityPoolDailySnapshot") { fields { name } } }
# before relying on them; record the observed names per deployment
{ liquidityPoolDailySnapshots(first: 7, orderBy: timestamp, orderDirection: desc,
    where: { pool: "0x..." }) {
    timestamp dailyVolumeUSD dailyTotalFeesUSD totalValueLockedUSD } }
```

Note: Q6 confirms liveness only. The real 7d aggregation and its methodology
record are M3.6 — do not build them here.

## Task plans

### A1 — M2.2: enumerate candidates

No credentials needed; do it while M0 finishes.

1. In Graph Explorer, find Base DEX subgraphs: at minimum Uniswap V3 Base,
   SushiSwap V3 Base, PancakeSwap V3 Base, Aerodrome (Slipstream), BaseSwap,
   Balancer V2 Base. Add any other Base DEX with meaningful usage found in the
   same search.
2. For each, record in `scripts/m2/candidates.json`: slug, protocol name,
   **subgraph ID**, explorer URL, and publisher. Deployment IDs are **not**
   collected here — they come from `_meta.deployment` during the sweep (B1),
   which is also the M2.7 assertion input.

**Done when:** `candidates.json` lists ≥ 6 candidates with subgraph IDs.
**Escalation:** fewer than four candidates found → flag immediately; the tier
math gets tight.

### A2 — harness + M2.7 helper (code only)

1. Build `scripts/m2/` as laid out above.
2. Implement the M2.7 assertion as a pure, tested module —
   `src/sources/graph/deployment-assertion.ts`:

```ts
export type DeploymentAssertion =
  | { readonly ok: true }
  | { readonly ok: false; readonly expected: string; readonly actual: string };

export function assertDeployment(expected: string, actual: string): DeploymentAssertion;
```

   - Exact, case-sensitive match on the full `Qm…` string.
   - Contract for M3.4 (documented in the module and in `source-scope.md`): on
     mismatch the adapter returns `status: "unsupported"`, `data: null`, a
     warning naming both hashes (hashes are credential-free), and MAY retain
     `freshness` from the live `_meta` it just read — `CONTRACT.md` permits
     non-null freshness on failed results.
3. Unit tests in `src/sources/graph/deployment-assertion.test.ts`, run with the
   dev box's native runner: `node --test src/sources/graph/`. Cases: match,
   mismatch, empty actual (source omits `deployment` → treated as mismatch
   with `actual: ""`), and a regression test that both hashes appear in the
   produced warning text but no env value does.

**Done when:** sweep runs against a dummy endpoint and writes well-formed
evidence; `node --test` green on the helper.

### B1 — M2.3: liveness sweep

1. `node scripts/m2/run-sweep.ts` — Q1 + Q2 + Q3 against every candidate.
2. Apply the liveness thresholds; manifest records verdicts.
3. Record `_meta.deployment` per candidate — this is the pinned value.

**Done when:** manifest has a verdict and a deployment ID for every candidate.
**Escalation:** fewer than three healthy candidates total → milestone blocker;
joint P1/P2 decision, do not improvise a scope change.

### B2 — M2.4: tier classification

1. Classify each healthy candidate A / B / unknown from Q2/Q3 evidence.
2. For Tier A candidates, harvest `schemaVersion` / `methodologyVersion` from
   the Q2 response. For Tier B, versions are `null` per contract.
3. If the outcome is Tier B, confirm the fork claim per candidate: the Q3
   `factories` shape must be the UniV3 lineage, not just a coincidental entity
   name — this is the judgement call this step runs a strong model for.

**Done when:** every healthy candidate has a tier in the manifest; ≥ 3 healthy
in at least one tier (else escalation as in B1).

### B3 — M2.1: token verification + USDC decision

1. `node scripts/m2/probe-tokens.ts` against every healthy candidate (Q4).
2. Check the expected addresses: correct symbol and decimals on each.
3. Decide native USDC vs USDbC per the decision rule; record it.
4. Note for B5: USDbC pools exist alongside native USDC pools on Base — the
   pair used downstream is exactly the decided one, everywhere.

**Done when:** manifest records per-candidate token agreement, and
`source-scope.md` (B4) records the USDC decision. Agreement rule across the
final three is re-checked after B4.

### B4 — M2.5: pick three, write `docs/source-scope.md`

1. Choose the tier (A preferred, B with amendment) and the three deployments:
   healthy, same tier, token-agreeing. Prefer established publishers when
   liveness is equal.
2. Write `docs/source-scope.md`: chain and pair; candidate table (every
   probed candidate with verdict, tier, and keep/discard reason); tier
   decision and rationale; the three deployments with subgraph ID, pinned
   deployment ID, versions, liveness at probe time; the USDC decision;
   liveness thresholds used; the M2.7 assertion strategy; the one-template
   commitment; evidence index; known limitations.
3. Draft the three registry records into `src/registry/records.json` matching
   `src/registry/types.ts` (Person 1 owns this directory; the loader itself is
   M3.1). `supported_entities` reflects the tier, e.g. Tier B:
   `["pools", "poolDayDatas", "tokens"]`. Nuthatch's record is **not** added
   here — its registry hash only exists after M4.9 (lands in M5.4).

**Done when:** `source-scope.md` + `records.json` committed; a reader can
derive every later decision from them without re-probing.

### B5 — M2.6: pool discovery + non-zero confirmation

1. `node scripts/m2/probe-pools.ts` — Q5 then Q6 per deployment.
2. Apply the pool selection rule; confirm the non-zero bar on the winner.
3. Re-check the M2.1 agreement rule across the final three pools' token
   entities (the pool response carries them — free cross-check).
4. Append the three pool addresses, fee tiers (Tier B `feeTier` →
   `fee_tier_bps`), rejected pools and reasons to `source-scope.md`.

**Done when:** three pool addresses, each with TVL > 0 and a recent day with
volume > 0 and fees > 0, evidenced in `05-pools.json` / `06-snapshots.json`.
**Escalation:** a picked deployment has no live pool for the decided pair →
try the next healthy same-tier candidate; if none exists, the tier decision is
wrong — revisit B2, do not mix tiers.

### B6 — M2.7: assertion validated on live traffic

1. Re-run the sweep: confirm every pinned deployment ID still matches
   `_meta.deployment`. If a publisher upgraded mid-M2, re-pin, re-probe, and
   note the drift in `source-scope.md` (this is exactly the failure M2.7
   exists to catch in production).
2. Confirm evidence files show `deployment` recorded on every query — the M3
   adapter inherits this as its per-query assertion.

**Done when:** helper tested (A2), strategy documented (B4), live evidence
shows the pinned value asserted across the sweep.

### B7 — M2.8: package evidence; make fixtures real

1. Freeze `tests/integration/__evidence__/m2/` and the manifest.
2. Rewrite `tests/fixtures/sources/index.ts` with captured values:
   - real pool/token addresses, real metric decimal strings, real blocks and
     timestamps from evidence;
   - `source_id`s renamed to the real registry `source_id`s (drop the
     `fixture-` prefixes) — **tell Person 2 in the handoff message**, values
     change but the shape does not;
   - `deployment_or_view_id` = the pinned `Qm…`; versions real or `null`;
   - the timeout variant stays a **synthetic status over real provenance**
     (third source's capture, status flipped, warning adjusted) — documented
     as such in a comment;
   - preserve the realistic null case: if one real deployment lacks 7d
     fields, its fixture keeps the nulls; otherwise keep one null-7d variant
     and mark it synthetic in the comment — Person 2's null-handling paths
     must keep test coverage;
   - the Nuthatch fixture stays shape-only — real Nuthatch evidence is M5's
     deliverable, not M2's.
3. Validate: `npm exec --yes --package=typescript -- tsc -p tsconfig.fixtures.json`
   (no local typescript install yet; this runs it via npm).
4. Redaction grep: the key string from `.env` matches nothing under
   `tests/` or `scripts/` (prefigures M6.4).

**Done when:** fixtures typecheck with real values; Person 2 has the handoff
message and the evidence paths.

### B8 — M2.9: fill `PLAN.md`

Fill the **Scope to Lock Before Coding** table:

| Item | Value |
| :--- | :--- |
| Chain | `Base` (`chain_id` 8453) |
| Token pair | WETH `0x4200…0006` / USDC `0x8335…2913` (or USDbC per B3 — write the decided one) |
| Standardized DEX deployments | the three names + deployment IDs (Tier A) — or, if Tier B, "three Uniswap-V3-lineage native deployments" with the amendment below |
| Nuthatch contracts/views | "one of the three confirmed pools; final pick in M4.1" |
| Ranking metric | `volume_usd` (default; request-overridable to `tvl_usd` / `fees_usd`) |
| USD price source | subgraph-reported USD, consumed as-is (no external price API) |

Time windows, initial metrics and the public tool are already locked in
`PLAN.md`; do not touch them.

If Tier B, add the one-line amendment in the **same commit**, e.g.:

> Base does not yield three live Messari-standardized DEX deployments; MVP-0
> standardizes on the Uniswap-V3 native schema family instead
> (`source_type: "native_subgraph"`). See `docs/source-scope.md`.

Keep it to that — no broad rewrite of `PLAN.md`.

**Done when:** no `TBD` remains in the table; Tier B amendment present iff
applicable; `DATA_PIPE_PLAN.md` M2 boxes ticked against this plan's evidence.

## Deliverables checklist (all committed)

| Artifact | From | Gates |
| :--- | :--- | :--- |
| `scripts/m2/` harness + `candidates.json` | A1–A2 | B1 |
| `src/sources/graph/deployment-assertion.ts` + test | A2 | M3.4 |
| `tests/integration/__evidence__/m2/` + manifest | B1–B5 | M2.8, M7.5 |
| `docs/source-scope.md` | B4–B5 | M3, M4.1, M8.1 |
| `src/registry/records.json` (three Graph records) | B4 | M3.1 |
| `tests/fixtures/sources/index.ts` with real values | B7 | Person 2 |
| `PLAN.md` TBD table (+ Tier B amendment iff needed) | B8 | MVP-0 start |

## Risks and escalations

| Risk | Response |
| :--- | :--- |
| M0.1 slips | Stage A still completes; Stage B starts the hour the key lands. Never probe with a borrowed/URL-embedded key. |
| < 3 healthy candidates in either tier | Milestone blocker. Joint P1/P2 decision — do not silently shrink scope or mix tiers. |
| Both tier markers answer on one deployment | Pathological schema collision — escalate, exclude the candidate. |
| Fork renamed entities (Tier B) | One-template rule breaks → discard that deployment, promote the next candidate. |
| Token disagreement across final three | Halt B4; re-verify addresses; likely a non-canonical token or wrong address. |
| Publisher upgrades mid-M2 | Re-pin via `_meta.deployment`, re-probe, log the drift in `source-scope.md`. |
| Tier A snapshot field names differ across deployments | Record observed names per deployment; if one template truly can't serve three, B2 was wrong — revisit, don't paper over (same rule as M3.3). |
| Key leaks into evidence | Redaction grep in B7 must pass before commit; rotate the key if it ever appears. |

## Handoff notes

- **To M3:** registry records exist as data (B4); the adapter wires the
  deployment assertion (A2/B6) into every query and maps schema drift to
  `status: "unsupported"`; one template per tier is already validated by
  evidence — if M3.3 needs a second template, escalate back to M2.
- **To M4.1:** the Nuthatch pool must be one of the three pools in
  `source-scope.md`; recommend the Uniswap V3 WETH/USDC pool if it won its
  selection rule, per `DATA_PIPE_PLAN.md`.
- **To Person 2 (B7):** fixtures now carry real values and real `source_id`s;
  the timeout variant is synthetic-status-over-real-provenance; Nuthatch
  fixture unchanged until M5; evidence lives at
  `tests/integration/__evidence__/m2/` with capture timestamps in the
  manifest — fixtures are point-in-time truth, not live data.
