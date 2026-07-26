import { NormalizationError } from "./error.js";

const ETHEREUM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/**
 * Validates a 20-byte hex address and returns its canonical lowercase form.
 */
export function normalizeAddress(address: string): string {
  if (!ETHEREUM_ADDRESS_PATTERN.test(address)) {
    throw new NormalizationError(`Invalid Ethereum address: ${address}`);
  }

  return address.toLowerCase();
}
