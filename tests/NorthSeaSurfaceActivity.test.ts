import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NORTH_SEA_TRAFFIC_SPECS,
  northSeaTrafficPoseAt,
} from "../src/game/NorthSeaSurfaceActivity";

describe("North Sea surface activity", () => {
  it("ships one readable actor for every requested traffic role", () => {
    expect(new Set(NORTH_SEA_TRAFFIC_SPECS.map((spec) => spec.kind))).toEqual(
      new Set([
        "tanker",
        "bulk-carrier",
        "trawler",
        "supply-vessel",
        "military-patrol",
      ]),
    );
    expect(NORTH_SEA_TRAFFIC_SPECS).toHaveLength(5);
  });

  it("keeps sparse traffic on deterministic bounded routes", () => {
    for (const spec of NORTH_SEA_TRAFFIC_SPECS) {
      for (let time = 0; time <= 1_800; time += 90) {
        const pose = northSeaTrafficPoseAt(spec, time);
        expect(Number.isFinite(pose.heading)).toBe(true);
        expect(pose.speedMetersPerSecond).toBeGreaterThan(1.5);
        expect(Math.abs(pose.x)).toBeLessThanOrEqual(4_000);
        expect(Math.abs(pose.z)).toBeLessThanOrEqual(4_000);
      }
    }
  });

  it("ships a valid non-empty GLB for every licensed surface source", () => {
    const paths = [
      ...NORTH_SEA_TRAFFIC_SPECS.flatMap((spec) =>
        spec.modelPath === undefined ? [] : [spec.modelPath],
      ),
      "/assets/models/north-sea/oil-rig.glb",
    ];
    expect(new Set(paths).size).toBe(5);
    for (const path of paths) {
      const absolutePath = join(process.cwd(), "public", path);
      expect(readFileSync(absolutePath).subarray(0, 4).toString("ascii")).toBe(
        "glTF",
      );
      expect(statSync(absolutePath).size).toBeGreaterThan(20_000);
    }
  });
});
