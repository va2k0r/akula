import { describe, expect, it } from "vitest";
import { contactSoundProfileById } from "../src/audio/contactSoundBank";
import {
  contactAnalysisComponentIsActive,
  renderContactVolumeHistogram,
  sampleContactModulationTrace,
  type ContactAnalysisMode,
} from "../src/visualization/contactProfileAnalysis";

const SIGNATURE = [1, 2, 4] as const;

describe("contact profile visual analysis", () => {
  it("draws one modulation crest for every literal repetition", () => {
    for (const repetitions of [1, 2, 3, 4, 5, 6, 7]) {
      expect(circularCrestCount(repetitions)).toBe(repetitions);
    }
  });

  it("keeps all three traces in MIX and isolates the selected trace", () => {
    expect(activeComponents("mix")).toEqual([true, true, true]);
    expect(activeComponents("a")).toEqual([true, false, false]);
    expect(activeComponents("b")).toEqual([false, true, false]);
    expect(activeComponents("c")).toEqual([false, false, true]);
  });

  it("reveals every isolated beat as a volume peak", () => {
    const profile = contactSoundProfileById("los-angeles-machinery");
    const source = syntheticImpulseSources();
    for (const [mode, expectedPeakBins] of [
      ["a", 1],
      ["b", 2],
      ["c", 4],
    ] as const) {
      const levels = renderContactVolumeHistogram(
        source,
        profile,
        SIGNATURE,
        4.5,
        mode,
        180,
      );
      expect(levels.filter((level) => level > 0.99)).toHaveLength(
        expectedPeakBins,
      );
    }
  });

  it("merges coincident MIX beats into one taller volume peak", () => {
    const levels = renderContactVolumeHistogram(
      syntheticImpulseSources(),
      contactSoundProfileById("los-angeles-machinery"),
      SIGNATURE,
      4.5,
      "mix",
      180,
    );

    // 1 + 2 + 4 schedules contain seven events, but their shared phase grid
    // has only four unique instants. The histogram correctly shows four bars.
    expect(levels.filter((level) => level > 0.2)).toHaveLength(4);
  });

  it("cannot cancel one component by inverting another recording", () => {
    const profile = contactSoundProfileById("los-angeles-machinery");
    const positive = renderContactVolumeHistogram(
      syntheticImpulseSources(),
      profile,
      SIGNATURE,
      4.5,
      "mix",
      180,
    );
    const invertedB = renderContactVolumeHistogram(
      syntheticImpulseSources([1, -1, 1]),
      profile,
      SIGNATURE,
      4.5,
      "mix",
      180,
    );

    expect([...invertedB]).toEqual([...positive]);
  });
});

function circularCrestCount(repetitions: number): number {
  const sampleCount = 840;
  const samples = Array.from({ length: sampleCount }, (_, sampleIndex) =>
    sampleContactModulationTrace(repetitions, sampleIndex / sampleCount),
  );
  let crests = 0;
  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    const previous =
      samples[(sampleIndex - 1 + samples.length) % samples.length] ?? 0;
    const current = samples[sampleIndex] ?? 0;
    const next = samples[(sampleIndex + 1) % samples.length] ?? 0;
    if (current >= previous && current > next) {
      crests += 1;
    }
  }
  return crests;
}

function activeComponents(mode: ContactAnalysisMode): readonly boolean[] {
  return ([0, 1, 2] as const).map((componentIndex) =>
    contactAnalysisComponentIsActive(mode, componentIndex),
  );
}

function syntheticImpulseSources(
  polarities: readonly [number, number, number] = [1, 1, 1],
): {
  readonly sampleRate: number;
  readonly components: readonly [Float32Array, Float32Array, Float32Array];
} {
  const impulse = (polarity: number): Float32Array => {
    const samples = new Float32Array(128);
    samples[0] = polarity;
    return samples;
  };
  return {
    sampleRate: 1_000,
    components: [
      impulse(polarities[0]),
      impulse(polarities[1]),
      impulse(polarities[2]),
    ],
  };
}
