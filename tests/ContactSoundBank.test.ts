import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderContinuousRotorBedSamples } from "../src/audio/AcousticSignatureEngine";
import {
  CONTACT_SOUND_PROFILES,
  contactPulseOnsets,
  contactSoundAssetPath,
  contactSoundProfileById,
} from "../src/audio/contactSoundBank";
import { FROSTBITE_CONTACT_CYCLE_DURATION_SECONDS } from "../src/game/ContactSignature";
import { VESSEL_CLASS_CATALOG } from "../src/game/NavalContactCatalog";

interface GeneratedManifest {
  readonly generatorVersion: number;
  readonly thirdPartyMaterial: boolean;
  readonly provenance: string;
  readonly sourceRecordings: readonly {
    readonly id: string;
    readonly fileName: string;
    readonly sourcePage: string;
    readonly license: string;
    readonly sha256: string;
  }[];
  readonly profiles: readonly {
    readonly id: string;
    readonly components: readonly {
      readonly file: string;
      readonly provenance: string;
      readonly sourceId: string;
      readonly onsetSecondsWithinEvent: number;
      readonly durationSeconds: number;
      readonly sha256: string;
    }[];
  }[];
}

describe("countable contact sound repository", () => {
  it("covers every neutral and hostile vessel class exactly once", () => {
    const classProfileIds = VESSEL_CLASS_CATALOG.map(
      ({ audioProfileId }) => audioProfileId,
    ).sort();
    const soundProfileIds = CONTACT_SOUND_PROFILES.map(({ id }) => id).sort();

    expect(soundProfileIds).toEqual(classProfileIds);
    expect(new Set(soundProfileIds).size).toBe(soundProfileIds.length);
  });

  it("keeps every component finite, mono, uncompressed and recording-derived", () => {
    const manifest = readManifest();
    expect(manifest.generatorVersion).toBe(3);
    expect(manifest.thirdPartyMaterial).toBe(true);
    expect(manifest.provenance).toContain("authentic field recordings");

    for (const profile of CONTACT_SOUND_PROFILES) {
      const manifestProfile = manifest.profiles.find(
        (candidate) => candidate.id === profile.id,
      );
      expect(manifestProfile).toBeDefined();
      for (const componentIndex of [0, 1, 2] as const) {
        const assetPath = contactSoundAssetPath(profile, componentIndex);
        const wav = readPublicAsset(assetPath);
        expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
        expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
        expect(wav.readUInt16LE(22)).toBe(1);
        expect(wav.readUInt32LE(24)).toBe(48_000);
        expect(wav.readUInt16LE(34)).toBe(16);
        const sampleCount = wav.readUInt32LE(40) / 2;
        for (
          let sampleIndex = sampleCount - 144;
          sampleIndex < sampleCount;
          sampleIndex += 1
        ) {
          expect(wav.readInt16LE(44 + sampleIndex * 2)).toBe(0);
        }
        const manifestComponent = manifestProfile?.components[componentIndex];
        expect(manifestComponent?.provenance).toBe(
          "authentic-recording-excerpt",
        );
        expect(
          manifest.sourceRecordings.some(
            ({ id }) => id === manifestComponent?.sourceId,
          ),
        ).toBe(true);
        expect(manifestComponent?.file).toBe(
          assetPath.replace("assets/audio/contacts/countable/v1/", ""),
        );
        expect(createHash("sha256").update(wav).digest("hex")).toBe(
          manifestComponent?.sha256,
        );
      }
    }
  });

  it("retains and verifies every licensed source recording", () => {
    const manifest = readManifest();
    expect(manifest.sourceRecordings).toHaveLength(5);
    for (const source of manifest.sourceRecordings) {
      expect(source.sourcePage).toMatch(/^https:\/\/commons\.wikimedia\.org\//);
      expect(source.license).toMatch(/^CC BY /);
      expect(
        createHash("sha256")
          .update(readSourceAsset(source.fileName))
          .digest("hex"),
      ).toBe(source.sha256);
    }
  });

  it("gives every recorded event an attack, body, coda and silent tail", () => {
    const manifest = readManifest();
    for (const profile of manifest.profiles) {
      for (const component of profile.components) {
        const wav = readPublicAsset(
          `assets/audio/contacts/countable/v1/${component.file}`,
        );
        const samples = decodePcm16Samples(wav);
        const windowFrames = 480;
        const levels: number[] = [];
        for (
          let startFrame = 0;
          startFrame + windowFrames <= samples.length;
          startFrame += windowFrames
        ) {
          levels.push(windowRms(samples.slice(startFrame, startFrame + 480)));
        }
        const maximumLevel = Math.max(...levels);
        const codaLevel = levels.at(-2) ?? maximumLevel;

        expect(component.onsetSecondsWithinEvent).toBeGreaterThanOrEqual(0.04);
        expect(component.onsetSecondsWithinEvent).toBeLessThanOrEqual(0.085);
        expect(component.durationSeconds).toBeGreaterThanOrEqual(0.24);
        expect(component.durationSeconds).toBeLessThanOrEqual(0.48);
        expect(maximumLevel).toBeGreaterThan(0.035);
        expect(codaLevel / maximumLevel).toBeLessThan(0.14);
        expect(
          Math.max(...levels) / Math.max(0.001, Math.min(...levels)),
        ).toBeGreaterThan(2.5);
      }
    }
  });

  it("keeps PLAY ALL continuously energized between countable events", () => {
    const sampleRate = 48_000;
    const frameCount = Math.round(
      FROSTBITE_CONTACT_CYCLE_DURATION_SECONDS * sampleRate,
    );
    const rmsWindowFrames = Math.round(sampleRate * 0.02);

    for (const vesselClass of VESSEL_CLASS_CATALOG) {
      const profile = contactSoundProfileById(vesselClass.audioProfileId);
      const propeller = decodePcm16Samples(
        readPublicAsset(contactSoundAssetPath(profile, 0)),
      );
      const bed = renderContinuousRotorBedSamples(
        propeller,
        frameCount,
        sampleRate,
        vesselClass.signatureCode[0],
      );
      const windowLevels: number[] = [];
      for (
        let startFrame = 0;
        startFrame + rmsWindowFrames <= bed.length;
        startFrame += rmsWindowFrames
      ) {
        windowLevels.push(
          windowRms(bed.slice(startFrame, startFrame + rmsWindowFrames)),
        );
      }

      expect(windowPeak(bed)).toBeGreaterThanOrEqual(0.419);
      expect(windowPeak(bed)).toBeLessThanOrEqual(0.421);
      expect(Math.min(...windowLevels)).toBeGreaterThan(0.012);
    }
  });

  it("places the literal number of attacks at equal intervals", () => {
    expect(contactPulseOnsets(4, 4, 0.5)).toEqual([0.5, 1.5, 2.5, 3.5]);
    expect(contactPulseOnsets(0, 4, 0.5)).toEqual([]);
    expect(() => contactPulseOnsets(-1, 4, 0)).toThrow(RangeError);
  });

  it("leaves audible separation between unlike channels", () => {
    for (const vesselClass of VESSEL_CLASS_CATALOG) {
      const profile = contactSoundProfileById(vesselClass.audioProfileId);
      const events = profile.components.flatMap((component, componentIndex) =>
        contactPulseOnsets(
          vesselClass.signatureCode[componentIndex] ?? 0,
          FROSTBITE_CONTACT_CYCLE_DURATION_SECONDS,
          component.phaseOffset,
        ).map((time) => ({ componentIndex, time })),
      );
      const separation = minimumCrossChannelSeparation(
        events,
        FROSTBITE_CONTACT_CYCLE_DURATION_SECONDS,
      );
      expect(separation).toBeGreaterThan(0.055);
    }
  });
});

function minimumCrossChannelSeparation(
  events: readonly { readonly componentIndex: number; readonly time: number }[],
  cycleDurationSeconds: number,
): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (let leftIndex = 0; leftIndex < events.length; leftIndex += 1) {
    const left = events[leftIndex];
    if (left === undefined) {
      continue;
    }
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < events.length;
      rightIndex += 1
    ) {
      const right = events[rightIndex];
      if (right === undefined || left.componentIndex === right.componentIndex) {
        continue;
      }
      const directDistance = Math.abs(left.time - right.time);
      minimum = Math.min(
        minimum,
        directDistance,
        cycleDurationSeconds - directDistance,
      );
    }
  }
  return minimum;
}

function readManifest(): GeneratedManifest {
  return JSON.parse(
    readPublicAsset(
      "assets/audio/contacts/countable/v1/MANIFEST.json",
    ).toString("utf8"),
  ) as GeneratedManifest;
}

function readPublicAsset(relativePath: string): Buffer {
  return readFileSync(new URL(`../public/${relativePath}`, import.meta.url));
}

function readSourceAsset(fileName: string): Buffer {
  return readFileSync(
    new URL(`../assets/source/contact-recordings/${fileName}`, import.meta.url),
  );
}

function decodePcm16Samples(wav: Buffer): Float32Array {
  const sampleCount = wav.readUInt32LE(40) / 2;
  return Float32Array.from(
    { length: sampleCount },
    (_, index) => wav.readInt16LE(44 + index * 2) / 32_768,
  );
}

function windowPeak(samples: ArrayLike<number>): number {
  let maximum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    maximum = Math.max(maximum, Math.abs(samples[index] ?? 0));
  }
  return maximum;
}

function windowRms(samples: ArrayLike<number>): number {
  let squareSum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    squareSum += (samples[index] ?? 0) ** 2;
  }
  return Math.sqrt(squareSum / samples.length);
}
