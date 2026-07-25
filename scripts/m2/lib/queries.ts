export interface QueryTemplate {
  readonly queryId: string;
  readonly query: string;
}

const META = `
  _meta {
    block { number timestamp hash }
    hasIndexingErrors
    deployment
  }`;

export const metaQuery: QueryTemplate = {
  queryId: "m2-meta-v1",
  query: `query M2Meta {${META}\n}`,
};

export const tierAMarkerQuery: QueryTemplate = {
  queryId: "m2-tier-a-marker-v2",
  query: `query M2TierAMarker {${META}
  dexAmmProtocols(first: 1) {
    id name schemaVersion methodologyVersion network
  }
}`,
};

export const tierBMarkerQuery: QueryTemplate = {
  queryId: "m2-tier-b-marker-v3",
  query: `query M2TierBMarker {${META}
  factories(first: 1) { id }
}`,
};

export const tokenQuery: QueryTemplate = {
  queryId: "m2-tokens-v2",
  query: `query M2Tokens($ids: [Bytes!]!) {${META}
  tokens(where: { id_in: $ids }) { id symbol name decimals }
}`,
};

export const tokenIntrospectionQuery: QueryTemplate = {
  queryId: "m2-token-introspection-v1",
  query: `query M2TokenIntrospection {${META}
  __type(name: "Token") { fields { name type { kind name ofType { kind name } } } }
}`,
};

export const tierBLineageQuery: QueryTemplate = {
  queryId: "m2-tier-b-lineage-v1",
  query: `query M2TierBLineage {${META}
  factoryType: __type(name: "Factory") { fields { name } }
  poolType: __type(name: "Pool") { fields { name } }
  dayType: __type(name: "PoolDayData") { fields { name } }
}`,
};

export const tierASnapshotIntrospectionQuery: QueryTemplate = {
  queryId: "m2-tier-a-snapshot-introspection-v1",
  query: `query M2TierASnapshotIntrospection {${META}
  __type(name: "LiquidityPoolDailySnapshot") { fields { name } }
}`,
};

export const tierBPoolsQuery: QueryTemplate = {
  queryId: "m2-tier-b-pools-v2",
  query: `query M2TierBPools($token0: Bytes!, $token1: Bytes!) {${META}
  pools(
    first: 100
    where: { token0: $token0, token1: $token1 }
    orderBy: totalValueLockedUSD
    orderDirection: desc
  ) {
    id feeTier totalValueLockedUSD
    token0 { id symbol decimals }
    token1 { id symbol decimals }
  }
}`,
};

export const tierAPoolsQuery: QueryTemplate = {
  queryId: "m2-tier-a-pools-v2",
  query: `query M2TierAPools($tokens: [Bytes!]!) {${META}
  liquidityPools(
    first: 100
    where: { inputTokens_contains: $tokens }
    orderBy: totalValueLockedUSD
    orderDirection: desc
  ) {
    id name totalValueLockedUSD
    inputTokens { id symbol decimals }
  }
}`,
};

export const tierBSnapshotsQuery: QueryTemplate = {
  queryId: "m2-tier-b-snapshots-v2",
  query: `query M2TierBSnapshots($pool: Bytes!) {${META}
  poolDayDatas(
    first: 7
    orderBy: date
    orderDirection: desc
    where: { pool: $pool }
  ) { date volumeUSD feesUSD tvlUSD }
}`,
};

export const tierASnapshotsQuery: QueryTemplate = {
  queryId: "m2-tier-a-snapshots-v2",
  query: `query M2TierASnapshots($pool: String!) {${META}
  liquidityPoolDailySnapshots(
    first: 7
    orderBy: timestamp
    orderDirection: desc
    where: { pool: $pool }
  ) {
    timestamp dailyVolumeUSD dailyTotalFeesUSD totalValueLockedUSD
  }
}`,
};

export const tierBMetricsQuery: QueryTemplate = {
  queryId: "m2-tier-b-metrics-v1",
  query: `query M2TierBMetrics($pool: ID!) {${META}
  pool(id: $pool) {
    id feeTier totalValueLockedUSD
    token0 { id symbol decimals }
    token1 { id symbol decimals }
  }
  poolDayDatas(
    first: 7
    orderBy: date
    orderDirection: desc
    where: { pool: $pool }
  ) { date volumeUSD feesUSD tvlUSD }
}`,
};

export const tierAMetricsQuery: QueryTemplate = {
  queryId: "m2-tier-a-metrics-v1",
  query: `query M2TierAMetrics($pool: ID!) {${META}
  liquidityPool(id: $pool) {
    id name totalValueLockedUSD
    inputTokens { id symbol decimals }
  }
  liquidityPoolDailySnapshots(
    first: 7
    orderBy: timestamp
    orderDirection: desc
    where: { pool: $pool }
  ) {
    timestamp dailyVolumeUSD dailyTotalFeesUSD totalValueLockedUSD
  }
}`,
};

export const TOKEN_IDS = [
  "0x4200000000000000000000000000000000000006",
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca",
] as const;
