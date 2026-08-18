import { describe, expect, it } from "vitest";
import { samplePulseEnvelope } from "../src/audio/perceptualEncoding";
import { PROPELLER_PRESET } from "../src/audio/propellerPreset";
import {
  assertSignalQuality,
  sampleAcousticSignatureVisual,
  type AcousticVisualSample,
} from "../src/visualization/signalVisualMath";

describe("sampleAcousticSignatureVisual", () => {
  it("repeats after one fundamental cycle", () => {
    const atStart = sampleAcousticSignatureVisual([2, 4, 5], 3.6, 0.83, 1, 0);
    const afterOneCycle = sampleAcousticSignatureVisual(
      [2, 4, 5],
      3.6,
      0.83 + 3.6,
      1,
      500,
    );

    expect(afterOneCycle.combinedEnvelope).toBeCloseTo(
      atStart.combinedEnvelope,
      12,
    );
    expect(afterOneCycle.constructiveEnvelope).toBeCloseTo(
      atStart.constructiveEnvelope,
      12,
    );
    expect(afterOneCycle.traceStrength).toBe(atStart.traceStrength);
    expect(afterOneCycle.uncertainty).toBe(atStart.uncertainty);
  });

  it("is the exact composite of the same three envelopes used by audio", () => {
    for (const elapsedSeconds of [0, 0.17, 0.61, 1.23, 2.91, 3.59]) {
      const sample = sampleAcousticSignatureVisual(
        [1, 2, 4],
        3.6,
        elapsedSeconds,
        1,
        Math.floor(elapsedSeconds * 100),
      );
      expect(sample.combinedEnvelope).toBeCloseTo(
        expectedCombinedEnvelope([1, 2, 4], elapsedSeconds, 3.6),
        12,
      );
      expect(sample.constructiveEnvelope).toBeCloseTo(
        expectedConstructiveEnvelope([1, 2, 4], elapsedSeconds, 3.6),
        12,
      );
    }
  });

  it("adds A, B and C constructively at coincident beats", () => {
    const allComponents = sampleAcousticSignatureVisual(
      [1, 2, 4],
      4,
      0,
      1,
      0,
    ).constructiveEnvelope;
    const isolatedComponents = [
      sampleAcousticSignatureVisual([1, 0, 0], 4, 0, 1, 0).constructiveEnvelope,
      sampleAcousticSignatureVisual([0, 2, 0], 4, 0, 1, 0).constructiveEnvelope,
      sampleAcousticSignatureVisual([0, 0, 4], 4, 0, 1, 0).constructiveEnvelope,
    ] as const;

    expect(allComponents).toBeCloseTo(
      isolatedComponents.reduce((sum, level) => sum + level, 0),
      12,
    );
    expect(allComponents).toBe(1);
    expect(isolatedComponents.every((level) => level > 0)).toBe(true);
  });

  it("shows the C, B+C, C crests between consecutive A crests", () => {
    const cycleDuration = 4;
    const samples = [0, 1, 2, 3].map(
      (elapsedSeconds, sampleIndex) =>
        sampleAcousticSignatureVisual(
          [1, 2, 4],
          cycleDuration,
          elapsedSeconds,
          1,
          sampleIndex,
        ).combinedEnvelope,
    );

    expect(samples[0]).toBeCloseTo(1, 12);
    expect(samples[1]).toBeCloseTo(
      expectedCombinedEnvelope([1, 2, 4], 1, cycleDuration),
      12,
    );
    expect(samples[2]).toBeCloseTo(
      expectedCombinedEnvelope([1, 2, 4], 2, cycleDuration),
      12,
    );
    expect(samples[3]).toBeCloseTo(samples[1] ?? 0, 12);
    expect(samples[2]).toBeGreaterThan(0);
    expect(samples[1]).toBeGreaterThan(0);
  });

  it("removes zero components from both the sum and its normalization", () => {
    expect(
      sampleAcousticSignatureVisual([1, 0, 4], 4, 0, 1, 0).combinedEnvelope,
    ).toBeCloseTo(1, 12);
    expect(
      sampleAcousticSignatureVisual([1, 0, 4], 4, 1, 1, 1).combinedEnvelope,
    ).toBeCloseTo(expectedCombinedEnvelope([1, 0, 4], 1, 4), 12);
    expect(
      sampleAcousticSignatureVisual([0, 0, 4], 4, 1, 1, 2).combinedEnvelope,
    ).toBeCloseTo(1, 12);
    expect(
      sampleAcousticSignatureVisual([0, 0, 0], 4, 1, 1, 3).combinedEnvelope,
    ).toBe(0);
  });

  it("degrades legibility without desynchronizing the envelope", () => {
    const clearSamples = createSamples(1, 256);
    const poorSamples = createSamples(0, 256);

    expect(clearSamples.every((sample) => sample.traceStrength === 1)).toBe(
      true,
    );
    expect(clearSamples.every((sample) => sample.uncertainty === 0)).toBe(true);
    expect(poorSamples.every((sample) => sample.uncertainty === 1)).toBe(true);
    expect(
      poorSamples.every(
        (sample, index) =>
          sample.combinedEnvelope === clearSamples[index]?.combinedEnvelope,
      ),
    ).toBe(true);
    expect(
      poorSamples.every(
        (sample, index) =>
          sample.constructiveEnvelope ===
          clearSamples[index]?.constructiveEnvelope,
      ),
    ).toBe(true);
  });

  it("validates code, time, duration, quality and sample index", () => {
    expect(() => sampleAcousticSignatureVisual([2, 4, 5], 0, 0, 1, 0)).toThrow(
      RangeError,
    );
    expect(() =>
      sampleAcousticSignatureVisual([2, 4, 5], 3.6, -1, 1, 0),
    ).toThrow(RangeError);
    expect(() =>
      sampleAcousticSignatureVisual([-1, 4, 5], 3.6, 0, 1, 0),
    ).toThrow(RangeError);
    expect(() =>
      sampleAcousticSignatureVisual([2, 4, 5], 3.6, 0, 1.1, 0),
    ).toThrow(RangeError);
    expect(() =>
      sampleAcousticSignatureVisual([2, 4, 5], 3.6, 0, 1, -1),
    ).toThrow(RangeError);
  });
});

describe("assertSignalQuality", () => {
  it("accepts both quality limits", () => {
    expect(() => assertSignalQuality(0)).not.toThrow();
    expect(() => assertSignalQuality(1)).not.toThrow();
  });
});

function createSamples(
  signalQuality: number,
  count: number,
): readonly AcousticVisualSample[] {
  return Array.from({ length: count }, (_, sampleIndex) =>
    sampleAcousticSignatureVisual(
      [1, 2, 4],
      1,
      sampleIndex / count,
      signalQuality,
      sampleIndex,
    ),
  );
}

function expectedCombinedEnvelope(
  code: readonly [number, number, number],
  elapsedSeconds: number,
  cycleDuration: number,
): number {
  const weights = modulationWeights();
  let activeWeight = 0;
  let combinedLevel = 0;
  for (const componentIndex of [0, 1, 2] as const) {
    const repetitions = code[componentIndex];
    if (repetitions === 0) {
      continue;
    }
    const weight = weights[componentIndex];
    activeWeight += weight;
    combinedLevel +=
      weight *
      samplePulseEnvelope(
        repetitions,
        cycleDuration,
        elapsedSeconds,
        pulseShapePowers()[componentIndex],
      );
  }
  return activeWeight === 0 ? 0 : combinedLevel / activeWeight;
}

function expectedConstructiveEnvelope(
  code: readonly [number, number, number],
  elapsedSeconds: number,
  cycleDuration: number,
): number {
  const weights = modulationWeights();
  let combinedLevel = 0;
  for (const componentIndex of [0, 1, 2] as const) {
    const repetitions = code[componentIndex];
    if (repetitions === 0) {
      continue;
    }
    combinedLevel +=
      weights[componentIndex] *
      samplePulseEnvelope(
        repetitions,
        cycleDuration,
        elapsedSeconds,
        pulseShapePowers()[componentIndex],
      );
  }
  return combinedLevel / weights.reduce((sum, weight) => sum + weight, 0);
}

function modulationWeights(): readonly [number, number, number] {
  return [
    PROPELLER_PRESET.modulation.componentA.gainDepth * 2 +
      PROPELLER_PRESET.bed.gain *
        (1 - PROPELLER_PRESET.modulation.componentA.bedFloorScale) +
      PROPELLER_PRESET.hull.flowGain *
        (1 - PROPELLER_PRESET.hull.flowFloorScale),
    PROPELLER_PRESET.pump.gain * (1 - PROPELLER_PRESET.pump.floorScale),
    PROPELLER_PRESET.blade.gain * (1 - PROPELLER_PRESET.blade.floorScale),
  ] as const;
}

function pulseShapePowers(): readonly [number, number, number] {
  return [
    PROPELLER_PRESET.modulation.componentA.pulseShapePower,
    PROPELLER_PRESET.modulation.componentB.pulseShapePower,
    PROPELLER_PRESET.modulation.componentC.pulseShapePower,
  ];
}
