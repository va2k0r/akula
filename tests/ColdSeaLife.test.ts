import { describe, expect, it } from "vitest";
import {
  COLD_SEA_FISH_COUNT,
  createBioluminescentPlanktonGeometry,
  createRealisticFishSpriteGeometry,
  demersalFishHeightAt,
  fishPropulsionStartleSpeed,
  fishSchoolCompressionAt,
  fishSpriteDetailAmountAtDistance,
} from "../src/game/ColdSeaLife";
import { terrainHeightAt } from "../src/game/WorldGeometry";

describe("cold-sea life geometry", () => {
  it("packs thousands of realistic fish sprites into one instanced mesh", () => {
    const geometry = createRealisticFishSpriteGeometry();
    const positions = geometry.getAttribute("position");
    const worldPositions = geometry.getAttribute("aWorldPosition");
    const headings = geometry.getAttribute("aHeading");
    const scales = geometry.getAttribute("aScale");
    const species = geometry.getAttribute("aSpecies");

    expect(COLD_SEA_FISH_COUNT).toBe(2_820);
    expect(geometry.instanceCount).toBe(COLD_SEA_FISH_COUNT);
    expect(positions.count).toBe(26);
    expect(geometry.index?.count).toBe(72);
    expect(worldPositions.count).toBe(COLD_SEA_FISH_COUNT);
    expect(headings.count).toBe(COLD_SEA_FISH_COUNT);
    expect(scales.count).toBe(COLD_SEA_FISH_COUNT);
    expect(species.count).toBe(COLD_SEA_FISH_COUNT);

    for (let index = 0; index < COLD_SEA_FISH_COUNT; index += 1) {
      expect(Number.isFinite(worldPositions.getX(index))).toBe(true);
      expect(Number.isFinite(worldPositions.getY(index))).toBe(true);
      expect(Number.isFinite(worldPositions.getZ(index))).toBe(true);
      expect(
        headings.getX(index) ** 2 + headings.getY(index) ** 2,
      ).toBeLessThanOrEqual(1.0001);
      expect(scales.getX(index)).toBeGreaterThanOrEqual(0.32);
      expect(scales.getX(index)).toBeLessThanOrEqual(0.88);
      expect(species.getX(index)).toBeGreaterThanOrEqual(0);
      expect(species.getX(index)).toBeLessThanOrEqual(3);
    }

    geometry.dispose();
  });

  it("removes photographic detail before normal chase-camera range", () => {
    expect(fishSpriteDetailAmountAtDistance(0)).toBe(1);
    expect(fishSpriteDetailAmountAtDistance(10)).toBe(1);
    expect(fishSpriteDetailAmountAtDistance(17)).toBeCloseTo(0.5, 5);
    expect(fishSpriteDetailAmountAtDistance(24)).toBe(0);
    expect(fishSpriteDetailAmountAtDistance(80)).toBe(0);
  });

  it("starts a nearby fish escape immediately when the shaft restarts", () => {
    expect(fishPropulsionStartleSpeed(8, 0.16)).toBeGreaterThan(10);
    expect(fishPropulsionStartleSpeed(8, 1)).toBeGreaterThan(
      fishPropulsionStartleSpeed(8, 0.16),
    );
    expect(fishPropulsionStartleSpeed(92, 1)).toBe(0);
  });

  it("clusters a bounded number of glow points around habitat colonies", () => {
    const geometry = createBioluminescentPlanktonGeometry();
    const positions = geometry.getAttribute("position");
    const seeds = geometry.getAttribute("aSeed");

    expect(positions.count).toBe(336);
    expect(seeds.count).toBe(positions.count);
    expect(geometry.boundingBox).not.toBeNull();
    expect(geometry.boundingSphere).not.toBeNull();
    expect(geometry.boundingSphere?.radius).toBeLessThan(1_800);

    for (let index = 0; index < positions.count; index += 1) {
      expect(Number.isFinite(positions.getX(index))).toBe(true);
      expect(Number.isFinite(positions.getY(index))).toBe(true);
      expect(Number.isFinite(positions.getZ(index))).toBe(true);
      expect(seeds.getX(index)).toBeGreaterThanOrEqual(0);
      expect(seeds.getX(index)).toBeLessThan(1);
    }

    geometry.dispose();
  });

  it("makes schools compress and breathe instead of remaining rigid grids", () => {
    const samples = Array.from({ length: 80 }, (_, index) =>
      fishSchoolCompressionAt(0, index * 5),
    );
    expect(Math.min(...samples)).toBeLessThan(0.35);
    expect(Math.max(...samples)).toBeGreaterThan(0.75);
    expect(fishSchoolCompressionAt(99, 20)).toBe(0);
  });

  it("keeps cod and other demersal fish immediately above the real floor", () => {
    for (const [x, z] of [
      [44, 1_030],
      [-1_200, 640],
      [1_850, -1_100],
    ] as const) {
      const clearance =
        demersalFishHeightAt(x, z, 8, 1.2) - terrainHeightAt(x, z);
      expect(clearance).toBeGreaterThan(4.5);
      expect(clearance).toBeLessThan(6);
    }
  });
});
