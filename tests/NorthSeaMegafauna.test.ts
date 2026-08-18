import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NORTH_SEA_MARINE_LIFE_COUNTS,
  NORTH_SEA_MARINE_LIFE_SPECS,
  northSeaMegafaunaEncounterActiveAt,
  northSeaMegafaunaPositionAt,
  northSeaMegafaunaStartleSpeed,
} from "../src/game/NorthSeaMegafauna";
import { terrainHeightAt } from "../src/game/WorldGeometry";

describe("North Sea megafauna encounter", () => {
  it("distributes rare mammals and sparse jellyfish across fixed habitats", () => {
    expect(NORTH_SEA_MARINE_LIFE_COUNTS).toEqual({
      orca: 1,
      "baleen-whale": 1,
      seal: 1,
      jellyfish: 2,
      "harbour-porpoise": 3,
    });

    for (const spec of NORTH_SEA_MARINE_LIFE_SPECS) {
      let activeSamples = 0;
      const sampleCount = 1_801;
      for (
        let elapsedSeconds = 0;
        elapsedSeconds < sampleCount;
        elapsedSeconds += 1
      ) {
        const position = northSeaMegafaunaPositionAt(spec, elapsedSeconds);
        expect(position.y).toBeGreaterThan(
          terrainHeightAt(position.x, position.z) + 18,
        );
        if (northSeaMegafaunaEncounterActiveAt(spec, elapsedSeconds)) {
          activeSamples += 1;
        }
      }
      const dutyCycle = activeSamples / sampleCount;
      expect(dutyCycle).toBeLessThan(
        spec.species === "jellyfish" ? 0.42 : 0.14,
      );
      expect(dutyCycle).toBeGreaterThan(0.025);
    }
  });

  it("ships a valid non-empty GLB for every species", () => {
    const modelPaths = new Set(
      NORTH_SEA_MARINE_LIFE_SPECS.map((spec) => spec.modelPath),
    );
    expect(modelPaths.size).toBe(5);

    for (const modelPath of modelPaths) {
      const absolutePath = join(process.cwd(), "public", modelPath);
      const header = readFileSync(absolutePath)
        .subarray(0, 4)
        .toString("ascii");
      expect(header).toBe("glTF");
      expect(statSync(absolutePath).size).toBeGreaterThan(32_000);
    }
  });

  it("uses embedded swim clips where supplied and procedural motion otherwise", () => {
    const animationBySpecies = Object.fromEntries(
      NORTH_SEA_MARINE_LIFE_SPECS.map((spec) => [spec.species, spec.animation]),
    );

    expect(animationBySpecies).toEqual({
      orca: "procedural",
      "baleen-whale": "embedded",
      seal: "embedded",
      jellyfish: "procedural",
      "harbour-porpoise": "procedural",
    });
  });

  it("startles mammals immediately while jellyfish remain passive", () => {
    expect(
      northSeaMegafaunaStartleSpeed("harbour-porpoise", 20, 0.16),
    ).toBeGreaterThan(10);
    expect(northSeaMegafaunaStartleSpeed("orca", 20, 0.16)).toBeGreaterThan(6);
    expect(
      northSeaMegafaunaStartleSpeed("baleen-whale", 20, 0.16),
    ).toBeGreaterThan(4);
    expect(northSeaMegafaunaStartleSpeed("seal", 20, 0.16)).toBeGreaterThan(9);
    expect(northSeaMegafaunaStartleSpeed("jellyfish", 20, 1)).toBe(0);
    expect(northSeaMegafaunaStartleSpeed("harbour-porpoise", 105, 1)).toBe(0);
  });
});
