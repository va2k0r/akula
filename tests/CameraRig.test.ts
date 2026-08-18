import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import {
  CameraRig,
  MAX_TACTICAL_DISTANCE,
  MIN_TACTICAL_DISTANCE,
  tacticalDistanceForZoom,
  tacticalSpanForDistance,
  tacticalZoomForSpan,
} from "../src/game/CameraRig";
import { SubmarineDynamics } from "../src/game/SubmarineDynamics";

describe("tactical camera zoom", () => {
  it("uses the full configured distance range", () => {
    expect(tacticalDistanceForZoom(0)).toBe(MIN_TACTICAL_DISTANCE);
    expect(tacticalDistanceForZoom(1)).toBe(MAX_TACTICAL_DISTANCE);
  });

  it("is logarithmic and clamps out-of-range input", () => {
    const midpoint = tacticalDistanceForZoom(0.5);
    expect(midpoint).toBeCloseTo(
      Math.sqrt(MIN_TACTICAL_DISTANCE * MAX_TACTICAL_DISTANCE),
    );
    expect(tacticalDistanceForZoom(-1)).toBe(MIN_TACTICAL_DISTANCE);
    expect(tacticalDistanceForZoom(2)).toBe(MAX_TACTICAL_DISTANCE);
  });

  it("pulls back far enough to frame a hundred-kilometre battlespace", () => {
    expect(MAX_TACTICAL_DISTANCE).toBeGreaterThan(100_000);
    expect(tacticalSpanForDistance(MAX_TACTICAL_DISTANCE)).toBeGreaterThan(
      100_000,
    );
  });

  it("inverts tactical span into the matching logarithmic zoom", () => {
    const requestedSpan = 24_000;
    const zoom = tacticalZoomForSpan(requestedSpan);
    expect(tacticalSpanForDistance(tacticalDistanceForZoom(zoom))).toBeCloseTo(
      requestedSpan,
      6,
    );
  });

  it("can enter directly at a requested TMA framing span", () => {
    const rig = new CameraRig(new PerspectiveCamera());
    const state = new SubmarineDynamics().state;
    rig.frameTacticalSpan(24_000);
    let view = rig.update(state, 0, 0, false, false, 0, 1 / 60);
    for (let frame = 1; frame <= 90; frame += 1) {
      view = rig.update(state, 0, 0, false, false, frame / 60, 1 / 60);
    }

    expect(view.mode).toBe("tactical");
    expect(view.tacticalSpanMeters).toBeCloseTo(24_000, -1);
  });

  it("keeps ownship as the fixed tactical camera anchor", () => {
    const camera = new PerspectiveCamera();
    const rig = new CameraRig(camera);
    const state = new SubmarineDynamics({ x: 760, z: -540 }).state;
    rig.frameTacticalOverview();

    for (let frame = 0; frame <= 240; frame += 1) {
      rig.update(state, 0, 0, false, false, frame / 60, 1 / 60);
    }

    expect(camera.position.x).toBeCloseTo(state.x, 4);
    expect(camera.position.z).toBeCloseTo(state.z, 4);
  });

  it("enters the chart by holding the right stick forward", () => {
    const rig = new CameraRig(new PerspectiveCamera());
    const state = new SubmarineDynamics().state;
    let view = rig.update(state, 0, 0, false, false, 0, 1 / 60);

    for (let frame = 1; frame <= 90; frame += 1) {
      view = rig.update(state, 0, -1, false, false, frame / 60, 1 / 60);
    }

    expect(view.mode).toBe("tactical");
    expect(view.tacticalAmount).toBeGreaterThan(0.95);
    expect(view.tacticalDistance).toBeGreaterThan(MIN_TACTICAL_DISTANCE * 2);
  });

  it("settles briefly above ownship before a stick-driven map entry", () => {
    const camera = new PerspectiveCamera();
    const rig = new CameraRig(camera);
    const state = new SubmarineDynamics().state;
    const direction = new Vector3();
    rig.update(state, 0, 0, false, false, 0, 1 / 60);
    let firstZenithFrame: number | undefined;
    let tacticalFrame: number | undefined;

    for (let frame = 1; frame <= 90; frame += 1) {
      const view = rig.update(state, 0, -1, false, false, frame / 60, 1 / 60);
      const horizontalOffset = Math.hypot(
        camera.position.x - state.x,
        camera.position.z - state.z,
      );
      camera.getWorldDirection(direction);
      if (
        view.mode === "chase" &&
        horizontalOffset < 10 &&
        direction.y < -0.99
      ) {
        firstZenithFrame ??= frame;
      }
      if (view.mode === "tactical") {
        tacticalFrame = frame;
        break;
      }
    }

    expect(firstZenithFrame).toBeDefined();
    expect(tacticalFrame).toBeDefined();
    expect(tacticalFrame).toBeLessThanOrEqual(60);
    expect(
      (tacticalFrame ?? 0) - (firstZenithFrame ?? 0),
    ).toBeGreaterThanOrEqual(3);
    expect((tacticalFrame ?? 0) - (firstZenithFrame ?? 0)).toBeLessThanOrEqual(
      10,
    );
  });

  it("keeps the chase camera free to inspect below ownship", () => {
    const camera = new PerspectiveCamera();
    const rig = new CameraRig(camera);
    const state = new SubmarineDynamics().state;
    let view = rig.update(state, 0, 0, false, false, 0, 1 / 60);

    for (let frame = 1; frame <= 60; frame += 1) {
      view = rig.update(state, 0, 1, false, false, frame / 60, 1 / 60);
    }

    expect(view.mode).toBe("chase");
    expect(camera.position.y).toBeLessThan(state.y - 5);
  });

  it("reveals the opaque TMA in the first stick-driven pullback frame", () => {
    const rig = new CameraRig(new PerspectiveCamera());
    const state = new SubmarineDynamics().state;
    let view = rig.update(state, 0, 0, false, false, 0, 1 / 60);

    for (let frame = 1; frame <= 60 && view.mode === "chase"; frame += 1) {
      view = rig.update(state, 0, -1, false, false, frame / 60, 1 / 60);
    }

    expect(view.mode).toBe("tactical");
    expect(view.tacticalAmount).toBeLessThan(0.5);
    expect(view.operationalAmount).toBe(1);
  });

  it("responds to an R3 click in the same rendered frame", () => {
    const camera = new PerspectiveCamera();
    const rig = new CameraRig(camera);
    const state = new SubmarineDynamics().state;
    rig.update(state, 0, 0, false, false, 0, 1 / 60);
    const chaseHeight = camera.position.y;

    const view = rig.update(state, 0, 0, false, true, 1 / 60, 1 / 60);

    expect(view.mode).toBe("tactical");
    expect(view.tacticalAmount).toBe(1);
    expect(view.tacticalZoom).toBe(1);
    expect(view.tacticalDistance).toBe(MAX_TACTICAL_DISTANCE);
    expect(view.operationalAmount).toBe(1);
    expect(camera.position.y).toBeGreaterThan(chaseHeight + 100_000);
    expect(view.tacticalSpanMeters).toBeCloseTo(
      tacticalSpanForDistance(view.cameraRangeToOwnship),
    );
  });

  it("reaches the hundred-kilometre frame in the R3 frame", () => {
    const rig = new CameraRig(new PerspectiveCamera());
    const state = new SubmarineDynamics().state;
    rig.update(state, 0, 0, false, false, 0, 1 / 60);
    const view = rig.update(state, 0, 0, false, true, 1 / 60, 1 / 60);

    expect(view.tacticalSpanMeters).toBeGreaterThan(95_000);
  });

  it("snaps an R3 TMA entry to its recommended span", () => {
    const rig = new CameraRig(new PerspectiveCamera());
    const state = new SubmarineDynamics().state;
    rig.update(state, 0, 0, false, false, 0, 1 / 60);
    rig.frameTacticalSpan(24_000, true);

    const view = rig.update(state, 0, 0, false, false, 1 / 60, 1 / 60);

    expect(view.mode).toBe("tactical");
    expect(view.tacticalAmount).toBe(1);
    expect(view.tacticalSpanMeters).toBeCloseTo(24_000, -1);
    expect(view.operationalAmount).toBe(1);
  });

  it("keeps the TMA fully opaque at medium tactical zoom", () => {
    const rig = new CameraRig(new PerspectiveCamera());
    const state = new SubmarineDynamics().state;
    rig.update(state, 0, 0, false, false, 0, 1 / 60);
    rig.update(state, 0, 0, false, true, 1 / 60, 1 / 60);
    let view = rig.update(state, 0, 1, false, false, 2 / 60, 1 / 60);

    for (let frame = 3; frame <= 22; frame += 1) {
      view = rig.update(state, 0, 1, false, false, frame / 60, 1 / 60);
    }

    expect(view.tacticalZoom).toBeGreaterThan(0.45);
    expect(view.tacticalZoom).toBeLessThan(0.55);
    expect(view.tacticalAmount).toBe(1);
    expect(view.operationalAmount).toBe(1);
  });

  it("carries the chase azimuth into the strategic map", () => {
    const rig = new CameraRig(new PerspectiveCamera());
    const state = new SubmarineDynamics({ heading: 0.4 }).state;
    rig.update(state, 0, 0, false, false, 0, 1 / 60);
    for (let frame = 1; frame <= 24; frame += 1) {
      rig.update(state, 1, 0, false, false, frame / 60, 1 / 60);
    }

    const view = rig.update(state, 0, 0, false, true, 25 / 60, 1 / 60);
    const expectedWorldAzimuth = 0.4 + (24 / 60) * 1.35;

    expect(angleDistance(view.tacticalYaw, expectedWorldAzimuth)).toBeLessThan(
      1e-6,
    );
  });

  it("restores the exact chase orientation after an R3 round trip", () => {
    const camera = new PerspectiveCamera();
    const rig = new CameraRig(camera);
    const state = new SubmarineDynamics({ heading: 0.63 }).state;
    rig.update(state, 0, 0, false, false, 0, 1 / 60);
    for (let frame = 1; frame <= 30; frame += 1) {
      rig.update(state, 0.7, 0.35, false, false, frame / 60, 1 / 60);
    }
    for (let frame = 31; frame <= 90; frame += 1) {
      rig.update(state, 0, 0, false, false, frame / 60, 1 / 60);
    }
    const chasePosition = camera.position.clone();
    const chaseQuaternion = camera.quaternion.clone();

    rig.update(state, 0, 0, false, true, 91 / 60, 1 / 60);
    for (let frame = 92; frame <= 150; frame += 1) {
      rig.update(state, 0, 0, false, false, frame / 60, 1 / 60);
    }
    rig.update(state, 0, 0, false, true, 151 / 60, 1 / 60);
    for (let frame = 152; frame <= 240; frame += 1) {
      rig.update(state, 0, 0, false, false, frame / 60, 1 / 60);
    }

    expect(camera.position.distanceTo(chasePosition)).toBeLessThan(0.01);
    expect(1 - Math.abs(camera.quaternion.dot(chaseQuaternion))).toBeLessThan(
      1e-6,
    );
  });

  it("carries a strategic-map rotation back into the next chase and map", () => {
    const rig = new CameraRig(new PerspectiveCamera());
    const state = new SubmarineDynamics({ heading: 0.63 }).state;
    rig.update(state, 0, 0, false, false, 0, 1 / 60);
    let view = rig.update(state, 0, 0, false, true, 1 / 60, 1 / 60);
    for (let frame = 2; frame <= 60; frame += 1) {
      view = rig.update(state, 0.8, 0, false, false, frame / 60, 1 / 60);
    }
    const rotatedMapYaw = view.tacticalYaw;
    rig.update(state, 0, 0, false, true, 61 / 60, 1 / 60);
    for (let frame = 62; frame <= 150; frame += 1) {
      rig.update(state, 0, 0, false, false, frame / 60, 1 / 60);
    }

    view = rig.update(state, 0, 0, false, true, 151 / 60, 1 / 60);
    expect(angleDistance(view.tacticalYaw, rotatedMapYaw)).toBeLessThan(1e-6);
  });

  it("zooms to the full map and returns by pulling the stick back", () => {
    const rig = new CameraRig(new PerspectiveCamera());
    const state = new SubmarineDynamics().state;
    rig.toggleTactical();
    let view = rig.update(state, 0, 0, false, false, 0, 1 / 60);

    for (let frame = 1; frame <= 120; frame += 1) {
      view = rig.update(state, 0, -1, false, false, frame / 60, 1 / 60);
    }
    expect(view.tacticalDistance).toBe(MAX_TACTICAL_DISTANCE);

    for (let frame = 121; frame <= 195; frame += 1) {
      view = rig.update(state, 0, 1, false, false, frame / 60, 1 / 60);
    }
    expect(view.mode).toBe("chase");
    expect(view.tacticalAmount).toBeLessThan(0.01);
    expect(view.tacticalDistance).toBeLessThan(300);
  });

  it("makes an R3 return from maximum range visibly immediate", () => {
    const camera = new PerspectiveCamera();
    const rig = new CameraRig(camera);
    const state = new SubmarineDynamics().state;
    rig.frameTacticalOverview();
    let view = rig.update(state, 0, 0, false, false, 0, 1 / 60);
    for (let frame = 1; frame <= 90; frame += 1) {
      view = rig.update(state, 0, 0, false, false, frame / 60, 1 / 60);
    }
    const overviewHeight = camera.position.y;
    expect(view.tacticalDistance).toBe(MAX_TACTICAL_DISTANCE);

    view = rig.update(state, 0, 0, false, true, 91 / 60, 1 / 60);

    expect(view.mode).toBe("chase");
    expect(view.tacticalAmount).toBe(0);
    expect(view.tacticalZoom).toBe(0);
    expect(view.tacticalDistance).toBe(MIN_TACTICAL_DISTANCE);
    expect(camera.position.y).toBeLessThan(overviewHeight - 1_000);
  });
});

function angleDistance(left: number, right: number): number {
  const delta = left - right;
  return Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta)));
}
