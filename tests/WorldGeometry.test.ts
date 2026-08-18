import { describe, expect, it } from "vitest";
import {
  MAREANO_BATHYMETRY_METADATA,
  mareanoSourceDepthAt,
} from "../src/game/MareanoBathymetry";
import {
  ICE_KEELS,
  MAP_HALF_LENGTH,
  MAP_HALF_WIDTH,
  SEAFLOOR_POCKMARKS,
  channelWallAt,
  iceCeilingAt,
  pockmarkReliefAt,
  riftCenterAt,
  sedimentaryReliefAt,
  terrainHeightAt,
} from "../src/game/WorldGeometry";

describe("Frostbite MAREANO geometry", () => {
  it("provides an eight-kilometre square local maneuver area", () => {
    expect(MAP_HALF_WIDTH * 2).toBe(8_000);
    expect(MAP_HALF_LENGTH * 2).toBe(8_000);
    const [minimumX, minimumY, maximumX, maximumY] =
      MAREANO_BATHYMETRY_METADATA.sourceBboxMeters;
    expect(maximumX - minimumX).toBe(8_000);
    expect(maximumY - minimumY).toBe(8_000);
  });

  it("retains the selected survey identity and 25 m runtime grid", () => {
    expect(MAREANO_BATHYMETRY_METADATA.crs).toBe("EPSG:25833");
    expect(MAREANO_BATHYMETRY_METADATA.runtimeGridSide).toBe(321);
    expect(MAREANO_BATHYMETRY_METADATA.runtimeGridMeters).toBe(25);
    expect(MAREANO_BATHYMETRY_METADATA.sourceSha256).toBe(
      "e01a769c077a5629ae49b0a3d347a7236bf72d821ba830cf606f66e586e78f95",
    );
  });

  it("samples the unmodified multibeam depths at known patch landmarks", () => {
    expect(mareanoSourceDepthAt(500, 400)).toBeCloseTo(-374.3, 1);
    expect(mareanoSourceDepthAt(1_400, 3_425)).toBeCloseTo(-311.7, 1);
  });

  it("compresses the survey datum into a shallower playable depth range", () => {
    const deepLandmark = terrainHeightAt(500, 400);
    const shallowLandmark = terrainHeightAt(1_400, 3_425);
    expect(deepLandmark).toBeLessThan(-170);
    expect(shallowLandmark).toBeGreaterThan(-75);
    expect(deepLandmark).toBeLessThan(shallowLandmark - 95);
    expect(terrainHeightAt(-3_950, 600)).toBeGreaterThan(-48);
  });

  it("adds bounded sedimentary bedforms instead of a uniform plane", () => {
    const relief = Array.from({ length: 80 }, (_, index) =>
      sedimentaryReliefAt(index * 47 - 1_800, index * 83 - 3_200),
    );
    expect(Math.max(...relief) - Math.min(...relief)).toBeGreaterThan(5);
    expect(Math.max(...relief)).toBeLessThan(5);
    expect(Math.min(...relief)).toBeGreaterThan(-5);
  });

  it("extracts a meandering trough and real wall positions for set dressing", () => {
    expect(riftCenterAt(0)).toBeGreaterThan(600);
    expect(riftCenterAt(2_000)).toBeLessThan(-2_300);
    for (const z of [-1_000, 0, 1_000]) {
      const center = riftCenterAt(z);
      const westWall = channelWallAt(z, -1);
      const eastWall = channelWallAt(z, 1);
      expect(westWall).toBeLessThan(center - 180);
      expect(eastWall).toBeGreaterThan(center + 180);
      expect(Math.abs(westWall)).toBeLessThan(MAP_HALF_WIDTH);
      expect(Math.abs(eastWall)).toBeLessThan(MAP_HALF_WIDTH);
    }
  });

  it("keeps the central lead open to the animated sea surface", () => {
    for (const [x, z] of [
      [0, 900],
      [0, 300],
      [0, -300],
    ] as const) {
      expect(iceCeilingAt(x, z)).toBe(Number.POSITIVE_INFINITY);
    }
  });

  it("extends iceberg keels below the open-water ceiling", () => {
    for (const keel of ICE_KEELS) {
      expect(iceCeilingAt(keel.x, keel.z)).toBeLessThan(-keel.keelDepth + 1);
      expect(
        iceCeilingAt(keel.x, keel.z) - terrainHeightAt(keel.x, keel.z),
      ).toBeGreaterThan(24);
    }
  });

  it("uses authentic small pockmark dimensions and depresses their centers", () => {
    expect(SEAFLOOR_POCKMARKS.length).toBeGreaterThanOrEqual(30);
    for (const pockmark of SEAFLOOR_POCKMARKS) {
      expect(pockmark.radius * 2).toBeGreaterThanOrEqual(20);
      expect(pockmark.radius * 2).toBeLessThanOrEqual(32);
      expect(pockmark.depth).toBeGreaterThanOrEqual(2);
      expect(pockmark.depth).toBeLessThanOrEqual(4);
      expect(pockmarkReliefAt(pockmark.x, pockmark.z)).toBeLessThan(-1.7);
    }
  });
});
