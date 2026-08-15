import { describe, expect, it } from "vitest";
import {
  AcousticCodeChallenge,
  parseForcedAcousticCode,
} from "../src/challenge/AcousticCodeChallenge";
import type { AcousticCode } from "../src/audio/types";

describe("AcousticCodeChallenge", () => {
  it.each([
    { answer: [2, 4, 5] },
    { answer: [5, 2, 4] },
    { answer: [4, 5, 2] },
    { answer: [4, 8, 10] },
    { answer: [6, 12, 15] },
  ] satisfies readonly { readonly answer: AcousticCode }[])(
    "accepts normalized target representation $answer",
    ({ answer }) => {
      const challenge = forced245();
      expect(challenge.submit(answer)).toBe("correct");
      expect(challenge.isSolved).toBe(true);
    },
  );

  it.each([{ answer: [2, 4, 6] }, { answer: [2, 3, 5] }] satisfies readonly {
    readonly answer: AcousticCode;
  }[])("rejects $answer for target 245", ({ answer }) => {
    const challenge = forced245();
    expect(challenge.submit(answer)).toBe("error");
    expect(challenge.isSolved).toBe(false);
  });

  it("keeps the same round after ERROR", () => {
    const challenge = forced245();
    const roundBeforeError = challenge.currentRound;

    expect(challenge.submit([2, 4, 6])).toBe("error");
    expect(challenge.prepareForPlayback()).toBe(roundBeforeError);
    expect(challenge.currentRound).toBe(roundBeforeError);
  });

  it("creates a new round only after CORRECT followed by playback", () => {
    const random = sequenceRandom([0, 0.25, 0.999, 0.5]);
    const challenge = new AcousticCodeChallenge({
      catalog: [
        [1, 2, 3],
        [2, 4, 5],
      ],
      random,
    });
    const firstRound = challenge.currentRound;

    expect(challenge.submit([2, 4, 5])).toBe("error");
    expect(challenge.prepareForPlayback()).toBe(firstRound);
    expect(challenge.submit([2, 4, 6])).toBe("correct");
    expect(challenge.currentRound).toBe(firstRound);

    const secondRound = challenge.prepareForPlayback();
    expect(secondRound.id).toBe(firstRound.id + 1);
    expect(secondRound.code).toEqual([2, 4, 5]);
    expect(secondRound).not.toBe(firstRound);
    expect(challenge.isSolved).toBe(false);
  });

  it("RESET replaces an unsolved round with a different catalog code", () => {
    const random = sequenceRandom([0, 0.25, 0, 0.75]);
    const challenge = new AcousticCodeChallenge({
      catalog: [
        [1, 2, 3],
        [2, 4, 5],
      ],
      random,
    });
    const firstRound = challenge.currentRound;

    expect(challenge.submit([2, 4, 5])).toBe("error");
    const resetRound = challenge.resetRound();

    expect(resetRound.id).toBe(firstRound.id + 1);
    expect(resetRound.code).toEqual([2, 4, 5]);
    expect(resetRound.code).not.toEqual(firstRound.code);
    expect(challenge.isSolved).toBe(false);
  });

  it("preserves a forced development code across RESET", () => {
    const challenge = forced245();
    const firstRound = challenge.currentRound;
    const resetRound = challenge.resetRound();

    expect(resetRound.id).toBe(firstRound.id + 1);
    expect(resetRound.code).toEqual([2, 4, 5]);
  });

  it("compares answers only after normalization", () => {
    const challenge = forced245();
    expect(challenge.submit([15, 6, 12])).toBe("correct");
  });
});

describe("parseForcedAcousticCode", () => {
  it("parses and normalizes the hidden 245 development code", () => {
    expect(parseForcedAcousticCode("245")).toEqual([2, 4, 5]);
    expect(parseForcedAcousticCode("524")).toEqual([2, 4, 5]);
  });

  it("ignores missing or malformed values", () => {
    expect(parseForcedAcousticCode(null)).toBeUndefined();
    expect(parseForcedAcousticCode("24")).toBeUndefined();
    expect(parseForcedAcousticCode("205")).toBeUndefined();
  });
});

function forced245(): AcousticCodeChallenge {
  return new AcousticCodeChallenge({
    forcedCode: [2, 4, 5],
    random: () => 0.5,
  });
}

function sequenceRandom(values: readonly number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index];
    if (value === undefined) {
      throw new Error("The deterministic random sequence is exhausted.");
    }
    index += 1;
    return value;
  };
}
