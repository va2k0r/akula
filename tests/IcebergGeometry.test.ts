import { Matrix4, SphereGeometry } from "three";
import { describe, expect, it } from "vitest";
import { createIcebergGeometry } from "../src/game/IcebergGeometry";
import type { IceKeel } from "../src/game/WorldGeometry";

const TEST_KEEL: IceKeel = {
  x: 0,
  z: 0,
  radiusX: 220,
  radiusZ: 145,
  keelDepth: 82,
  crownHeight: 27,
  rotation: 0,
};

describe("solid iceberg deformation", () => {
  it("preserves topology and creates a much deeper submerged volume", () => {
    const source = new SphereGeometry(1, 28, 18);
    const sourceIndexCount = source.index?.count;
    const iceberg = createIcebergGeometry(source, new Matrix4(), TEST_KEEL, 0);

    expect(iceberg.index?.count).toBe(sourceIndexCount);
    expect(iceberg.getAttribute("color").count).toBe(
      iceberg.getAttribute("position").count,
    );
    expect(iceberg.boundingBox).not.toBeNull();
    expect(iceberg.boundingBox?.min.y).toBeLessThan(
      -TEST_KEEL.keelDepth * 0.94,
    );
    expect(iceberg.boundingBox?.max.y).toBeCloseTo(TEST_KEEL.crownHeight, 4);

    source.computeBoundingBox();
    expect(source.boundingBox?.min.y).toBeCloseTo(-1, 4);
    expect(source.boundingBox?.max.y).toBeCloseTo(1, 4);

    source.dispose();
    iceberg.dispose();
  });

  it("keeps every variant finite and visibly distinct", () => {
    const source = new SphereGeometry(1, 24, 16);
    const tipCenters: Array<[number, number]> = [];

    for (let variant = 0; variant < 4; variant += 1) {
      const iceberg = createIcebergGeometry(
        source,
        new Matrix4(),
        TEST_KEEL,
        variant,
      );
      const positions = iceberg.getAttribute("position");
      let deepestIndex = 0;
      for (let index = 0; index < positions.count; index += 1) {
        expect(Number.isFinite(positions.getX(index))).toBe(true);
        expect(Number.isFinite(positions.getY(index))).toBe(true);
        expect(Number.isFinite(positions.getZ(index))).toBe(true);
        if (positions.getY(index) < positions.getY(deepestIndex)) {
          deepestIndex = index;
        }
      }
      tipCenters.push([
        positions.getX(deepestIndex),
        positions.getZ(deepestIndex),
      ]);
      iceberg.dispose();
    }

    expect(
      new Set(tipCenters.map(([x, z]) => `${x.toFixed(2)}:${z.toFixed(2)}`))
        .size,
    ).toBe(4);
    source.dispose();
  });
});
