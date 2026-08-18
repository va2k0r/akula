import {
  CONTACT_CONTINUOUS_MIX_EVENT_GAIN,
  CONTACT_CONTINUOUS_ROTOR_BED_GAIN,
  renderContinuousRotorBedSamples,
} from "../audio/AcousticSignatureEngine";
import {
  contactPulseOnsets,
  type ContactSoundProfile,
} from "../audio/contactSoundBank";
import type { AcousticCode } from "../audio/types";

export type ContactAnalysisMode = "mix" | "a" | "b" | "c";

export interface ContactAnalysisSourceSamples {
  readonly sampleRate: number;
  readonly components: readonly [Float32Array, Float32Array, Float32Array];
}

const TAU = Math.PI * 2;

/** One phase-locked modulation line, not the carrier-frequency spectrum. */
export function sampleContactModulationTrace(
  repetitions: number,
  cyclePhase: number,
  eventPhaseOffset = 0,
): number {
  assertPositiveInteger(repetitions, "Repetition count");
  if (!Number.isFinite(cyclePhase)) {
    throw new RangeError("Cycle phase must be finite.");
  }
  assertUnitPhase(eventPhaseOffset, "Event phase offset");
  return Math.cos(TAU * (repetitions * cyclePhase - eventPhaseOffset));
}

export function contactAnalysisComponentIsActive(
  mode: ContactAnalysisMode,
  componentIndex: 0 | 1 | 2,
): boolean {
  return (
    mode === "mix" || ({ a: 0, b: 1, c: 2 } as const)[mode] === componentIndex
  );
}

/**
 * Time-binned RMS of the same finite recordings and event schedule used by the
 * listening engine. Each A/B/C stem is measured separately and their positive
 * RMS levels are then added, so coincident beats always form one taller peak
 * instead of being allowed to phase-cancel. The modulation trace above remains
 * the component reference.
 */
export function renderContactVolumeHistogram(
  source: ContactAnalysisSourceSamples,
  soundProfile: ContactSoundProfile,
  signature: AcousticCode,
  cycleDurationSeconds: number,
  mode: ContactAnalysisMode,
  binCount: number,
): Float32Array {
  assertPositiveInteger(source.sampleRate, "Sample rate");
  assertPositiveFinite(cycleDurationSeconds, "Cycle duration");
  assertPositiveInteger(binCount, "Histogram bin count");
  for (const repetitions of signature) {
    assertPositiveInteger(repetitions, "Repetition count");
  }
  for (const samples of source.components) {
    if (samples.length < 1) {
      throw new RangeError("Every contact component needs source samples.");
    }
  }

  const frameCount = Math.max(
    1,
    Math.round(cycleDurationSeconds * source.sampleRate),
  );
  const constructiveStems: Float32Array[] = [];

  if (mode === "mix") {
    const rotorBed = renderContinuousRotorBedSamples(
      source.components[0],
      frameCount,
      source.sampleRate,
      signature[0],
    );
    const rotorStem = new Float32Array(frameCount);
    for (let frame = 0; frame < frameCount; frame += 1) {
      rotorStem[frame] =
        (rotorBed[frame] ?? 0) * CONTACT_CONTINUOUS_ROTOR_BED_GAIN;
    }
    constructiveStems.push(rotorStem);
  }

  for (const componentIndex of [0, 1, 2] as const) {
    if (!contactAnalysisComponentIsActive(mode, componentIndex)) {
      continue;
    }
    const component = soundProfile.components[componentIndex];
    const componentSamples = source.components[componentIndex];
    const componentStem = new Float32Array(frameCount);
    const phaseOffset = mode === "mix" ? 0 : component.phaseOffset;
    const gain =
      component.mixGain *
      (mode === "mix" ? CONTACT_CONTINUOUS_MIX_EVENT_GAIN : 1);
    const onsets = contactPulseOnsets(
      signature[componentIndex],
      cycleDurationSeconds,
      phaseOffset,
    );

    for (const onsetSeconds of onsets) {
      const onsetFrame = Math.round(onsetSeconds * source.sampleRate);
      for (
        let sourceFrame = 0;
        sourceFrame < componentSamples.length;
        sourceFrame += 1
      ) {
        const destinationFrame = (onsetFrame + sourceFrame) % frameCount;
        componentStem[destinationFrame] =
          (componentStem[destinationFrame] ?? 0) +
          (componentSamples[sourceFrame] ?? 0) * gain;
      }
    }
    constructiveStems.push(componentStem);
  }

  const levels = new Float32Array(binCount);
  let maximumLevel = 0;
  for (let bin = 0; bin < binCount; bin += 1) {
    const startFrame = Math.floor((bin * frameCount) / binCount);
    const endFrame = Math.max(
      startFrame + 1,
      Math.floor(((bin + 1) * frameCount) / binCount),
    );
    let level = 0;
    for (const stem of constructiveStems) {
      let squareSum = 0;
      for (let frame = startFrame; frame < endFrame; frame += 1) {
        squareSum += (stem[frame] ?? 0) ** 2;
      }
      level += Math.sqrt(squareSum / (endFrame - startFrame));
    }
    levels[bin] = level;
    maximumLevel = Math.max(maximumLevel, level);
  }

  if (maximumLevel > 0) {
    for (let bin = 0; bin < levels.length; bin += 1) {
      levels[bin] = (levels[bin] ?? 0) / maximumLevel;
    }
  }
  return levels;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be positive.`);
  }
}

function assertUnitPhase(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError(`${name} must be in [0, 1).`);
  }
}
