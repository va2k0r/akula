import { describe, expect, it } from "vitest";
import { OceanSurface, stormRainIntensity } from "../src/game/OceanSurface";

describe("WaterFX surface visibility", () => {
  it("keeps the water surface hidden while WaterFX is disabled", () => {
    const ocean = new OceanSurface();

    try {
      expect(ocean.mesh.visible).toBe(true);
      expect(ocean.rain.visible).toBe(true);

      ocean.setWaterEffectsEnabled(false);
      expect(ocean.mesh.visible).toBe(false);
      expect(ocean.rain.visible).toBe(false);

      ocean.setTacticalView(0);
      expect(ocean.mesh.visible).toBe(false);

      ocean.setWaterEffectsEnabled(true);
      expect(ocean.mesh.visible).toBe(true);
      expect(ocean.rain.visible).toBe(true);

      ocean.setTacticalView(0.9);
      expect(ocean.mesh.visible).toBe(false);

      ocean.setWaterEffectsEnabled(false);
      ocean.setWaterEffectsEnabled(true);
      expect(ocean.mesh.visible).toBe(false);

      ocean.setTacticalView(0);
      expect(ocean.mesh.visible).toBe(true);
    } finally {
      ocean.dispose();
    }
  });

  it("concentrates geometry around the camera-facing grid centre", () => {
    const ocean = new OceanSurface();

    try {
      const positions = ocean.mesh.geometry.getAttribute("position");
      expect(positions).toBeDefined();
      if (positions === undefined) {
        throw new Error("Ocean surface geometry has no position attribute.");
      }
      const rowWidth = Math.round(Math.sqrt(positions.count));
      const centreRow = Math.floor(rowWidth / 2);
      const centre = centreRow * rowWidth + centreRow;
      const nearSpacing = Math.abs(
        positions.getX(centre + 1) - positions.getX(centre),
      );
      const edge = centreRow * rowWidth + rowWidth - 2;
      const farSpacing = Math.abs(
        positions.getX(edge + 1) - positions.getX(edge),
      );

      expect(nearSpacing).toBeLessThan(1);
      expect(farSpacing).toBeGreaterThan(nearSpacing * 20);
    } finally {
      ocean.dispose();
    }
  });
});

describe("North Sea driving rain", () => {
  it("keeps a visible storm baseline while preserving stronger rain bands", () => {
    const baseline = stormRainIntensity(0, 0.46, 0);
    expect(baseline).toBeGreaterThan(0.68);
    expect(baseline).toBeLessThan(0.7);
    expect(stormRainIntensity(0.91, 0.46, 0)).toBe(0.91);
    expect(stormRainIntensity(1.4, 1.2, 1.1)).toBe(1);
  });
});
