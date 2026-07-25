import { DecimalParseError, parseDecimal } from "../sources/graph/decimal.js";

/**
 * Compare two non-negative decimal strings exactly.
 * Returns negative when left < right, zero when equal, positive when left > right.
 */
export function compareDecimalStrings(left: string, right: string): number {
  const leftValue = parseDecimal(left);
  const rightValue = parseDecimal(right);
  const scale = Math.max(leftValue.scale, rightValue.scale);
  const leftScaled = BigInt(leftValue.integerPart + leftValue.fractionalPart.padEnd(scale, "0"));
  const rightScaled = BigInt(rightValue.integerPart + rightValue.fractionalPart.padEnd(scale, "0"));

  if (leftScaled === rightScaled) {
    return 0;
  }
  return leftScaled < rightScaled ? -1 : 1;
}

/**
 * Descending metric order with nulls last.
 * Malformed decimals raise `DecimalParseError` from the shared parser.
 */
export function compareMetricDescNullsLast(left: string | null, right: string | null): number {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }

  return -compareDecimalStrings(left, right);
}

export { DecimalParseError };
