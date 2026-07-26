import type { ResultFreshness, ResultProvenance, SwapEvent } from "../schemas/index.js";

import type { LargeSwapQueryContext } from "./large-swaps-query.js";

export type LargeSwapSourceFailureStatus = "error" | "stale" | "timeout" | "unsupported";
type ObservedResultFreshness = Extract<ResultFreshness, { status: "fresh" | "stale" }>;

export interface LargeSwapSourceSuccess {
  readonly status: "ok";
  readonly events: readonly SwapEvent[];
  readonly indexedHead: number;
  readonly freshness: ObservedResultFreshness & { readonly status: "fresh" };
  readonly provenance: ResultProvenance;
  readonly warnings: readonly string[];
}

export interface LargeSwapSourceFailure {
  readonly status: LargeSwapSourceFailureStatus;
  readonly events: null;
  readonly indexedHead: null;
  readonly freshness: Extract<ResultFreshness, { status: "unavailable" }>;
  readonly provenance: ResultProvenance;
  readonly warnings: readonly string[];
}

export type LargeSwapSourceResult = LargeSwapSourceSuccess | LargeSwapSourceFailure;

export interface LargeSwapSourceGateway {
  readonly provenance: ResultProvenance;
  fetchCandidates(context: LargeSwapQueryContext): Promise<LargeSwapSourceResult>;
}
