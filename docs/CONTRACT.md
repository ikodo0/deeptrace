# DeepTrace Source Adapter Contract

This contract is the boundary between live source adapters and the rest of
DeepTrace. Graph and Nuthatch adapters return the same `SourceResult<T>` shape
defined in `src/schemas/source-adapter.ts`.

## Result shape

Every result identifies its registry source, source type, protocol, Base chain,
status, freshness, provenance, warnings, and measured latency. The `source_id`
must match a Source Registry record.

The supported statuses are:

- `ok`: the source returned usable data.
- `timeout`: the source exceeded its bounded deadline.
- `error`: the source failed for another operational reason.
- `unsupported`: the source schema, deployment, or requested capability does
  not match its registered contract.
- `stale`: the source is reachable but not sufficiently current or ready.

An `ok` result always has non-null `data` and `freshness`. Every non-`ok`
result has `data: null`. A failed result may retain non-null freshness when the
adapter has reliable last-known indexing metadata, such as a stale Nuthatch
view; otherwise freshness is null.

Adapters must catch operational and source-shape failures at their boundary and
return a non-`ok` result. No source exception crosses into normalization,
metrics, MCP, or reasoning code.

## Numeric and identity rules

All financial values are base-10 decimal strings or null. They must never pass
through a JavaScript `number`, because doing so can silently lose precision.
Counts, block numbers, token decimals, fee-tier basis points, log indexes,
timestamps, and latency remain numbers.

Pool and token addresses are lowercase. Unix timestamps are integer seconds.
Graph block hashes are omitted when the source does not expose one. Nuthatch
results always include the indexed block hash and the last swap block,
transaction hash, and log index.

Null financial values mean the source did not provide a supported value. They
must not be replaced with estimates.

## USD pricing

DeepTrace may read only The Graph and Nuthatch. There is no external price API,
so **USD values are whatever the subgraph reports, consumed as-is**. Downstream
code must not re-price, cross-check against another venue, or derive a USD value
that the source did not supply.

The price timestamp is the reporting snapshot's day or block, and the price
provenance is the subgraph deployment recorded in `provenance`.

Nuthatch carries no USD at all — it indexes raw `Swap` events with raw `int256`
amounts. Any Nuthatch-derived value is unpriced by construction.

## Freshness and provenance

Freshness describes the source state observed by the query:

- `indexed_block` and `indexed_block_timestamp` identify the indexed head.
- `indexed_block_hash` is included when available.
- `queried_at` records when DeepTrace made the query.
- `has_indexing_errors` is included when the backend exposes that state.

Provenance is required for both successful and failed results. It identifies
the deployment or Nuthatch registry/view, available schema and methodology
versions, and the query template that ran. Versions are null when the source
does not publish them.

Warnings contain safe, user-presentable diagnostics. They must never contain
API keys, credential-bearing URLs, authorization headers, or admin tokens.

## Registry relationship

Registry records use the shape in `src/registry/types.ts`. MVP-0 records are
Base DEX sources with `chain_id: 8453`. A record declares its source type,
protocol, deployment or view identity, supported entities, versions, and
whether it is active. Locators are source-specific: Graph records carry the
stable gateway subgraph ID while Nuthatch records identify the configured view.
The registry, rather than adapter code, selects and locates configured sources.
This locator union is a later source-contract clarification: the subgraph ID
routes a request, while `deployment_or_view_id` remains the independently
asserted provenance identity. Source-contract revision labels are not product
milestone IDs from `docs/EXECUTION_PLAN.md`.

## Fixtures and change control

`tests/fixtures/sources/index.ts` exports five typed results:

- three healthy Graph pool results;
- a timeout variant of the third Graph result;
- one healthy Nuthatch freshness result.

It also exports a four-source complete scenario and a four-source partial
scenario. These are deliberately shape-only placeholders. A later
source-evidence packet replaces their source values with captured live evidence
without changing the contract.

Every fixture uses TypeScript's `satisfies` operator, so incompatible fields
fail strict fixture typechecking. Run:

```sh
tsc -p tsconfig.fixtures.json
```

This contract is frozen for the two workstreams. Any change to its fields,
status semantics, nullability, units, or provenance rules requires agreement
from both people before implementation.
