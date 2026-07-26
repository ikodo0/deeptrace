# Wallet Research source scope

Wallet Research is Base-only and source-bounded. It does not claim complete
wallet history, balances, ownership, P&L, or protocol coverage.

## Graph coverage

The selected Graph capability is the Messari Aave v3 Base standardized
deployment:

- source ID: `messari-aave-v3-base-wallet`
- gateway subgraph ID: `D7mapexM5ZsQckLJai2FawTKXJ7CqYGKM8PErnS3cJi9`
- asserted deployment: `Qmb5j4tE5deSXCrubQeqeghfrGhyfQBiq9DuZNMfHBjbfL`
- schema/methodology: `3.1.0` / `1.1.0`
- supported entities: `accounts`, `positions`, `positionSnapshots`

A read-only probe on 2026-07-26 verified `accounts`, `positions`, account
filtering, asset/market legs, position side, raw balance, opening block/time,
and latest `PositionSnapshot.balanceUSD`. The public test address
`0x5cb3787a9c9c7547451ca3e6d8702453de35fe01` returned an open WETH collateral
position. The adapter rechecks `_meta.deployment`, account identity, response
shape, and freshness on every call.

Only supported open positions with `balance_gt: "0"` are returned. USD values
are copied from the latest Graph position snapshot. DeepTrace does not derive a
price or revalue a position.

## Nuthatch coverage

The dedicated `wallet_swap_activity` view exposes sender/recipient-aware Swap
events from the one allowlisted Uniswap v3 WETH/USDC pool:

`0x6c561b446416e1a00e8e93e221854d6ea4171372`

The adapter filters only a validated lowercase public address, applies a
24-hour or 7-day window anchored to the frozen indexed snapshot, and uses
deterministic block/log/hash cursor pagination. Window aggregates are calculated
from the same complete bounded snapshot rather than from one activity page. A
window above the 5,000-row safety ceiling fails the Nuthatch section explicitly
instead of returning incomplete aggregates. Returned assets and observable
flows describe only those indexed swap events.

The local environment did not provide `NUTHATCH_BASE_URL` during WR
implementation. Unit and contract tests therefore verify the adapter boundary,
but a deployed-view receipt and transaction-receipt parity packet remain a
release gate. Until that gate passes, live responses preserve Graph positions
as `partial` and report Nuthatch coverage as unavailable.

## Section matrix

| Section | Graph | Nuthatch | Meaning |
| :--- | :--- | :--- | :--- |
| `positions` | Aave v3 positions | — | Supported open lending positions |
| `activity` | — | Indexed pool swaps | Sender/recipient-involved events |
| `counterparties` | — | Indexed pool swaps | Event peer only |
| `observable_flows` | — | Indexed pool swaps | Classified swap input/output |
| `observed_assets` | Position legs | Swap legs | Observed, not complete balances |
| `protocol_usage` | Position count | Activity count | Supported-source usage only |

A `complete` response requires at least one returned Graph position and one
returned Nuthatch activity. Operational success with no load-bearing fact is
reported as `partial` with an explicit warning.
