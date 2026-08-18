import { describe, expect, it } from "vitest";
import {
  marineParticleDensity,
  northSeaEnvironmentAt,
  northSeaSurfaceFogDensity,
  northSeaUnderwaterVisibilityMeters,
} from "../src/game/NorthSeaEnvironment";

describe("North Sea environmental state", () => {
  it("moves local weather fronts across fixed geography", () => {
    const phases = new Set<string>();
    for (let time = 0; time <= 900; time += 30) {
      const state = northSeaEnvironmentAt(time, 620, -340);
      phases.add(state.phase);
      expect(state.surfaceVisibilityMeters).toBeGreaterThanOrEqual(620);
      expect(state.surfaceVisibilityMeters).toBeLessThanOrEqual(7_200);
      expect(state.rain).toBeGreaterThanOrEqual(0);
      expect(state.rain).toBeLessThanOrEqual(1);
    }
    expect(phases).toEqual(
      new Set(["cold-clearing", "salt-haze", "rain-band", "squall"]),
    );
  });

  it("adds distance depth without allowing storm haze to become a hard wall", () => {
    const clear = northSeaSurfaceFogDensity(7_200, 0);
    const rainy = northSeaSurfaceFogDensity(4_200, 0.7);
    const squall = northSeaSurfaceFogDensity(620, 1);

    expect(clear).toBeCloseTo(0.00052);
    expect(rainy).toBeGreaterThan(clear);
    expect(squall).toBeGreaterThan(rainy);
    expect(squall).toBe(0.00135);
  });

  it("lets the same front reach separated locations at different times", () => {
    const west = northSeaEnvironmentAt(210, -1_200, 0);
    const east = northSeaEnvironmentAt(210, 1_200, 0);
    expect(Math.abs(west.rain - east.rain)).toBeGreaterThan(0.2);
  });

  it("reduces visibility and raises particulates near disturbed bottom", () => {
    const weather = northSeaEnvironmentAt(120, 0, 0);
    const openWater = northSeaUnderwaterVisibilityMeters(120, weather, 100, 0);
    const wreckCloud = northSeaUnderwaterVisibilityMeters(120, weather, 4, 1);
    expect(wreckCloud).toBeLessThan(openWater * 0.7);
    expect(marineParticleDensity(weather, 4, 1)).toBeGreaterThan(
      marineParticleDensity(weather, 100, 0),
    );
  });
});
