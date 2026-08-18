import { describe, expect, it } from "vitest";
import { BufferGeometry, Float32BufferAttribute } from "three";
import {
  ascentBubbleIntensity,
  ballastBurstProfile,
  cavitationStrength,
  partitionAkulaTailGeometry,
  propellerAngularVelocity,
  propellerRpm,
} from "../src/game/AkulaVehicle";

describe("Akula source tail rig", () => {
  it("removes each complete articulated surface from the fixed hull", () => {
    const source = createTailRigFixture();
    const partition = partitionAkulaTailGeometry(source);

    expect(partition.fixedTriangleCount).toBe(24);
    expect(partition.rudderTriangleCount).toBe(24);
    expect(partition.sternPlaneTriangleCount).toBe(24);
    expect(
      partition.fixedTriangleCount +
        partition.rudderTriangleCount +
        partition.sternPlaneTriangleCount,
    ).toBe((source.getIndex()?.count ?? 0) / 3);

    partition.fixed.computeBoundingBox();
    partition.rudders.computeBoundingBox();
    partition.sternPlanes.computeBoundingBox();
    expect(partition.fixed.boundingBox?.max.x).toBe(31.5);
    expect(partition.rudders.boundingBox?.max.z).toBeLessThan(0.6);
    expect(partition.sternPlanes.boundingBox?.max.z).toBeGreaterThan(4);

    source.dispose();
    partition.fixed.dispose();
    partition.rudders.dispose();
    partition.sternPlanes.dispose();
  });
});

describe("Akula propeller shaft", () => {
  it("stops at neutral and follows the telegraph direction", () => {
    expect(propellerAngularVelocity(0)).toBe(0);
    expect(propellerAngularVelocity(0.52)).toBeGreaterThan(0);
    expect(propellerAngularVelocity(-0.22)).toBeLessThan(0);
  });

  it("gives every non-stop telegraph regime a distinct visual speed", () => {
    expect(propellerRpm(-0.22)).toBe(-74);
    expect(propellerRpm(0)).toBe(0);
    expect(propellerRpm(0.16)).toBe(42);
    expect(propellerRpm(0.52)).toBe(112);
    expect(propellerRpm(1)).toBe(220);
    expect(propellerAngularVelocity(3)).toBe(propellerAngularVelocity(1));
  });

  it("spools smoothly between cruise and flank for depth compensation", () => {
    expect(propellerRpm(0.64)).toBeGreaterThan(propellerRpm(0.52));
    expect(propellerRpm(0.64)).toBeLessThan(propellerRpm(1));
  });

  it("reserves cavitation for a spooled-up flank shaft", () => {
    expect(cavitationStrength(0.52, 112, 20)).toBe(0);
    expect(cavitationStrength(1, 140, 20)).toBe(0);
    expect(cavitationStrength(1, 220, 20)).toBeGreaterThan(0.9);
  });

  it("suppresses some vapour at depth without hiding flank cavitation", () => {
    const shallow = cavitationStrength(1, 220, 12);
    const patrolDepth = cavitationStrength(1, 220, 76);
    const deep = cavitationStrength(1, 220, 240);

    expect(shallow).toBe(1);
    expect(patrolDepth).toBeGreaterThan(0.8);
    expect(deep).toBeGreaterThan(0.5);
    expect(shallow).toBeGreaterThan(patrolDepth);
    expect(patrolDepth).toBeGreaterThan(deep);
  });
});

describe("Akula ascent bubbles", () => {
  it("starts only above the real ascent-speed threshold and uses hysteresis", () => {
    expect(ascentBubbleIntensity(2, false)).toBe(0);
    expect(ascentBubbleIntensity(-0.9, false)).toBe(0);

    const started = ascentBubbleIntensity(-1.1, false);
    expect(started).toBeGreaterThan(0);
    expect(ascentBubbleIntensity(-0.9, true)).toBeGreaterThan(0);
    expect(ascentBubbleIntensity(-0.7, true)).toBe(0);
    expect(ascentBubbleIntensity(-3.2, false)).toBe(1);
  });

  it("keeps enough particles for the full-speed ascent plume", () => {
    const standard = ballastBurstProfile("standard");
    const mainBlow = ballastBurstProfile("main-blow");

    expect(mainBlow.particleCount).toBeGreaterThanOrEqual(
      standard.particleCount * 7,
    );
    expect(mainBlow.hullSpanMeters).toBeGreaterThan(
      standard.hullSpanMeters * 2,
    );
    expect(mainBlow.emissionDurationSeconds).toBeGreaterThan(
      standard.emissionDurationSeconds,
    );
  });
});

function createTailRigFixture(): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  addBox(positions, indices, [-21, -4, -3], [31.5, 2, 3]);
  addBox(positions, indices, [-19.431, 2.131, -0.688], [-15.057, 3.471, 0.653]);
  addBox(positions, indices, [-17.875, -0.707, -0.221], [-14.65, 2.359, 0.162]);
  addBox(
    positions,
    indices,
    [-17.913, -4.808, -0.221],
    [-14.688, -1.743, 0.162],
  );
  addBox(
    positions,
    indices,
    [-17.718, -1.401, 0.527],
    [-14.493, -1.018, 4.489],
  );
  addBox(
    positions,
    indices,
    [-17.718, -1.401, -4.481],
    [-14.493, -1.018, -0.519],
  );
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

function addBox(
  positions: number[],
  indices: number[],
  [minX, minY, minZ]: readonly [number, number, number],
  [maxX, maxY, maxZ]: readonly [number, number, number],
): void {
  const first = positions.length / 3;
  positions.push(
    minX,
    minY,
    minZ,
    maxX,
    minY,
    minZ,
    maxX,
    maxY,
    minZ,
    minX,
    maxY,
    minZ,
    minX,
    minY,
    maxZ,
    maxX,
    minY,
    maxZ,
    maxX,
    maxY,
    maxZ,
    minX,
    maxY,
    maxZ,
  );
  const faces = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0,
    4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5,
  ];
  indices.push(...faces.map((index) => first + index));
}
