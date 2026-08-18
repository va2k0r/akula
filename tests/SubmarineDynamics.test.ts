import { describe, expect, it } from "vitest";
import {
  depthCompensatedThrottle,
  metersPerSecondToKnots,
  SubmarineDynamics,
  TELEGRAPH_SETTINGS,
  telegraphLabel,
  yawPivotOffsetMeters,
} from "../src/game/SubmarineDynamics";
import { ICE_KEELS, terrainHeightAt } from "../src/game/WorldGeometry";
import { GAMEPLAY_MOVEMENT_SCALE } from "../src/game/NavalContactCatalog";

const IDLE = {
  turn: 0,
  dive: 0,
  ballast: 0,
  throttleStep: 0,
} as const;

const AUTONOMOUS_PROFILE = {
  maxAheadSpeedKt: 30,
  maxAsternSpeedKt: 6,
  accelerationKtPerSec: 0.8,
  decelerationKtPerSec: 1,
  maxTurnRateDegPerSec: 2.2,
} as const;

describe("Akula action dynamics", () => {
  it("accepts the common autonomous control input without instant rotation", () => {
    const dynamics = new SubmarineDynamics({
      y: -120,
      z: 800,
      heading: 0,
      throttle: 0.16,
      speedMetersPerSecond: 4,
    });
    const before = dynamics.state;
    const first = dynamics.updateControl(
      { rudder: 1, throttle: 1, divePlanes: 0.4 },
      0.05,
      AUTONOMOUS_PROFILE,
    );
    expect(first.heading).toBeGreaterThan(before.heading);
    expect(first.heading).toBeLessThan((1 * Math.PI) / 180);
    expect(
      first.speedMetersPerSecond - before.speedMetersPerSecond,
    ).toBeLessThan(0.4);

    for (let frame = 0; frame < 600; frame += 1) {
      dynamics.updateControl(
        { rudder: 1, throttle: 1, divePlanes: 0.4 },
        0.05,
        AUTONOMOUS_PROFILE,
      );
    }
    expect(Math.abs(dynamics.state.heading)).toBeGreaterThan(0.2);
    expect(dynamics.state.rudder).toBeGreaterThan(0.9);
    expect(dynamics.state.planes).toBeGreaterThan(0.35);
  });

  it("starts centred with room for a one-minute accelerated cruise leg", () => {
    const dynamics = new SubmarineDynamics();
    expect(dynamics.state.x).toBe(0);
    expect(dynamics.state.z).toBe(0);

    let boundaryContacts = 0;
    for (let frame = 0; frame < 1_200; frame += 1) {
      const state = dynamics.update(
        { ...IDLE, throttleStep: frame === 0 ? 1 : 0 },
        1 / 20,
      );
      if (state.collision === "boundary") {
        boundaryContacts += 1;
      }
    }

    expect(boundaryContacts).toBe(0);
    expect(-dynamics.state.z).toBeGreaterThan(430 * GAMEPLAY_MOVEMENT_SCALE);
  });

  it("compresses world travel without changing indicated knots", () => {
    const speedMetersPerSecond = 10;
    const dynamics = new SubmarineDynamics({
      z: 800,
      throttle: 1,
      speedMetersPerSecond,
    });
    const before = dynamics.state;
    const after = dynamics.update(IDLE, 0.05);

    expect(after.speedMetersPerSecond - speedMetersPerSecond).toBeLessThan(0.2);
    expect(metersPerSecondToKnots(after.speedMetersPerSecond)).toBeLessThan(32);
    expect(before.z - after.z).toBeCloseTo(
      after.speedMetersPerSecond * 0.05 * GAMEPLAY_MOVEMENT_SCALE,
      6,
    );
  });

  it("advances only the player dynamics by the requested debug multiplier", () => {
    const accelerated = new SubmarineDynamics({
      y: -90,
      z: 800,
      throttle: 0.52,
      speedMetersPerSecond: 6,
    });
    const reference = new SubmarineDynamics({
      y: -90,
      z: 800,
      throttle: 0.52,
      speedMetersPerSecond: 6,
    });
    const command = { ...IDLE, turn: 0.45, dive: 0.3, throttleStep: 1 };

    const acceleratedState = accelerated.update(command, 1 / 60, undefined, 10);
    for (let substep = 0; substep < 10; substep += 1) {
      reference.update(
        substep === 0 ? command : { ...command, throttleStep: 0 },
        1 / 60,
      );
    }

    expect(acceleratedState.throttle).toBe(1);
    expect(acceleratedState.x).toBeCloseTo(reference.state.x, 8);
    expect(acceleratedState.y).toBeCloseTo(reference.state.y, 8);
    expect(acceleratedState.z).toBeCloseTo(reference.state.z, 8);
    expect(acceleratedState.heading).toBeCloseTo(reference.state.heading, 8);
    expect(acceleratedState.speedMetersPerSecond).toBeCloseTo(
      reference.state.speedMetersPerSecond,
      8,
    );
  });

  it("uses five persistent telegraph detents and nuclear-submarine mass", () => {
    const dynamics = new SubmarineDynamics({
      throttle: 0,
      speedMetersPerSecond: 0,
    });
    for (let step = 0; step < 3; step += 1) {
      dynamics.update({ ...IDLE, throttleStep: 1 }, 1 / 20);
    }
    for (let frame = 0; frame < 120; frame += 1) {
      dynamics.update(IDLE, 1 / 20);
    }
    expect(dynamics.state.throttle).toBe(1);
    expect(dynamics.state.speedMetersPerSecond).toBeGreaterThan(10);

    const speedAtRelease = dynamics.state.speedMetersPerSecond;
    dynamics.update(IDLE, 0.05);
    expect(dynamics.state.speedMetersPerSecond).toBeGreaterThan(
      speedAtRelease - 0.2,
    );
  });

  it("exposes exactly reverse, stop, silent, cruise, and flank", () => {
    expect(TELEGRAPH_SETTINGS.map(({ label }) => label)).toEqual([
      "REVERSE",
      "STOP",
      "SILENT",
      "CRUISE",
      "FLANK",
    ]);
    expect(telegraphLabel(-0.22)).toBe("REVERSE");
    expect(telegraphLabel(0)).toBe("STOP");
    expect(telegraphLabel(0.16)).toBe("SILENT");
    expect(telegraphLabel(0.52)).toBe("CRUISE");
    expect(telegraphLabel(1)).toBe("FLANK");
  });

  it("makes silent and cruise conspicuously faster under deep pressure", () => {
    const shallowSilent = depthCompensatedThrottle(0.16, 30, 0);
    const deepSilent = depthCompensatedThrottle(0.16, 170, 0);
    const shallowCruise = depthCompensatedThrottle(0.52, 30, 0);
    const deepCruise = depthCompensatedThrottle(0.52, 170, 0);

    expect(shallowSilent).toBe(0.16);
    expect(shallowCruise).toBe(0.52);
    expect(deepSilent).toBe(0.3);
    expect(deepCruise).toBe(0.75);
    expect(
      metersPerSecondToKnots((deepSilent - shallowSilent) * 15.8),
    ).toBeGreaterThan(4);
    expect(
      metersPerSecondToKnots((deepCruise - shallowCruise) * 15.8),
    ).toBeGreaterThan(7);
  });

  it("spools the pressure advantage while descending", () => {
    const levelSilent = depthCompensatedThrottle(0.16, 76, 0);
    const descendingSilent = depthCompensatedThrottle(0.16, 76, 2.5);
    const levelCruise = depthCompensatedThrottle(0.52, 76, 0);
    const descendingCruise = depthCompensatedThrottle(0.52, 76, 2.5);

    expect(descendingSilent).toBeGreaterThan(levelSilent + 0.04);
    expect(descendingCruise).toBeGreaterThan(levelCruise + 0.07);
    expect(depthCompensatedThrottle(-0.22, 200, 3)).toBe(-0.22);
    expect(depthCompensatedThrottle(0, 200, 3)).toBe(0);
    expect(depthCompensatedThrottle(1, 200, 3)).toBe(1);
  });

  it("coasts absurdly far after the telegraph enters stop", () => {
    const dynamics = new SubmarineDynamics({
      throttle: 0.16,
      speedMetersPerSecond: 12,
      z: 800,
    });
    const startZ = dynamics.state.z;
    dynamics.update({ ...IDLE, throttleStep: -1 }, 1 / 20);
    for (let frame = 0; frame < 600; frame += 1) {
      dynamics.update(IDLE, 1 / 20);
    }

    expect(dynamics.state.throttle).toBe(0);
    expect(dynamics.state.speedMetersPerSecond).toBeGreaterThan(8);
    expect(startZ - dynamics.state.z).toBeGreaterThan(290);
  });

  it("almost stops turning while it continues to drift at stop", () => {
    const powered = new SubmarineDynamics({
      throttle: 0.52,
      speedMetersPerSecond: 12,
      z: 800,
    });
    const drifting = new SubmarineDynamics({
      throttle: 0,
      speedMetersPerSecond: 12,
      z: 800,
    });
    const command = { ...IDLE, turn: 1 } as const;
    for (let frame = 0; frame < 150; frame += 1) {
      powered.update(command, 1 / 30);
      drifting.update(command, 1 / 30);
    }

    expect(powered.state.heading).toBeGreaterThan(0.25);
    expect(drifting.state.heading).toBeLessThan(powered.state.heading * 0.12);
    expect(drifting.state.speedMetersPerSecond).toBeGreaterThan(11);
    expect(800 - drifting.state.z).toBeGreaterThan(55);
  });

  it("cannot turn or use planes at rest while ballast still changes depth", () => {
    const stationary = new SubmarineDynamics({
      x: 0,
      y: -76,
      z: 800,
      throttle: 0,
      speedMetersPerSecond: 0,
    });
    for (let frame = 0; frame < 180; frame += 1) {
      stationary.update({ ...IDLE, turn: 1, dive: 1 }, 1 / 30);
    }

    expect(stationary.state.x).toBe(0);
    expect(stationary.state.z).toBe(800);
    expect(stationary.state.y).toBe(-76);
    expect(stationary.state.heading).toBe(0);
    expect(stationary.state.pitch).toBe(0);
    expect(stationary.state.roll).toBe(0);
    expect(stationary.state.rudder).toBeGreaterThan(0.99);
    expect(stationary.state.planes).toBeGreaterThan(0.99);

    const flooding = new SubmarineDynamics({
      x: 0,
      y: -76,
      z: 800,
      throttle: 0,
      speedMetersPerSecond: 0,
    });
    const blowing = new SubmarineDynamics({
      x: 0,
      y: -76,
      z: 800,
      throttle: 0,
      speedMetersPerSecond: 0,
    });
    for (let frame = 0; frame < 180; frame += 1) {
      flooding.update({ ...IDLE, ballast: 1 }, 1 / 30);
      blowing.update({ ...IDLE, ballast: -1 }, 1 / 30);
    }

    expect(flooding.state.x).toBe(0);
    expect(flooding.state.z).toBe(800);
    expect(flooding.state.heading).toBe(0);
    expect(flooding.state.y).toBeLessThan(-84);
    expect(blowing.state.x).toBe(0);
    expect(blowing.state.z).toBe(800);
    expect(blowing.state.heading).toBe(0);
    expect(blowing.state.y).toBeGreaterThan(-68);
  });

  it("turns around a forward yaw pivot instead of the bow, stern, or centre", () => {
    expect(yawPivotOffsetMeters(0)).toBe(0);
    expect(yawPivotOffsetMeters(15.8)).toBe(22);
    expect(yawPivotOffsetMeters(-15.8)).toBe(-22);

    const dynamics = new SubmarineDynamics({
      x: 0,
      z: 800,
      heading: 0,
      throttle: 1,
      speedMetersPerSecond: 15.8,
    });
    const previous = dynamics.state;
    const next = dynamics.update({ ...IDLE, turn: 1 }, 0.05);
    const pivotOffset = yawPivotOffsetMeters(next.speedMetersPerSecond);
    const previousPivot = {
      x: previous.x + Math.sin(previous.heading) * pivotOffset,
      z: previous.z - Math.cos(previous.heading) * pivotOffset,
    };
    const nextPivot = {
      x: next.x + Math.sin(next.heading) * pivotOffset,
      z: next.z - Math.cos(next.heading) * pivotOffset,
    };
    const pivotTravel = {
      x: nextPivot.x - previousPivot.x,
      z: nextPivot.z - previousPivot.z,
    };
    const lateralTravel =
      pivotTravel.x * Math.cos(next.heading) +
      pivotTravel.z * Math.sin(next.heading);

    expect(lateralTravel).toBeCloseTo(0, 8);
    expect(next.x).toBeLessThan(previous.x);
    expect(next.heading).toBeGreaterThan(previous.heading);
  });

  it("banks visibly into a sustained rudder command", () => {
    const dynamics = new SubmarineDynamics({ throttle: 0.7 });
    for (let frame = 0; frame < 90; frame += 1) {
      dynamics.update({ ...IDLE, turn: 1 }, 1 / 30);
    }
    expect(dynamics.state.heading).toBeGreaterThan(0.05);
    expect(dynamics.state.roll).toBeLessThan(-0.08);
    expect(dynamics.state.rudder).toBeGreaterThan(0.95);
  });

  it("turns planes and ballast into meaningful depth change", () => {
    const dynamics = new SubmarineDynamics({ y: -80, throttle: 0.55 });
    const initialDepth = -dynamics.state.y;
    for (let frame = 0; frame < 150; frame += 1) {
      dynamics.update({ ...IDLE, dive: 1, ballast: 0.4 }, 1 / 30);
    }
    expect(-dynamics.state.y).toBeGreaterThan(initialDepth + 8);
    expect(dynamics.state.depthRate).toBeGreaterThan(2);
    expect(dynamics.state.pitch).toBeLessThan(-0.08);
  });

  it("collides with a keel instead of passing through the ice", () => {
    const keel = ICE_KEELS[1];
    expect(keel).toBeDefined();
    const dynamics = new SubmarineDynamics({
      x: keel?.x ?? 0,
      z: keel?.z ?? 0,
      y: -20,
      throttle: 0,
      speedMetersPerSecond: 0,
    });
    dynamics.update(IDLE, 0.05);
    expect(dynamics.state.collision).toBe("ice");
    expect(dynamics.state.iceClearance).toBeCloseTo(8.5, 6);
  });

  it("lets the boat rise into an open lead instead of inventing an ice roof", () => {
    const dynamics = new SubmarineDynamics({
      x: 0,
      z: 800,
      y: -1,
      throttle: 0,
      speedMetersPerSecond: 0,
    });
    dynamics.update(IDLE, 0.05);
    expect(dynamics.state.y).toBe(-5);
    expect(dynamics.state.iceClearance).toBe(Number.POSITIVE_INFINITY);
    expect(dynamics.state.collision).toBe("none");
  });

  it("lets a surfaced boat ride a long swell instead of a flat water ceiling", () => {
    const dynamics = new SubmarineDynamics({
      x: 0,
      z: 800,
      y: -5,
      throttle: 0,
      speedMetersPerSecond: 0,
    });
    for (let frame = 0; frame < 180; frame += 1) {
      dynamics.update(IDLE, 1 / 30, {
        height: 3.2,
        verticalVelocity: 0.25,
        normalX: -0.08,
        normalY: 0.99,
        normalZ: 0.04,
      });
    }
    expect(dynamics.state.y).toBeGreaterThan(-2.4);
    expect(Math.abs(dynamics.state.pitch)).toBeGreaterThan(0.01);
  });

  it("collides with the seabed instead of tunnelling through it", () => {
    const x = 0;
    const z = 500;
    const floor = terrainHeightAt(x, z);
    const dynamics = new SubmarineDynamics({
      x,
      z,
      y: floor - 4,
      throttle: 0,
      speedMetersPerSecond: 0,
    });
    dynamics.update(IDLE, 0.05);
    expect(dynamics.state.collision).toBe("floor");
    expect(dynamics.state.floorClearance).toBeCloseTo(8.5, 6);
  });
});
