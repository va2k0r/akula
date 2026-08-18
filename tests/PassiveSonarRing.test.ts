import { Group, Line, LineSegments, Sprite } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  absoluteBearingFromRelative,
  forwardRingSectorSensitivity,
  PassiveSonarRing,
  PASSIVE_SONAR_FORWARD_HALF_ANGLE_RADIANS,
  PASSIVE_SONAR_FORWARD_SECTOR_COUNT,
  PASSIVE_SONAR_SECTOR_WIDTH_RADIANS,
  PASSIVE_SONAR_VISIBLE_SIGNAL_THRESHOLD,
  directionalWaveDisplacement,
  passiveArraySensitivity,
  speedAmplitudeScale,
} from "../src/game/PassiveSonarRing";

describe("passive sonar coverage ring", () => {
  it("keeps frontal and lateral bearings inside the passive array", () => {
    expect(passiveArraySensitivity(0)).toBe(1);
    expect(passiveArraySensitivity(Math.PI / 2)).toBe(1);
    expect(passiveArraySensitivity(-Math.PI / 2)).toBe(1);
  });

  it("leaves a blind quarter around the machinery space", () => {
    expect(passiveArraySensitivity(Math.PI)).toBe(0);
    expect(passiveArraySensitivity(-Math.PI)).toBe(0);
    expect(passiveArraySensitivity((140 * Math.PI) / 180)).toBe(0);
  });

  it("allows deformation only in the three 30-degree bow sectors", () => {
    const degrees = Math.PI / 180;
    expect(PASSIVE_SONAR_FORWARD_SECTOR_COUNT).toBe(3);
    expect(PASSIVE_SONAR_SECTOR_WIDTH_RADIANS / degrees).toBeCloseTo(30);
    expect(PASSIVE_SONAR_FORWARD_HALF_ANGLE_RADIANS / degrees).toBeCloseTo(45);
    expect(forwardRingSectorSensitivity(44.9 * degrees)).toBe(1);
    expect(forwardRingSectorSensitivity(-44.9 * degrees)).toBe(1);
    expect(forwardRingSectorSensitivity(45.1 * degrees)).toBe(0);
    expect(forwardRingSectorSensitivity(-45.1 * degrees)).toBe(0);
    expect(
      directionalWaveDisplacement(
        60 * degrees,
        60 * degrees,
        60 * degrees,
        1,
        0,
        0.37,
        12,
      ),
    ).toBe(0);
  });

  it("uses signal strength to grow the fused directional trace", () => {
    const sampleBearing = 0.08;
    const weak = Math.abs(
      directionalWaveDisplacement(sampleBearing, 0, 0, 0.8, 0, 0.37, 12),
    );
    const strong = Math.abs(
      directionalWaveDisplacement(sampleBearing, 0, 0, 0.95, 0, 0.37, 12),
    );
    expect(strong).toBeGreaterThan(weak * 2);
  });

  it("leaves a pre-contact window below the visible ring threshold", () => {
    expect(
      directionalWaveDisplacement(
        0.08,
        0,
        0,
        PASSIVE_SONAR_VISIBLE_SIGNAL_THRESHOLD - 0.01,
        0,
        0.37,
        12,
      ),
    ).toBe(0);
  });

  it("does not draw a false wave for a source in the stern blind spot", () => {
    expect(directionalWaveDisplacement(0, 0, Math.PI, 1, 0, 0.7, 0)).toBe(0);
  });

  it("attenuates trace amplitude inversely with own-ship speed", () => {
    expect(speedAmplitudeScale(0)).toBe(1);
    expect(speedAmplitudeScale(6)).toBeCloseTo(0.5);
    expect(speedAmplitudeScale(15.8)).toBeLessThan(0.3);
    expect(speedAmplitudeScale(-15.8)).toBe(speedAmplitudeScale(15.8));
  });

  it("converts relative contacts to absolute world bearings", () => {
    const degrees = Math.PI / 180;
    expect(
      absoluteBearingFromRelative(20 * degrees, 350 * degrees),
    ).toBeCloseTo(10 * degrees);
  });

  it("remains visible in chase and in the tactical chart", () => {
    stubCanvasDocument();

    const parent = new Group();
    const ring = new PassiveSonarRing(parent);
    ring.setViewAmount(0);
    const root = parent.getObjectByName("PassiveSonarCoverageRing");

    expect(root?.visible).toBe(true);
    ring.setViewAmount(1);
    expect(root?.visible).toBe(true);
    ring.dispose();
  });

  it("lets the overlay hull depth-mask every visible ring layer", () => {
    stubCanvasDocument();

    const parent = new Group();
    const ring = new PassiveSonarRing(parent);
    const wave = parent.getObjectByName("PassiveSonarDirectionalWave");
    const blindSpot = parent.getObjectByName("PassiveSonarBlindSpotEdges");
    const majorTicks = parent.getObjectByName("PassiveSonarMajorBearings");
    const minorTicks = parent.getObjectByName("PassiveSonarMinorBearings");
    const label = parent.getObjectByName("PassiveSonarBearing090");

    expect(wave).toBeInstanceOf(Line);
    expect(blindSpot).toBeInstanceOf(LineSegments);
    expect(majorTicks).toBeInstanceOf(LineSegments);
    expect(minorTicks).toBeInstanceOf(LineSegments);
    expect(label).toBeInstanceOf(Sprite);
    if (wave instanceof Line) {
      expect(wave.material.depthTest).toBe(true);
    }
    if (blindSpot instanceof LineSegments) {
      expect(blindSpot.material.depthTest).toBe(true);
    }
    if (majorTicks instanceof LineSegments) {
      expect(majorTicks.material.depthTest).toBe(true);
    }
    if (minorTicks instanceof LineSegments) {
      expect(minorTicks.material.depthTest).toBe(true);
    }
    if (label instanceof Sprite) {
      expect(label.material.depthTest).toBe(true);
    }
    ring.dispose();
  });

  it("moves the directional ripple perpendicular to the ring plane", () => {
    stubCanvasDocument();

    const parent = new Group();
    const ring = new PassiveSonarRing(parent);
    ring.setViewAmount(0);
    ring.updateSignal(0, 0, 1, 0, true, 0.1, 1);
    const arc = parent.getObjectByName("PassiveSonarDirectionalWave");
    expect(arc).toBeInstanceOf(Line);
    if (arc instanceof Line) {
      const position = arc.geometry.getAttribute("position");
      const displacedIndex = Array.from(
        { length: position.count },
        (_, index) => index,
      ).reduce((largestIndex, index) =>
        Math.abs(position.getY(index)) > Math.abs(position.getY(largestIndex))
          ? index
          : largestIndex,
      );
      const displacedRadius = Math.hypot(
        position.getX(displacedIndex),
        position.getZ(displacedIndex),
      );
      const sideRadius = Math.hypot(position.getX(0), position.getZ(0));
      expect(Math.abs(position.getY(displacedIndex))).toBeGreaterThan(0.1);
      expect(displacedRadius).toBeCloseTo(sideRadius, 5);
    }
    ring.dispose();
  });

  it("leaves the aft quarter open and folds both edges toward the machinery space", () => {
    stubCanvasDocument();

    const parent = new Group();
    const ring = new PassiveSonarRing(parent);
    ring.setViewAmount(0);
    ring.updateSignal(0, 0, 1, 0, true, 0.8, 1);
    const arc = parent.getObjectByName("PassiveSonarDirectionalWave");
    const blindSpot = parent.getObjectByName("PassiveSonarBlindSpotEdges");
    expect(arc).toBeInstanceOf(Line);
    expect(blindSpot).toBeInstanceOf(LineSegments);
    if (arc instanceof Line) {
      const position = arc.geometry.getAttribute("position");
      const last = position.count - 1;
      expect(position.getX(0)).toBeLessThan(0);
      expect(position.getX(last)).toBeGreaterThan(0);
      expect(position.getZ(0)).toBeGreaterThan(0);
      expect(position.getZ(last)).toBeGreaterThan(0);
    }
    if (blindSpot instanceof LineSegments) {
      const position = blindSpot.geometry.getAttribute("position");
      expect(position.count).toBe(4);
      expect(Math.hypot(position.getX(1), position.getZ(1))).toBeLessThan(50);
      expect(Math.hypot(position.getX(3), position.getZ(3))).toBeLessThan(50);
    }
    ring.dispose();
  });

  it("keeps the missing quarter attached to the submarine heading", () => {
    stubCanvasDocument();

    const parent = new Group();
    const ring = new PassiveSonarRing(parent);
    ring.updateSignal(Math.PI / 2, 0, 1, 0, true, 0.8, 1);
    const arc = parent.getObjectByName("PassiveSonarDirectionalWave");

    expect(arc).toBeInstanceOf(Line);
    if (arc instanceof Line) {
      const position = arc.geometry.getAttribute("position");
      const last = position.count - 1;
      expect(position.getX(0)).toBeLessThan(0);
      expect(position.getX(last)).toBeLessThan(0);
      expect(position.getZ(0)).toBeLessThan(0);
      expect(position.getZ(last)).toBeGreaterThan(0);
    }
    ring.dispose();
  });

  it("shortens the lines that cross the reference circle", () => {
    stubCanvasDocument();

    const parent = new Group();
    const ring = new PassiveSonarRing(parent);
    const ticks = parent.getObjectByName("PassiveSonarMajorBearings");
    expect(ticks).toBeInstanceOf(LineSegments);
    if (ticks instanceof LineSegments) {
      const position = ticks.geometry.getAttribute("position");
      const firstTickLength = Math.hypot(
        position.getX(1) - position.getX(0),
        position.getY(1) - position.getY(0),
        position.getZ(1) - position.getZ(0),
      );
      expect(firstTickLength).toBeLessThan(3);
    }
    ring.dispose();
  });

  it("anchors a nautical gyro scale to the absolute world axes", () => {
    stubCanvasDocument();

    const parent = new Group();
    const ring = new PassiveSonarRing(parent);
    const root = parent.getObjectByName("PassiveSonarCoverageRing");
    const nine = parent.getObjectByName("PassiveSonarBearing090");
    const eighteen = parent.getObjectByName("PassiveSonarBearing180");

    expect(root?.rotation.y).toBe(0);
    expect(nine?.position.x).toBeGreaterThan(0);
    expect(eighteen?.position.z).toBeGreaterThan(0);
    expect(parent.getObjectByName("PassiveSonarMinorBearings")).toBeInstanceOf(
      LineSegments,
    );
    ring.dispose();
  });

  it("uses complete three-digit bearings with no zero, arrow, or cardinal labels", () => {
    const { fillText } = stubCanvasDocument();

    const parent = new Group();
    const ring = new PassiveSonarRing(parent);
    const nine = parent.getObjectByName("PassiveSonarBearing090");
    const labels = fillText.mock.calls.map(([text]) => text);

    expect(labels).toEqual([
      "030°",
      "060°",
      "090°",
      "120°",
      "150°",
      "180°",
      "210°",
      "240°",
      "270°",
      "300°",
      "330°",
    ]);
    expect(parent.getObjectByName("PassiveSonarBearing000")).toBeUndefined();
    expect(
      parent.getObjectByName("PassiveSonarTrueNorthArrow"),
    ).toBeUndefined();
    expect(nine?.scale.x).toBeLessThanOrEqual(8);
    expect(nine?.scale.y).toBeLessThanOrEqual(3.5);
    ring.dispose();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubCanvasDocument(): { readonly fillText: ReturnType<typeof vi.fn> } {
  const fillText = vi.fn();
  const context = {
    clearRect: vi.fn(),
    fillText,
    fillStyle: "",
    font: "",
    textAlign: "center",
    textBaseline: "middle",
  } as unknown as CanvasRenderingContext2D;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  vi.stubGlobal("document", { createElement: () => canvas });
  return { fillText };
}
