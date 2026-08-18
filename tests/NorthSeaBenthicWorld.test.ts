import { describe, expect, it } from "vitest";
import {
  NORTH_SEA_KELP_PLACEMENTS,
  NORTH_SEA_WRECKS,
  northSeaWreckSuspensionAt,
} from "../src/game/NorthSeaBenthicWorld";
import { terrainHeightAt } from "../src/game/WorldGeometry";

describe("North Sea benthic geography", () => {
  it("keeps kelp on the relatively shallow coastal shelf only", () => {
    expect(NORTH_SEA_KELP_PLACEMENTS.length).toBeGreaterThan(40);
    for (const placement of NORTH_SEA_KELP_PLACEMENTS) {
      expect(placement.x).toBeLessThan(-2_900);
      expect(placement.y).toBeGreaterThanOrEqual(-192);
      expect(placement.y).toBeCloseTo(
        terrainHeightAt(placement.x, placement.z) + 0.2,
      );
    }
  });

  it("ships several distinct colonized wreck locations", () => {
    expect(NORTH_SEA_WRECKS.map((wreck) => wreck.kind)).toEqual([
      "freighter",
      "trawler",
      "patrol-craft",
    ]);
    for (const wreck of NORTH_SEA_WRECKS) {
      expect(
        northSeaWreckSuspensionAt(
          wreck.x,
          terrainHeightAt(wreck.x, wreck.z) + 3,
          wreck.z,
        ),
      ).toBeGreaterThan(0.8);
    }
  });

  it("does not smear wreck sediment across open water", () => {
    expect(northSeaWreckSuspensionAt(3_900, -30, 3_900)).toBe(0);
  });
});
