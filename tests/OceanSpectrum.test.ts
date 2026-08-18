import { describe, expect, it } from "vitest";
import {
  NORTH_ATLANTIC_SEA_STATE,
  NORTH_ATLANTIC_WAVES,
  createBimodalJonswapSea,
  sampleOceanSurface,
  significantWaveHeight,
  type OceanBand,
  type OceanWaveComponent,
} from "../src/game/OceanSpectrum";

describe("North Atlantic bimodal ocean spectrum", () => {
  it("builds independent directional JONSWAP wind-sea and swell bands", () => {
    expect(NORTH_ATLANTIC_WAVES).toHaveLength(72);
    expect(significantWaveHeight(NORTH_ATLANTIC_WAVES, "wind-sea")).toBeCloseTo(
      NORTH_ATLANTIC_SEA_STATE.windSea.significantHeight,
      8,
    );
    expect(significantWaveHeight(NORTH_ATLANTIC_WAVES, "swell")).toBeCloseTo(
      NORTH_ATLANTIC_SEA_STATE.swell.significantHeight,
      8,
    );
    expect(NORTH_ATLANTIC_SEA_STATE.windSea.directionRadians).not.toBe(
      NORTH_ATLANTIC_SEA_STATE.swell.directionRadians,
    );
    expect(NORTH_ATLANTIC_SEA_STATE.swell.peakPeriod).toBeGreaterThan(
      NORTH_ATLANTIC_SEA_STATE.windSea.peakPeriod * 1.4,
    );
  });

  it("uses unique stochastic modes instead of a repeated rolling lattice", () => {
    const windModes = NORTH_ATLANTIC_WAVES.filter(
      (component) => component.band === "wind-sea",
    );
    const uniqueFrequencies = new Set(
      windModes.map((component) => component.angularFrequency.toFixed(7)),
    );
    const uniqueDirections = new Set(
      windModes.map((component) =>
        Math.atan2(component.directionZ, component.directionX).toFixed(7),
      ),
    );

    expect(windModes).toHaveLength(60);
    expect(uniqueFrequencies.size).toBeGreaterThan(55);
    expect(uniqueDirections.size).toBeGreaterThan(55);
    expect(
      Math.max(...windModes.map((component) => component.amplitude)),
    ).toBeLessThan(0.4);
  });

  it("represents a high gale sea without a single extreme swell band", () => {
    const combinedHeight = significantWaveHeight(NORTH_ATLANTIC_WAVES);
    expect(combinedHeight).toBeGreaterThanOrEqual(6);
    expect(combinedHeight).toBeLessThan(9);
    expect(NORTH_ATLANTIC_SEA_STATE.windSea.significantHeight).toBeGreaterThan(
      NORTH_ATLANTIC_SEA_STATE.swell.significantHeight,
    );
    expect(NORTH_ATLANTIC_SEA_STATE.swell.significantHeight).toBeLessThan(4);
  });

  it("keeps the swell wavelength much longer than the local chop", () => {
    const swellLength = energyWeightedWavelength(NORTH_ATLANTIC_WAVES, "swell");
    const windLength = energyWeightedWavelength(
      NORTH_ATLANTIC_WAVES,
      "wind-sea",
    );
    expect(swellLength).toBeGreaterThan(windLength * 1.8);
  });

  it("is deterministic and produces several metres of slow surface travel", () => {
    expect(createBimodalJonswapSea()).toEqual(NORTH_ATLANTIC_WAVES);
    const heights: number[] = [];
    for (let time = 0; time <= 180; time += 0.5) {
      heights.push(
        sampleOceanSurface(NORTH_ATLANTIC_WAVES, 0, 820, time).height,
      );
    }
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(6.5);
  });
});

function energyWeightedWavelength(
  components: readonly OceanWaveComponent[],
  band: OceanBand,
): number {
  let weighted = 0;
  let energy = 0;
  for (const component of components) {
    if (component.band !== band) {
      continue;
    }
    const componentEnergy = component.amplitude * component.amplitude;
    weighted += (Math.PI * 2 * componentEnergy) / component.waveNumber;
    energy += componentEnergy;
  }
  return weighted / energy;
}
