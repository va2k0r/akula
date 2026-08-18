import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HullStressScheduler,
  hullStressLevels,
  type HullStressMotion,
} from "../src/game/HullStressAudio";

const HARD_DESCENT: HullStressMotion = {
  depthRateMetersPerSecond: 5.2,
  horizontalSpeedMetersPerSecond: 0,
  turnRateDegreesPerSecond: 0,
};
const HARD_TURN: HullStressMotion = {
  depthRateMetersPerSecond: 0,
  horizontalSpeedMetersPerSecond: 15.8,
  turnRateDegreesPerSecond: 5.7,
};

interface HullStressManifest {
  readonly generatorVersion: number;
  readonly provenance: string;
  readonly playbackPolicy: string;
  readonly sourceRecordings: readonly {
    readonly id: string;
    readonly fileName: string;
    readonly catalogNumber: number;
    readonly license: string;
    readonly sha256: string;
  }[];
  readonly banks: readonly {
    readonly id: string;
    readonly clips: readonly {
      readonly file: string;
      readonly provenance: string;
      readonly sourceId: string;
      readonly sourceCatalogNumber: number;
      readonly durationSeconds: number;
      readonly sampleRate: number;
      readonly channels: number;
      readonly sha256: string;
    }[];
  }[];
}

describe("physical hull-stress load", () => {
  it("uses actual descent rate and never treats ascent as pressure load", () => {
    expect(
      hullStressLevels({
        depthRateMetersPerSecond: -6,
        horizontalSpeedMetersPerSecond: 0,
        turnRateDegreesPerSecond: 0,
      }).descentIntensity,
    ).toBe(0);
    expect(hullStressLevels(HARD_DESCENT).descentIntensity).toBe(1);
  });

  it("requires real horizontal velocity and real yaw rate together", () => {
    expect(
      hullStressLevels({
        depthRateMetersPerSecond: 0,
        horizontalSpeedMetersPerSecond: 15.8,
        turnRateDegreesPerSecond: 0,
      }).maneuverIntensity,
    ).toBe(0);
    expect(
      hullStressLevels({
        depthRateMetersPerSecond: 0,
        horizontalSpeedMetersPerSecond: 0,
        turnRateDegreesPerSecond: 5.7,
      }).maneuverIntensity,
    ).toBe(0);
    const hardTurn = hullStressLevels(HARD_TURN);
    expect(hardTurn.turnLoadMetersPerSecondSquared).toBeCloseTo(1.572, 3);
    expect(hardTurn.maneuverIntensity).toBe(1);
  });
});

describe("understated hull-stress scheduler", () => {
  it("selects only pressure clips for a fast descent", () => {
    const scheduler = new HullStressScheduler(() => 0.5);
    expect(scheduler.update(0, HARD_DESCENT)).toBeNull();
    const event = scheduler.update(1, HARD_DESCENT);
    expect(event?.kind).toBe("descent");
    expect(event?.file).toMatch(/^descent\/pressure-/);
    expect(event?.gain).toBeCloseTo(0.17, 3);
  });

  it("selects only torsion clips for a high-speed turn", () => {
    const scheduler = new HullStressScheduler(() => 0.5);
    expect(scheduler.update(0, HARD_TURN)).toBeNull();
    const event = scheduler.update(1, HARD_TURN);
    expect(event?.kind).toBe("maneuver");
    expect(event?.file).toMatch(/^maneuver\/torsion-/);
    expect(event?.gain).toBeCloseTo(0.16, 3);
  });

  it("brings hard-load events forward without creating a continuous loop", () => {
    const gentle = new HullStressScheduler(() => 0.5);
    const hard = new HullStressScheduler(() => 0.5);
    const gentleMotion: HullStressMotion = {
      ...HARD_DESCENT,
      depthRateMetersPerSecond: 2.2,
    };

    gentle.update(0, gentleMotion);
    hard.update(0, HARD_DESCENT);
    expect(hard.update(1, HARD_DESCENT)?.gain).toBeGreaterThan(0.15);
    expect(gentle.update(1, gentleMotion)).toBeNull();
    const gentleFirst = gentle.update(2.5, gentleMotion);
    expect(gentleFirst?.gain).toBeLessThan(0.08);

    // At maximum pressure a second finite event has arrived; at a barely
    // active descent the deliberately long irregular gap is still silent.
    expect(hard.update(5.5, HARD_DESCENT)).not.toBeNull();
    expect(gentle.update(5.5, gentleMotion)).toBeNull();
  });

  it("does not immediately repeat the same recorded fragment", () => {
    const scheduler = new HullStressScheduler(() => 0.5);
    scheduler.update(0, HARD_DESCENT);
    const first = scheduler.update(1, HARD_DESCENT);
    const second = scheduler.update(5.5, HARD_DESCENT);
    expect(first?.clipIndex).not.toBe(second?.clipIndex);
  });

  it("holds due events while the page does not own the audio session", () => {
    const scheduler = new HullStressScheduler(() => 0.5);
    scheduler.update(0, HARD_TURN, false);
    expect(scheduler.update(5, HARD_TURN, false)).toBeNull();
    expect(scheduler.snapshot.eventCount).toBe(0);
    expect(scheduler.update(5, HARD_TURN, true)?.kind).toBe("maneuver");
  });
});

describe("recorded hull-stress clip bank", () => {
  it("ships 8 pressure and 11 torsion micro-events cut from sources 27 and 28", () => {
    const manifest = readManifest();
    expect(manifest.generatorVersion).toBe(1);
    expect(manifest.provenance).toContain("recordings 27 and 28");
    expect(manifest.playbackPolicy).toContain("actual horizontal speed");
    expect(
      manifest.sourceRecordings.map(({ catalogNumber }) => catalogNumber),
    ).toEqual([27, 28]);
    expect(
      manifest.banks.find(({ id }) => id === "descent")?.clips,
    ).toHaveLength(8);
    expect(
      manifest.banks.find(({ id }) => id === "maneuver")?.clips,
    ).toHaveLength(11);
  });

  it("keeps every runtime clip mono PCM16, finite, silent-tailed and hash-verified", () => {
    const manifest = readManifest();
    for (const bank of manifest.banks) {
      for (const clip of bank.clips) {
        const wav = readPublicAsset(clip.file);
        expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
        expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
        expect(wav.readUInt16LE(22)).toBe(1);
        expect(wav.readUInt32LE(24)).toBe(48_000);
        expect(wav.readUInt16LE(34)).toBe(16);
        expect(clip.provenance).toBe("recorded-steel-excerpt");
        expect(clip.sampleRate).toBe(48_000);
        expect(clip.channels).toBe(1);
        expect(clip.durationSeconds).toBeGreaterThanOrEqual(0.95);
        expect(clip.durationSeconds).toBeLessThanOrEqual(2.9);
        expect(createHash("sha256").update(wav).digest("hex")).toBe(
          clip.sha256,
        );

        const sampleCount = wav.readUInt32LE(40) / 2;
        for (
          let sampleIndex = sampleCount - 192;
          sampleIndex < sampleCount;
          sampleIndex += 1
        ) {
          expect(wav.readInt16LE(44 + sampleIndex * 2)).toBe(0);
        }
      }
    }
  });

  it("retains exact hashes for both untouched CC0 sources", () => {
    const manifest = readManifest();
    expect(manifest.sourceRecordings).toHaveLength(2);
    for (const source of manifest.sourceRecordings) {
      expect(source.license).toBe("CC0 1.0 Universal");
      expect(
        createHash("sha256")
          .update(readSourceAsset(source.fileName))
          .digest("hex"),
      ).toBe(source.sha256);
    }
  });
});

function readManifest(): HullStressManifest {
  return JSON.parse(
    readPublicAsset("MANIFEST.json").toString("utf8"),
  ) as HullStressManifest;
}

function readPublicAsset(relativePath: string): Buffer {
  return readFileSync(
    new URL(
      `../public/assets/audio/hull-stress/v1/${relativePath}`,
      import.meta.url,
    ),
  );
}

function readSourceAsset(fileName: string): Buffer {
  return readFileSync(
    new URL(
      `../assets/research/submarine-sfx-2026-08-17/masters/usc-sound-effect-archive/hull-stress/${fileName}`,
      import.meta.url,
    ),
  );
}
