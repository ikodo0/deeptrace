# P0 Contract Delta — installed Nuthatch 0.6.1 vs the M4 plan

Task 3, partial: CLI surface only. Ruled by Agent 1 against the committed
evidence in `p0-cli-help/`, cross-checked against an independent capture by a
second agent (byte-identical for all six commands).

Binary: `/home/arch/.local/bin/nuthatch`, `nuthatch 0.6.1`,
sha256 `cac413574b1a7c5536c65403abacc0ae9ce699f2580ae01773e28bb2f0d65e89`.

The HTTP surface is **not** covered here. Every claim about `/sql`, `/nest`,
`/schema`, `/ready`, guards, implicit columns, and hot ∪ sealed view coverage
remains unverified until the HTTP probes run.

## Confirmed — the plan was right

| Plan claim | Evidence |
| :--- | :--- |
| `nuthatch dev --seal-direct --concurrency N` | `dev.txt` — both flags exist, `--seal-direct` is RFC-0004 phased cold start |
| `--window` overrides the `eth_getLogs` range | `dev.txt` |
| `--no-admin` disables the admin UI | `dev.txt` — UI is `/_admin/`; off-localhost it also requires `NUTHATCH_ADMIN_TOKEN` per request |
| Default listener `127.0.0.1:8288` | `dev.txt` |
| `nuthatch check --update` records fixtures | `check.txt` — writes `checks/expected/*.json`, "authoring mode, run once against known-good sealed data" |
| `nuthatch nest bundle` is content-addressed | `nest.txt` — bundles authored inputs plus a `manifest.json` pinning the expected decode-registry hash |
| MCP is stdio-only, bridging to a running `dev` | `mcp.txt` |
| `nuthatch init <address> --chain base --alias pool` | `init.txt` — addresses positional, `--alias` comma-separated, `--chain` optional |
| Table naming `{alias}__{event}` | `sql.txt` — so the Swap table is `pool__swap` |

## Corrections — the plan must change

### 1. `--backfill` overrides vendored start blocks (P0 question 10: answered)

`dev.txt`: "Index only this many blocks back from the tip (recent-history
mode). **Explicitly overrides a nest's vendored `start_block`s**."

M4.4 requires a persisted, immutable start block. Therefore `--backfill` must
never appear in production runtime arguments, including
`NUTHATCH_EXTRA_ARGS` in `/etc/default/nuthatch`. The two mechanisms are
alternatives, not complements, and the flag silently wins.

### 2. `--concurrency` defaults to 1 and the binary warns against high values

`dev.txt`: "Try 8-16 against your own node; **keep low on rate-limited public
RPC** [default: 1]".

`DATA_PIPE_PLAN.md` quotes "docs recommend 8–16" as the baseline and this plan
starts at 6. Against credential-free public endpoints, 6 is already toward the
aggressive end of what the binary itself advises. Start lower and raise it only
while watching the 429 rate.

### 3. Keyed RPC endpoints do not need config interpolation

`dev.txt`: `--rpc <RPC>` — "Override the nest's `rpc_urls` at runtime without
editing the config (repeatable). These are tried first; the nest's configured
endpoints remain as fallback."

This resolves P0 question 9 and the P3 secrets decision without needing
`${...}` expansion to exist. The committed `nuthatch.toml` carries only
credential-free public endpoints; any keyed endpoint is supplied at runtime
through `--rpc` in `NUTHATCH_EXTRA_ARGS`, which already lives outside the
repository. No sanitized-template materialization step is required.

## Capabilities the plan does not know about

These are additive findings from `nest.txt`. None is required by M4, and none
should be adopted without its own evidence — but two of them bear directly on
stages the plan has already specified.

### `nuthatch nest diff` (RFC-0020)

Classifies an update between two nests as **compatible** (additive only, safe
to hot-swap) or **breaking** (consumer-observable, needs a new endpoint). Each
argument is a nest directory or a `schema.json`.

M4.8 currently detects drift only through recorded check fixtures. A structural
diff is a cheaper and more direct gate, and it names the exact property M5 and
M7 care about. Worth evaluating as an addition to the CI workflow — not a
replacement for the fixtures, which catch value drift rather than shape drift.

### `nuthatch nest upgrade` (RFC-0020)

"Hot-upgrade a running nest to a compatible new version with zero downtime:
serve the old version, index the new one concurrently, then atomically flip the
endpoint once it catches up. A breaking update is refused. The served address
never changes."

P8 currently specifies stopping `nuthatch.service` for "the shortest documented
activation window". If this path works as described, the activation window is
zero and a breaking change is refused rather than served. That is a materially
safer deployment than stop-sync-start, and it changes the rollback story too.

**Do not adopt it on the strength of this help text.** It must be proven on a
disposable nest first, and the interaction with a systemd unit that owns the
process is unexamined.

### `nuthatch nest load` and `nest publish` (RFC-0012, RFC-0019)

`load` verifies a bundle — manifest format, every file hash, and that the
decode registry regenerated from the inputs matches the manifest — then
installs it as a runnable nest. This is a stronger P7/P8 staging validation
than "run the same check command against the staged nest", because it verifies
identity rather than behaviour.

`init --from <git URL|dir>` initialises from a published nest with ABIs
vendored and nothing re-resolved, which is a reproducibility path the plan
does not currently use.

## Still unverified — blocking the rest of task 3

1. Is HTTP `/sql` GET-only, and what are its real parameter names?
2. Active timeout, row, byte, and concurrency guards.
3. Exact implicit column names and types, including `_seq`, decimal siblings,
   and overflow flags.
4. **Whether authored views read hot and sealed rows together.** The single
   most important open question: the entire "one fresh fact only Nuthatch can
   provide" premise depends on it.
5. The source of the `/nest` registry hash and its equality rule with the
   bundle manifest hash.
6. How `semantic.toml` descriptions surface in `/schema`.

These need a running disposable nest, which needs an RPC endpoint and an
indexed contract. That is the remainder of task 2.
