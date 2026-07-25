import type { CanonicalPair, CanonicalToken } from "../schemas/compare-pools.js";
import { BASE_CHAIN_ID } from "../schemas/source-adapter.js";

import { normalizeAddress } from "./address.js";
import { NormalizationError } from "./error.js";

export interface SourceTokenInput {
  address: string;
  symbol: string;
  decimals: number;
}

/**
 * Builds a canonical token on the MVP-0 Base chain with a lowercase address.
 */
export function normalizeCanonicalToken(chainId: number, token: SourceTokenInput): CanonicalToken {
  if (chainId !== BASE_CHAIN_ID) {
    throw new NormalizationError(`Unsupported chain_id for canonical token: ${chainId}`);
  }
  if (!Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 255) {
    throw new NormalizationError(`Invalid canonical token decimals: ${String(token.decimals)}`);
  }

  return {
    chain_id: BASE_CHAIN_ID,
    address: normalizeAddress(token.address),
    symbol: token.symbol,
    decimals: token.decimals,
  };
}

/**
 * Orders a token pair by ascending address, independent of source token order.
 */
export function normalizeCanonicalPair(
  chainId: number,
  tokenA: SourceTokenInput,
  tokenB: SourceTokenInput,
): CanonicalPair {
  const left = normalizeCanonicalToken(chainId, tokenA);
  const right = normalizeCanonicalToken(chainId, tokenB);

  if (left.address === right.address) {
    throw new NormalizationError("Pair tokens must differ");
  }

  return left.address < right.address ? [left, right] : [right, left];
}
