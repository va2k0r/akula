import type { AcousticCode } from "./types";

/** Validates a playable, ordered signature. Zero disables that component. */
export function validateAcousticSignature(code: AcousticCode): AcousticCode {
  if (!Array.isArray(code) || code.length !== 3) {
    throw new TypeError(
      "An acoustic signature must contain exactly three values.",
    );
  }

  const [first, second, third] = code;
  for (const value of [first, second, third]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(
        "Every acoustic signature value must be a non-negative safe integer.",
      );
    }
  }

  return Object.freeze([first, second, third]);
}

export function normalizeAcousticCode(code: AcousticCode): AcousticCode {
  if (!Array.isArray(code) || code.length !== 3) {
    throw new TypeError("An acoustic code must contain exactly three values.");
  }

  const [first, second, third] = code;
  assertPositiveInteger(first);
  assertPositiveInteger(second);
  assertPositiveInteger(third);

  const divisor = greatestCommonDivisor(
    greatestCommonDivisor(first, second),
    third,
  );
  const normalized: [number, number, number] = [
    first / divisor,
    second / divisor,
    third / divisor,
  ];

  normalized.sort((left, right) => left - right);
  return Object.freeze(normalized);
}

export function areAcousticCodesEquivalent(
  left: AcousticCode,
  right: AcousticCode,
): boolean {
  const normalizedLeft = normalizeAcousticCode(left);
  const normalizedRight = normalizeAcousticCode(right);

  return normalizedLeft.every(
    (value, index) => value === normalizedRight[index],
  );
}

function greatestCommonDivisor(left: number, right: number): number {
  let dividend = left;
  let divisor = right;

  while (divisor !== 0) {
    const remainder = dividend % divisor;
    dividend = divisor;
    divisor = remainder;
  }

  return dividend;
}

function assertPositiveInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(
      "Every acoustic code value must be a positive safe integer.",
    );
  }
}
