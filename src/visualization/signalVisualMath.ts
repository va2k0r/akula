import { samplePulseEnvelope } from "../audio/perceptualEncoding";
import { PROPELLER_PRESET } from "../audio/propellerPreset";
import { validateAcousticSignature } from "../audio/signatureMath";
import type { AcousticCode } from "../audio/types";

export interface AcousticVisualSample {
  /** The inseparable sum of all three low-frequency modulation envelopes. */
  readonly combinedEnvelope: number;
  readonly traceStrength: number;
  readonly uncertainty: number;
}

export function sampleAcousticSignatureVisual(
  code: AcousticCode,
  cycleDuration: number,
  elapsedSeconds: number,
  signalQuality: number,
  sampleIndex: number,
): AcousticVisualSample {
  const validatedCode = validateAcousticSignature(code);
  assertPositiveFinite(cycleDuration, "Cycle duration");
  assertNonNegativeFinite(elapsedSeconds, "Elapsed time");
  assertSignalQuality(signalQuality);
  if (!Number.isSafeInteger(sampleIndex) || sampleIndex < 0) {
    throw new RangeError("Sample index must be a non-negative safe integer.");
  }

  const envelopes = validatedCode.map((repetitions) =>
    repetitions === 0
      ? 0
      : samplePulseEnvelope(
          repetitions,
          cycleDuration,
          elapsedSeconds,
          PROPELLER_PRESET.modulation.pulseShapePower,
        ),
  );
  const modulationWeights = [
    PROPELLER_PRESET.modulation.componentA.gainDepth * 2 +
      PROPELLER_PRESET.bed.gain *
        (1 - PROPELLER_PRESET.modulation.componentA.bedFloorScale) +
      PROPELLER_PRESET.hull.flowGain *
        (1 - PROPELLER_PRESET.hull.flowFloorScale),
    PROPELLER_PRESET.modulation.componentB.gainDepth * 2,
    PROPELLER_PRESET.modulation.componentC.gainDepth * 2,
  ] as const;
  let activeWeight = 0;
  let combinedLevel = 0;
  for (const componentIndex of [0, 1, 2] as const) {
    if (validatedCode[componentIndex] === 0) {
      continue;
    }
    const weight = modulationWeights[componentIndex];
    activeWeight += weight;
    combinedLevel += (envelopes[componentIndex] ?? 0) * weight;
  }
  const clearCombinedEnvelope =
    activeWeight === 0 ? 0 : combinedLevel / activeWeight;
  const uncertainty = 1 - signalQuality;
  const combinedEnvelope = clampUnit(clearCombinedEnvelope);
  const traceStrength = clampUnit(
    0.28 +
      signalQuality * 0.72 +
      (smoothNoise(elapsedSeconds * 1.9, 43) - 0.5) * uncertainty * 0.2,
  );

  return Object.freeze({
    combinedEnvelope,
    traceStrength,
    uncertainty,
  });
}

export function assertSignalQuality(signalQuality: number): void {
  if (
    !Number.isFinite(signalQuality) ||
    signalQuality < 0 ||
    signalQuality > 1
  ) {
    throw new RangeError("Signal quality must be between 0 and 1.");
  }
}

function smoothNoise(position: number, salt: number): number {
  const lowerIndex = Math.floor(position);
  const interpolation = position - lowerIndex;
  const smoothInterpolation =
    interpolation * interpolation * (3 - 2 * interpolation);
  const lower = hashedNoise(lowerIndex, salt);
  const upper = hashedNoise(lowerIndex + 1, salt);
  return lower + (upper - lower) * smoothInterpolation;
}

function hashedNoise(index: number, salt: number): number {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43_758.5453;
  return value - Math.floor(value);
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
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
