import { describe, expect, it } from "vitest";
import {
  areAcousticCodesEquivalent,
  normalizeAcousticCode,
  validateAcousticSignature,
} from "../src/audio/signatureMath";
import type { AcousticCode } from "../src/audio/types";

describe("normalizeAcousticCode", () => {
  it.each([
    [
      [5, 2, 4],
      [2, 4, 5],
    ],
    [
      [4, 8, 10],
      [2, 4, 5],
    ],
    [
      [6, 12, 15],
      [2, 4, 5],
    ],
    [
      [2, 4, 6],
      [1, 2, 3],
    ],
    [
      [4, 4, 8],
      [1, 1, 2],
    ],
  ] satisfies readonly (readonly [AcousticCode, AcousticCode])[])(
    "normalizes %j to %j",
    (input, expected) => {
      expect(normalizeAcousticCode(input)).toEqual(expected);
    },
  );

  it.each([
    { code: [0, 2, 3] },
    { code: [-1, 2, 3] },
    { code: [1, 2.5, 3] },
  ] satisfies readonly { readonly code: AcousticCode }[])(
    "rejects invalid code $code",
    ({ code }) => {
      expect(() => normalizeAcousticCode(code)).toThrow(RangeError);
    },
  );

  it("is independent of input order", () => {
    expect(normalizeAcousticCode([5, 2, 4])).toEqual(
      normalizeAcousticCode([4, 5, 2]),
    );
  });
});

describe("validateAcousticSignature", () => {
  it("preserves order and accepts zero as a disabled component", () => {
    expect(validateAcousticSignature([4, 0, 2])).toEqual([4, 0, 2]);
    expect(validateAcousticSignature([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it.each([
    { code: [-1, 2, 4] },
    { code: [1.5, 2, 4] },
    { code: [1, Number.NaN, 4] },
  ] satisfies readonly { readonly code: AcousticCode }[])(
    "rejects an invalid playable signature $code",
    ({ code }) => {
      expect(() => validateAcousticSignature(code)).toThrow(RangeError);
    },
  );
});

describe("areAcousticCodesEquivalent", () => {
  it.each([
    [
      [2, 4, 5],
      [5, 2, 4],
    ],
    [
      [2, 4, 5],
      [4, 8, 10],
    ],
    [
      [2, 4, 5],
      [6, 12, 15],
    ],
  ] satisfies readonly (readonly [AcousticCode, AcousticCode])[])(
    "treats %j and %j as equivalent",
    (left, right) => {
      expect(areAcousticCodesEquivalent(left, right)).toBe(true);
    },
  );

  it.each([
    [
      [2, 4, 5],
      [2, 4, 6],
    ],
    [
      [2, 4, 5],
      [2, 3, 5],
    ],
  ] satisfies readonly (readonly [AcousticCode, AcousticCode])[])(
    "distinguishes %j and %j",
    (left, right) => {
      expect(areAcousticCodesEquivalent(left, right)).toBe(false);
    },
  );
});
