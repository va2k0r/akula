import { describe, expect, it } from "vitest";
import {
  carrierToPulse,
  sampleIndependentEnvelope,
  samplePulseEnvelope,
  scalePulseEnvelope,
} from "../src/audio/perceptualEncoding";
import { PROPELLER_PRESET } from "../src/audio/propellerPreset";

const CYCLE_DURATION = 4;

describe("independent propeller components", () => {
  it("renders 1-2-4 as three independent repetition rates", () => {
    const atStart = components([1, 2, 4], 0);
    const atQuarter = components([1, 2, 4], 1);
    const atHalf = components([1, 2, 4], 2);
    const atThreeQuarters = components([1, 2, 4], 3);

    expect(atStart).toEqual([1, 1, 1]);
    expect(atQuarter[0]).toBeGreaterThan(0);
    expect(atQuarter[0]).toBeLessThan(1);
    expect(atQuarter[1]).toBe(0);
    expect(atQuarter[2]).toBe(1);
    expect(atHalf).toEqual([0, 1, 1]);
    expect(atThreeQuarters[0]).toBeCloseTo(atQuarter[0] ?? 0, 12);
    expect(atThreeQuarters[1]).toBe(atQuarter[1]);
    expect(atThreeQuarters[2]).toBe(atQuarter[2]);
  });

  it("uses every entered value as its literal repetition count", () => {
    expect(component(3, 2, CYCLE_DURATION / 3)).toBeCloseTo(1, 12);
    expect(component(5, 1, (CYCLE_DURATION * 2) / 5)).toBeCloseTo(1, 12);
    expect(component(7, 0, (CYCLE_DURATION * 6) / 7)).toBeCloseTo(1, 12);
  });

  it("returns silence for a disabled zero component", () => {
    for (const time of [0, 0.4, 1.7, 3.9, 8]) {
      expect(component(0, 0, time)).toBe(0);
      expect(component(0, 1, time)).toBe(0);
      expect(component(0, 2, time)).toBe(0);
    }
  });
});

describe("smooth envelope primitives", () => {
  it("turns a bipolar carrier into a smooth full-depth pulse", () => {
    expect(carrierToPulse(-1, 2)).toBe(0);
    expect(carrierToPulse(0, 2)).toBe(0.25);
    expect(carrierToPulse(1, 2)).toBe(1);
  });

  it.each([1, 2, 4, 5])("places exactly %i crests in a cycle", (count) => {
    for (let pulseIndex = 0; pulseIndex < count; pulseIndex += 1) {
      const crestTime = (pulseIndex * CYCLE_DURATION) / count;
      expect(
        samplePulseEnvelope(count, CYCLE_DURATION, crestTime, 1.85),
      ).toBeCloseTo(1, 12);
    }
  });

  it("keeps a floor while preserving full pulse depth", () => {
    expect(scalePulseEnvelope(0, 0.12, 1)).toBe(0.12);
    expect(scalePulseEnvelope(0.5, 0.12, 1)).toBe(0.56);
    expect(scalePulseEnvelope(1, 0.12, 1)).toBe(1);
  });
});

describe("propeller carrier separation", () => {
  it("keeps the original underwater propulsion sources and filters", () => {
    expect(PROPELLER_PRESET.bed).toMatchObject({
      gain: 0.26,
      highpassHz: 16,
      lowpassHz: 470,
    });
    expect(PROPELLER_PRESET.hull).toMatchObject({
      fundamentalHz: 31,
      overtoneHz: 49,
      lowpassHz: 175,
      flowGain: 0.32,
      flowHighpassHz: 58,
      flowLowpassHz: 460,
    });
    expect(PROPELLER_PRESET.pump).toMatchObject({
      highpassHz: 82,
      lowpassHz: 560,
      fundamentalHz: 92,
      overtoneHz: 138,
    });
    expect(PROPELLER_PRESET.blade).toMatchObject({
      highpassHz: 145,
      lowpassHz: 680,
      fundamentalHz: 165,
      overtoneHz: 248,
    });
    expect(PROPELLER_PRESET.output.gain).toBe(0.56);
    expect(PROPELLER_PRESET.modulation).toMatchObject({
      componentA: { bedFloorScale: 0.06, pulseShapePower: 3 },
      componentB: { pulseShapePower: 6 },
      componentC: { pulseShapePower: 10 },
    });
  });

  it("accepts zero and rejects invalid independent envelope inputs", () => {
    expect(() => sampleIndependentEnvelope(0, 4, 0, 0.2, 2)).not.toThrow();
    expect(() => sampleIndependentEnvelope(-1, 4, 0, 0.2, 2)).toThrow(
      RangeError,
    );
    expect(() => sampleIndependentEnvelope(4, 4, 0, 0.5, 2)).toThrow(
      RangeError,
    );
  });
});

function components(
  code: readonly [number, number, number],
  elapsedSeconds: number,
): readonly [number, number, number] {
  return [
    component(code[0], 0, elapsedSeconds),
    component(code[1], 1, elapsedSeconds),
    component(code[2], 2, elapsedSeconds),
  ];
}

function component(
  repetitions: number,
  componentIndex: 0 | 1 | 2,
  elapsedSeconds: number,
): number {
  if (repetitions === 0) {
    return 0;
  }
  return samplePulseEnvelope(
    repetitions,
    CYCLE_DURATION,
    elapsedSeconds,
    (
      [
        PROPELLER_PRESET.modulation.componentA.pulseShapePower,
        PROPELLER_PRESET.modulation.componentB.pulseShapePower,
        PROPELLER_PRESET.modulation.componentC.pulseShapePower,
      ] as const
    )[componentIndex],
  );
}
