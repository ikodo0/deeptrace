import { ConfigurationError } from "../errors/application-error.js";
import { MAX_BOUNDED_POSITIVE_INTEGER } from "./defaults.js";

/**
 * Returns true when `value` is a finite integer in [1, maximum].
 * Rejects fractional, NaN, and infinite inputs without inspecting string forms.
 */
export function isBoundedPositiveInteger(
  value: number,
  maximum = MAX_BOUNDED_POSITIVE_INTEGER,
): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 1 && value <= maximum;
}

/**
 * Asserts a numeric option is a bounded positive integer.
 * Throws ConfigurationError naming `variableName` without embedding the raw value.
 */
export function assertBoundedPositiveInteger(
  value: number,
  variableName: string,
  maximum = MAX_BOUNDED_POSITIVE_INTEGER,
): number {
  if (!isBoundedPositiveInteger(value, maximum)) {
    throw new ConfigurationError([variableName]);
  }
  return value;
}

/**
 * Parses an environment string as a bounded positive integer.
 * Throws ConfigurationError naming `variableName` without embedding the raw value.
 */
export function parseBoundedPositiveInteger(
  raw: string,
  variableName: string,
  maximum = MAX_BOUNDED_POSITIVE_INTEGER,
): number {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new ConfigurationError([variableName]);
  }

  // Reject scientific notation and other non-decimal-integer spellings.
  if (!/^[+-]?\d+$/.test(trimmed)) {
    throw new ConfigurationError([variableName]);
  }

  const value = Number(trimmed);
  return assertBoundedPositiveInteger(value, variableName, maximum);
}
