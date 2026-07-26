import { normalizeAddress } from "./address.js";
import { NormalizationError } from "./error.js";

const TRANSACTION_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

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

/**
 * Chain-aware on-chain event identity. Transaction-hash casing does not affect the key.
 */
export function swapEventIdentity(
  chainId: number,
  transactionHash: string,
  logIndex: number,
): string {
  if (!Number.isInteger(chainId) || chainId < 1) {
    throw new NormalizationError(`Event identity requires a positive chain ID: ${String(chainId)}`);
  }
  if (!TRANSACTION_HASH_PATTERN.test(transactionHash)) {
    throw new NormalizationError(`Invalid transaction hash: ${transactionHash}`);
  }
  if (!Number.isInteger(logIndex) || logIndex < 0) {
    throw new NormalizationError(
      `Event identity requires a non-negative log index: ${String(logIndex)}`,
    );
  }

  return `${chainId}:${transactionHash.toLowerCase()}:${String(logIndex)}`;
}
