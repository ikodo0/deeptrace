import { describe, expect, it } from "vitest";

import { DecimalParseError, canonicalizeDecimal, parseDecimal, sumDecimals } from "./decimal.js";

describe("parseDecimal", () => {
  it("parses a canonical integer", () => {
    expect(parseDecimal("42")).toEqual({
      canonical: "42",
      integerPart: "42",
      fractionalPart: "",
      scale: 0,
    });
  });

  it("parses zero", () => {
    expect(parseDecimal("0")).toEqual({
      canonical: "0",
      integerPart: "0",
      fractionalPart: "",
      scale: 0,
    });
  });

  it("parses a value with fractional digits", () => {
    expect(parseDecimal("1.5")).toEqual({
      canonical: "1.5",
      integerPart: "1",
      fractionalPart: "5",
      scale: 1,
    });
  });

  it("strips leading zeros from the integer part", () => {
    expect(parseDecimal("007").canonical).toBe("7");
    expect(parseDecimal("000.5").canonical).toBe("0.5");
  });

  it("strips trailing zeros from the fractional part", () => {
    expect(parseDecimal("1.500").canonical).toBe("1.5");
    expect(parseDecimal("1.000").canonical).toBe("1");
    expect(parseDecimal("0.000").canonical).toBe("0");
  });

  it("trims surrounding whitespace", () => {
    expect(parseDecimal("  1.5  ").canonical).toBe("1.5");
  });

  it("preserves fractional scale beyond IEEE-754 precision", () => {
    const value = "1837918.971826772337839586279587621";
    expect(parseDecimal(value).scale).toBe(27);
    expect(parseDecimal(value).canonical).toBe(value);
  });

  it.each([
    ["", "empty"],
    ["  ", "empty"],
    ["-1", "sign"],
    ["+1", "sign"],
    ["1e5", "exponent"],
    ["1E5", "exponent"],
    ["NaN", "nan"],
    ["Infinity", "infinity"],
    ["1.2.3", "multiple dots"],
    [".5", "leading dot"],
    ["1.", "trailing dot"],
    ["abc", "non-numeric"],
    ["0x1", "hex"],
  ])("rejects malformed input %s (%s)", (input) => {
    expect(() => parseDecimal(input)).toThrow(DecimalParseError);
  });
});

describe("canonicalizeDecimal", () => {
  it("canonicalizes leading and trailing zeros", () => {
    expect(canonicalizeDecimal("007.500")).toBe("7.5");
    expect(canonicalizeDecimal("000000")).toBe("0");
    expect(canonicalizeDecimal("0.000000")).toBe("0");
  });
});

describe("sumDecimals", () => {
  it("returns 0 for an empty list", () => {
    expect(sumDecimals([])).toBe("0");
  });

  it("sums two integers", () => {
    expect(sumDecimals(["1", "2"])).toBe("3");
  });

  it("sums values at the same scale", () => {
    expect(sumDecimals(["1.5", "2.5"])).toBe("4");
  });

  it("sums values at differing scales without float loss", () => {
    expect(sumDecimals(["0.1", "0.2"])).toBe("0.3");
  });

  it("sums values beyond IEEE-754 precision", () => {
    const a = "1837918.971826772337839586279587621";
    const b = "51474578.61622885677419282699983982";
    expect(sumDecimals([a, b])).toBe("53312497.588055629112032413279427441");
  });

  it("handles mixed integer and fractional inputs", () => {
    expect(sumDecimals(["100", "0.001", "0.999"])).toBe("101");
  });

  it("canonicalizes inputs before summing", () => {
    expect(sumDecimals(["007.500", "000.500"])).toBe("8");
  });

  it("produces a canonical result with no trailing zeros", () => {
    expect(sumDecimals(["1.1", "1.9", "1.0"])).toBe("4");
  });

  it("rejects malformed input in any position", () => {
    expect(() => sumDecimals(["1", "NaN", "2"])).toThrow(DecimalParseError);
  });
});
