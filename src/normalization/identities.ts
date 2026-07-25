import { normalizeAddress } from "./address.js";
import { NormalizationError } from "./error.js";

/**
 * Chain-aware token identity. Address casing does not affect the key.
 */
export function tokenIdentity(chainId: number, address: string): string {
  return `${chainId}:${normalizeAddress(address)}`;
}

/**
 * Chain-aware pool identity. Address casing does not affect the key.
 */
export function poolIdentity(chainId: number, poolAddress: string): string {
  return `${chainId}:${normalizeAddress(poolAddress)}`;
}

/**
 * Chain-aware pair identity. Token order and address casing do not affect the key.
 */
export function pairIdentity(chainId: number, addressA: string, addressB: string): string {
  const left = normalizeAddress(addressA);
  const right = normalizeAddress(addressB);

  if (left === right) {
    throw new NormalizationError("Pair identity requires two distinct token addresses");
  }

  const [first, second] = left < right ? [left, right] : [right, left];
  return `${chainId}:${first}:${second}`;
}
