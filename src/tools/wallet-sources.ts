import type {
  DeFiPosition,
  ResultFreshness,
  ResultProvenance,
  WalletActivity,
} from "../schemas/index.js";
import type { ResearchWalletRequest } from "../schemas/wallet-research-request.js";

import type { WalletResearchQueryContext } from "./wallet-query.js";

export type WalletSourceFailureStatus = "error" | "stale" | "timeout" | "unsupported";

interface WalletSourceQuality {
  readonly freshness: ResultFreshness;
  readonly provenance: ResultProvenance;
  readonly warnings: readonly string[];
}

export interface WalletGraphSuccess extends WalletSourceQuality {
  readonly status: "ok";
  readonly positions: readonly DeFiPosition[];
}

export interface WalletGraphFailure extends WalletSourceQuality {
  readonly status: WalletSourceFailureStatus;
  readonly positions: null;
}

export type WalletGraphResult = WalletGraphSuccess | WalletGraphFailure;

export interface WalletActivitySuccess extends WalletSourceQuality {
  readonly status: "ok";
  readonly activities: readonly WalletActivity[];
  readonly indexedHead: number;
}

export interface WalletActivityFailure extends WalletSourceQuality {
  readonly status: WalletSourceFailureStatus;
  readonly activities: null;
  readonly indexedHead: null;
}

export type WalletActivityResult = WalletActivitySuccess | WalletActivityFailure;

export interface WalletResearchSourceGateway {
  readonly graphProvenance: ResultProvenance;
  readonly nuthatchProvenance: ResultProvenance;
  fetchPositions(request: ResearchWalletRequest): Promise<WalletGraphResult>;
  fetchActivity(context: WalletResearchQueryContext): Promise<WalletActivityResult>;
}
