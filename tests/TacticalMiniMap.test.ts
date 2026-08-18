import { describe, expect, it } from "vitest";
import {
  miniMapEnemyMarker,
  miniMapRayToBoundary,
  miniMapWorldToUnit,
} from "../src/game/TacticalMiniMap";
import { MAP_HALF_LENGTH, MAP_HALF_WIDTH } from "../src/game/WorldGeometry";

describe("tactical minimap projection", () => {
  it("maps the north-west and south-east chart corners", () => {
    expect(miniMapWorldToUnit(-MAP_HALF_WIDTH, -MAP_HALF_LENGTH)).toEqual({
      x: 0,
      y: 0,
    });
    expect(miniMapWorldToUnit(MAP_HALF_WIDTH, MAP_HALF_LENGTH)).toEqual({
      x: 1,
      y: 1,
    });
  });

  it("keeps north at the top of the local plot", () => {
    const north = miniMapWorldToUnit(0, -500);
    const south = miniMapWorldToUnit(0, 500);
    expect(north.y).toBeLessThan(south.y);
  });

  it("clips an unresolved sonar bearing to the chart boundary", () => {
    expect(miniMapRayToBoundary(0, 0, 0)).toEqual({
      x: 0,
      z: -MAP_HALF_LENGTH,
    });
    const east = miniMapRayToBoundary(0, 0, Math.PI / 2);
    expect(east.x).toBeCloseTo(MAP_HALF_WIDTH);
    expect(east.z).toBeCloseTo(0);
  });

  it("keeps exact enemy truth inside the local chart", () => {
    expect(miniMapEnemyMarker({ x: 0, z: 0 }, { x: 240, z: -480 })).toEqual({
      position: { x: 240, z: -480 },
      bearingRad: Math.atan2(240, 480),
      offChart: false,
    });
  });

  it("keeps an off-chart enemy visible on the chart edge", () => {
    const marker = miniMapEnemyMarker(
      { x: 0, z: 0 },
      { x: 20_000, z: -20_000 },
    );

    expect(marker.offChart).toBe(true);
    expect(marker.bearingRad).toBeCloseTo(Math.PI / 4);
    expect(marker.position.x).toBeCloseTo(MAP_HALF_LENGTH);
    expect(marker.position.z).toBeCloseTo(-MAP_HALF_LENGTH);
  });
});
