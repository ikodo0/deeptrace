/**
 * Exact decimal-string arithmetic for Graph-reported USD values.
 *
 * Financial values arrive as base-10 decimal strings (e.g.
 * "1837918.971826772337839586279587621"). They must never pass through
 * JavaScript `number` — IEEE-754 cannot represent them. This module
 * validates, canonicalizes, and sums them using `BigInt` only.
 *
 * Rules (binding, from docs/M3_PLAN.md § Agent 3A):
 * - accept only canonical non-negative base-10 decimal strings;
 * - reject `NaN`, infinities, signs, exponent notation, and malformed input;
 * - canonicalize leading/trailing zeros so byte-equality is meaningful;
 * - add at a shared fractional scale using `BigInt`, never `number`.
 */

export class DecimalParseError extends Error {
  constructor(
    readonly input: string,
    message: string,
  ) {
    super(message);
    this.name = "DecimalParseError";
  }
}

const DECIMAL_PATTERN = /^[0-9]+(\.[0-9]+)?$/;

export interface DecimalValue {
  /** Canonical string form — no leading zeros (except "0"), no trailing zeros after the dot. */
  readonly canonical: string;
  /** Integer digits before the decimal point, canonical (no leading zeros). */
  readonly integerPart: string;
  /** Fractional digits after the decimal point, may be empty string (meaning scale 0). */
  readonly fractionalPart: string;
  /** Number of fractional digits. */
  readonly scale: number;
}

/**
 * Parse and validate a non-negative base-10 decimal string.
 * Throws `DecimalParseError` on any malformed input.
 */
export function parseDecimal(input: string): DecimalValue {
  if (typeof input !== "string") {
    throw new DecimalParseError(String(input), "Decimal must be a string");
  }
  const trimmed = input.trim();
  if (trimmed === "") {
    throw new DecimalParseError(input, "Decimal must not be empty");
  }
  if (!DECIMAL_PATTERN.test(trimmed)) {
    throw new DecimalParseError(
      input,
      "Decimal must be a non-negative base-10 string without sign or exponent",
    );
  }

  const [integerRaw, fractionalRaw = ""] = trimmed.split(".");
  const integerPart = (integerRaw ?? "").replace(/^0+(?=\d)/, "") || "0";
  const fractionalPart = fractionalRaw.replace(/0+$/, "");

  const canonical =
    fractionalPart === ""
      ? integerPart
      : integerPart === "0" && fractionalPart === ""
        ? "0"
        : `${integerPart}.${fractionalPart}`;

  return {
    canonical,
    integerPart,
    fractionalPart,
    scale: fractionalPart.length,
  };
}

/**
 * Canonicalize a decimal string in place (parse + return canonical form).
 * Throws on malformed input.
 */
export function canonicalizeDecimal(input: string): string {
  return parseDecimal(input).canonical;
}

/**
 * Sum a list of non-negative decimal strings exactly, using `BigInt`.
 * The result carries the maximum fractional scale of any input.
 * Throws `DecimalParseError` if any input is malformed.
 */
export function sumDecimals(inputs: readonly string[]): string {
  if (inputs.length === 0) {
    return "0";
  }

  const parsed = inputs.map(parseDecimal);
  const maxScale = parsed.reduce((max, value) => Math.max(max, value.scale), 0);

  const asScaledBigInt = parsed.map((value) => {
    const padded = value.fractionalPart.padEnd(maxScale, "0");
    return BigInt(value.integerPart + padded);
  });

  const total = asScaledBigInt.reduce((sum, value) => sum + value, 0n);
  const totalStr = total.toString();

  if (maxScale === 0) {
    return totalStr;
  }

  const padded = totalStr.padStart(maxScale + 1, "0");
  const integerPart = padded.slice(0, padded.length - maxScale);
  let fractionalPart = padded.slice(padded.length - maxScale);

  fractionalPart = fractionalPart.replace(/0+$/, "");

  return fractionalPart === "" ? integerPart : `${integerPart}.${fractionalPart}`;
}
