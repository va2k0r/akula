import type { AcousticCode } from "./types";

const TAU = Math.PI * 2;

export const PULSE_PHASE_RADIANS = 0;

/** Turns a bipolar LFO into a smooth, positive pulse with a controllable crest. */
export function carrierToPulse(carrier: number, shapePower: number): number {
  assertUnitCarrier(carrier);
  assertPositiveFinite(shapePower, "Pulse shape power");
  return ((carrier + 1) / 2) ** shapePower;
}

/** Aligns every component crest on the shared downbeat. */
export function samplePulseEnvelope(
  repetitions: number,
  cycleDuration: number,
  elapsedSeconds: number,
  shapePower: number,
): number {
  assertPositiveInteger(repetitions, "Repetition count");
  assertPositiveFinite(cycleDuration, "Cycle duration");
  assertNonNegativeFinite(elapsedSeconds, "Elapsed time");

  const phase =
    (TAU * repetitions * elapsedSeconds) / cycleDuration + PULSE_PHASE_RADIANS;
  return carrierToPulse(Math.cos(phase), shapePower);
}

/**
 * A short mechanical impact with a fast attack, a finite decay and true
 * silence before the next repetition.
 */
export function sampleImpactEnvelope(
  repetitions: number,
  cycleDuration: number,
  elapsedSeconds: number,
  attackFraction: number,
  decayFraction: number,
  decayPower: number,
): number {
  assertPositiveInteger(repetitions, "Repetition count");
  assertPositiveFinite(cycleDuration, "Cycle duration");
  assertNonNegativeFinite(elapsedSeconds, "Elapsed time");
  assertPositiveFinite(attackFraction, "Impact attack fraction");
  assertPositiveFinite(decayFraction, "Impact decay fraction");
  assertPositiveFinite(decayPower, "Impact decay power");
  if (attackFraction + decayFraction >= 1) {
    throw new RangeError("Impact attack and decay must fit inside one pulse.");
  }

  const interval = cycleDuration / repetitions;
  const phase = (elapsedSeconds % interval) / interval;
  if (phase < attackFraction) {
    const progress = phase / attackFraction;
    return progress * progress * (3 - 2 * progress);
  }
  if (phase < attackFraction + decayFraction) {
    const progress = (phase - attackFraction) / decayFraction;
    return (1 - progress) ** decayPower;
  }
  return 0;
}

/** Samples one independent propeller component; zero disables it. */
export function sampleIndependentEnvelope(
  repetitions: number,
  cycleDuration: number,
  elapsedSeconds: number,
  pulseHalfWidth: number,
  pulseShapePower: number,
): number {
  assertNonNegativeInteger(repetitions, "Repetition count");
  assertPositiveFinite(cycleDuration, "Cycle duration");
  assertNonNegativeFinite(elapsedSeconds, "Elapsed time");
  assertPositiveFinite(pulseHalfWidth, "Pulse half-width");
  assertPositiveFinite(pulseShapePower, "Pulse shape power");
  if (pulseHalfWidth >= 0.5) {
    throw new RangeError(
      "Pulse half-width must be less than half an interval.",
    );
  }
  if (repetitions === 0) {
    return 0;
  }

  const phase = (elapsedSeconds % cycleDuration) / cycleDuration;
  const interval = 1 / repetitions;
  const nearestEvent = Math.round(phase / interval) * interval;
  const wrappedEvent = nearestEvent >= 1 ? 0 : nearestEvent;
  const directDistance = Math.abs(phase - wrappedEvent);
  const circularDistance = Math.min(directDistance, 1 - directDistance);
  const halfWidthInCycle = pulseHalfWidth / repetitions;
  if (circularDistance > halfWidthInCycle) {
    return 0;
  }

  const position = circularDistance / halfWidthInCycle;
  return Math.cos((position * Math.PI) / 2) ** pulseShapePower;
}

/**
 * Samples one of the three phase-locked mechanical voices.
 *
 * The first two voices add when their events coincide. The fastest voice fills
 * the remaining subdivisions instead of masking those shared accents. Thus a
 * 1-2-4 signature reads as (A+B), C, B, C, (A+B), ...
 */
export function sampleInterlockedEnvelope(
  code: AcousticCode,
  componentIndex: 0 | 1 | 2,
  cycleDuration: number,
  elapsedSeconds: number,
  pulseHalfWidth: number,
  pulseShapePower: number,
): number {
  for (const repetitions of code) {
    assertPositiveInteger(repetitions, "Repetition count");
  }
  assertPositiveFinite(cycleDuration, "Cycle duration");
  assertNonNegativeFinite(elapsedSeconds, "Elapsed time");
  assertPositiveFinite(pulseHalfWidth, "Pulse half-width");
  assertPositiveFinite(pulseShapePower, "Pulse shape power");
  if (pulseHalfWidth >= 0.5) {
    throw new RangeError(
      "Pulse half-width must be less than half an interval.",
    );
  }

  const repetitions = code[componentIndex];
  const phase = (elapsedSeconds % cycleDuration) / cycleDuration;
  const halfWidthInCycle = pulseHalfWidth / repetitions;
  let envelope = 0;

  for (let eventIndex = 0; eventIndex < repetitions; eventIndex += 1) {
    const onset = eventIndex / repetitions;
    if (
      componentIndex === 2 &&
      (coincidesWithGrid(onset, code[0]) || coincidesWithGrid(onset, code[1]))
    ) {
      continue;
    }

    const directDistance = Math.abs(phase - onset);
    const circularDistance = Math.min(directDistance, 1 - directDistance);
    if (circularDistance > halfWidthInCycle) {
      continue;
    }

    const position = circularDistance / halfWidthInCycle;
    const pulse = Math.cos((position * Math.PI) / 2) ** pulseShapePower;
    envelope = Math.max(envelope, pulse);
  }

  return envelope;
}

function coincidesWithGrid(onset: number, repetitions: number): boolean {
  const gridPosition = onset * repetitions;
  return Math.abs(gridPosition - Math.round(gridPosition)) < 1e-9;
}

/** Matches the AudioParam base-plus-depth gain used by the engine. */
export function scalePulseEnvelope(
  pulseEnvelope: number,
  floorScale: number,
  peakScale: number,
): number {
  if (
    !Number.isFinite(pulseEnvelope) ||
    pulseEnvelope < 0 ||
    pulseEnvelope > 1
  ) {
    throw new RangeError("Pulse envelope must be between 0 and 1.");
  }
  if (
    !Number.isFinite(floorScale) ||
    !Number.isFinite(peakScale) ||
    floorScale < 0 ||
    peakScale <= floorScale
  ) {
    throw new RangeError("Pulse scale must have an increasing positive range.");
  }

  return floorScale + pulseEnvelope * (peakScale - floorScale);
}

function assertUnitCarrier(carrier: number): void {
  if (!Number.isFinite(carrier) || carrier < -1 || carrier > 1) {
    throw new RangeError("Carrier must be between -1 and 1.");
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer.`);
  }
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number.`);
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number.`);
  }
}
