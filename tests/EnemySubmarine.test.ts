import { describe, expect, it } from "vitest";
import {
  AKULA_PLAYER_ACOUSTIC_CLASS,
  DEFAULT_ENEMY_BEHAVIOR_CONFIG,
  EnemyPassiveSensor,
  EnemySubmarine,
  HUNT_ENEMY_ENVIRONMENT,
  SubmarineAutopilot,
  deterministicManeuverPlan,
  type AcousticPlatformState,
} from "../src/game/EnemySubmarine";
import {
  knotsToMetersPerSecond,
  vesselClassById,
} from "../src/game/NavalContactCatalog";
import {
  simulateVesselPassiveSonar,
  vesselSourceLevel,
  type VesselAcousticState,
} from "../src/game/SonarLogic";
import {
  SubmarineDynamics,
  isPropulsionStopped,
  metersPerSecondToKnots,
  type SubmarineState,
} from "../src/game/SubmarineDynamics";

describe("THE HUNT autonomous enemy", () => {
  it("starts as a weak but perceivable source at the scripted hunt range", () => {
    const enemy = new EnemySubmarine("TMA_TEST_SCRIPTED").snapshot;
    const player = new SubmarineDynamics().state;
    const result = simulateVesselPassiveSonar(
      { x: player.x, y: player.y, z: player.z },
      player.heading,
      player.speedMetersPerSecond,
      enemy.source,
      enemy.classDefinition,
      isPropulsionStopped(player.throttle),
    );
    expect(result.truth.rangeMeters).toBeGreaterThanOrEqual(6_000);
    expect(result.truth.rangeMeters).toBeLessThan(6_100);
    expect(result.measurement.signalQuality).toBeGreaterThanOrEqual(0.28);
    expect(result.measurement.signalQuality).toBeLessThan(0.65);
    expect(result.measurement.perceivable).toBe(true);
  });

  it("turns progressively through the shared submarine dynamics", () => {
    const enemy = new EnemySubmarine("TMA_TEST_SCRIPTED");
    const player = playerPlatform(new SubmarineDynamics().state);
    advanceEnemy(enemy, player, 119.95);
    const beforeTurn = enemy.snapshot;

    advanceEnemy(enemy, player, 0.1, 119.95);
    const turnStart = enemy.snapshot;
    expect(turnStart.aiState).toBe("BAFFLE_CLEAR");
    expect(
      Math.abs(wrapAngle(turnStart.state.heading - beforeTurn.state.heading)),
    ).toBeLessThan(radians(1));
    expect(turnStart.state.rudder).not.toBe(0);

    advanceEnemy(enemy, player, 45, 120.05);
    expect(
      Math.abs(
        wrapAngle(enemy.snapshot.state.heading - beforeTurn.state.heading),
      ),
    ).toBeGreaterThan(radians(20));
    expect(enemy.snapshot.state.collision).toBe("none");
  });

  it("keeps the nearby quiet run marginally perceivable without a speed jump", () => {
    const enemy = new EnemySubmarine("TMA_TEST_SCRIPTED");
    const player = playerPlatform(new SubmarineDynamics().state);
    advanceEnemy(enemy, player, 269.95);
    const beforeSprint = enemy.snapshot.source.speedKt;

    advanceEnemy(enemy, player, 0.1, 269.95);
    const immediate = enemy.snapshot;
    expect(immediate.aiState).toBe("BREAK_CONTACT");
    expect(immediate.source.speedKt - beforeSprint).toBeLessThan(0.2);
    expect(immediate.source.speedKt - beforeSprint).toBeLessThanOrEqual(
      immediate.classDefinition.accelerationKtPerSec * 0.1 + 0.001,
    );

    advanceEnemy(enemy, player, 34, 270.05);
    expect(enemy.snapshot.source.speedKt).toBeGreaterThan(beforeSprint + 3);
    expect(enemy.snapshot.source.speedKt - beforeSprint).toBeLessThanOrEqual(
      enemy.snapshot.classDefinition.accelerationKtPerSec * 34.1,
    );
    expect(enemy.snapshot.source.speedKt).toBeLessThan(
      enemy.snapshot.classDefinition.maxOperationalSpeedKt,
    );
    const sprintSignal = playerSonarResult(player, enemy.snapshot);

    advanceEnemy(enemy, player, 1, 304.05);
    expect(enemy.snapshot.aiState).toBe("QUIET_LISTEN");
    advanceEnemy(enemy, player, 55, 305.05);
    expect(enemy.snapshot.source.speedKt).toBeCloseTo(
      enemy.snapshot.classDefinition.quietSpeedKt,
      1,
    );
    const quietSignal = playerSonarResult(player, enemy.snapshot);
    expect(quietSignal.measurement.signalQuality).toBeLessThan(
      sprintSignal.measurement.signalQuality,
    );
    expect(quietSignal.measurement.signalQuality).toBeGreaterThanOrEqual(0.26);
    expect(quietSignal.measurement.perceivable).toBe(true);
  });

  it("replays the same sandbox state and plan for the same seed and input", () => {
    const first = new EnemySubmarine("HUNT_SANDBOX");
    const second = new EnemySubmarine("HUNT_SANDBOX");
    const player = playerPlatform(new SubmarineDynamics().state);
    advanceEnemy(first, player, 210);
    advanceEnemy(second, player, 210);

    expect(first.snapshot.aiState).toBe(second.snapshot.aiState);
    expect(first.snapshot.maneuverPlan).toEqual(second.snapshot.maneuverPlan);
    expect(first.snapshot.state.x).toBeCloseTo(second.snapshot.state.x, 8);
    expect(first.snapshot.state.z).toBeCloseTo(second.snapshot.state.z, 8);
    expect(deterministicManeuverPlan(971)).toEqual(
      deterministicManeuverPlan(971),
    );
    expect(deterministicManeuverPlan(971)).not.toEqual(
      deterministicManeuverPlan(972),
    );
  });

  it("biases controls away from a shallow forward probe", () => {
    const vesselClass = vesselClassById("los-angeles-flight-i");
    const shallowEnvironment = {
      ...HUNT_ENEMY_ENVIRONMENT,
      terrainHeightAt: () => -100,
    };
    const state = new SubmarineDynamics(
      {
        x: 0,
        y: -82,
        z: 0,
        heading: 0,
        speedMetersPerSecond: 5,
        throttle: 0.16,
      },
      shallowEnvironment,
    ).state;
    const autopilot = new SubmarineAutopilot(vesselClass, shallowEnvironment, {
      desiredCourseRad: 0,
      desiredSpeedKt: 8,
      desiredDepthM: 90,
    });
    const control = autopilot.update(state, 0.5);
    expect(Math.abs(control.rudder)).toBeGreaterThan(0.1);
    expect(control.divePlanes).toBeLessThan(0);
  });
});

describe("symmetric passive perception and movement-coupled noise", () => {
  const losAngeles = vesselClassById("los-angeles-flight-i");
  const listenerState = new SubmarineDynamics(
    {
      x: 0,
      y: -180,
      z: 0,
      heading: 0,
      speedMetersPerSecond: 3,
      throttle: 0.16,
    },
    HUNT_ENEMY_ENVIRONMENT,
  ).state;

  it("requires sustained signal before the enemy holds the Akula", () => {
    const sensor = new EnemyPassiveSensor(
      DEFAULT_ENEMY_BEHAVIOR_CONFIG,
      () => undefined,
    );
    const source = playerPlatformAt({ x: 0, y: -175, z: -1_100 }, 12);
    let timeSeconds = 0;
    for (let sample = 0; sample < 30; sample += 1) {
      timeSeconds += 0.125;
      sensor.update(0.125, timeSeconds, listenerState, source);
    }
    expect(sensor.snapshot.state).not.toBe("HELD");

    for (let sample = 0; sample < 12; sample += 1) {
      timeSeconds += 0.125;
      sensor.update(0.125, timeSeconds, listenerState, source);
    }
    expect(sensor.snapshot.state).toBe("HELD");
    expect(sensor.snapshot.bearingHistory.length).toBeGreaterThan(0);
  });

  it("does not react to an under-threshold or baffled source", () => {
    const farSensor = new EnemyPassiveSensor(
      DEFAULT_ENEMY_BEHAVIOR_CONFIG,
      () => undefined,
    );
    const farSource = playerPlatformAt({ x: 0, y: -175, z: -100_000 }, 4);
    const baffledSensor = new EnemyPassiveSensor(
      DEFAULT_ENEMY_BEHAVIOR_CONFIG,
      () => undefined,
    );
    const behindSource = playerPlatformAt({ x: 0, y: -175, z: 1_100 }, 14);
    for (let sample = 0; sample < 120; sample += 1) {
      const timeSeconds = (sample + 1) * 0.125;
      farSensor.update(0.125, timeSeconds, listenerState, farSource);
      baffledSensor.update(0.125, timeSeconds, listenerState, behindSource);
    }
    expect(farSensor.snapshot.state).toBe("UNDETECTED");
    expect(baffledSensor.snapshot.state).toBe("UNDETECTED");
  });

  it("raises source level for speed, acceleration, turning, and cavitation", () => {
    const quiet = vesselSourceLevel(
      { speedKt: 5, accelerationKtPerSec: 0, turnRateDegPerSec: 0 },
      losAngeles,
    );
    const maneuvering = vesselSourceLevel(
      { speedKt: 8, accelerationKtPerSec: 0.24, turnRateDegPerSec: 2 },
      losAngeles,
    );
    const sprint = vesselSourceLevel(
      { speedKt: 28, accelerationKtPerSec: 0.24, turnRateDegPerSec: 2 },
      losAngeles,
    );
    expect(maneuvering).toBeGreaterThan(quiet);
    expect(sprint).toBeGreaterThan(maneuvering + 0.5);
  });

  it("penalizes listener self-noise and the forward source aspect", () => {
    const source: VesselAcousticState = {
      position: { x: 0, y: -180, z: -2_000 },
      headingRad: 0,
      speedKt: 8,
      accelerationKtPerSec: 0,
      turnRateDegPerSec: 0,
    };
    const quietListener = simulateVesselPassiveSonar(
      { x: 0, y: -180, z: 0 },
      Math.PI,
      2,
      source,
      losAngeles,
      false,
    );
    const loudListener = simulateVesselPassiveSonar(
      { x: 0, y: -180, z: 0 },
      Math.PI,
      15,
      source,
      losAngeles,
      false,
    );
    expect(quietListener.measurement.signalQuality).toBeGreaterThan(
      loudListener.measurement.signalQuality,
    );
    expect(quietListener.acoustics.aspectGain).toBeGreaterThan(1);
  });
});

function advanceEnemy(
  enemy: EnemySubmarine,
  player: AcousticPlatformState,
  durationSeconds: number,
  startTimeSeconds = 0,
): void {
  const dt = 0.05;
  const steps = Math.ceil(durationSeconds / dt);
  for (let step = 0; step < steps; step += 1) {
    enemy.update(startTimeSeconds + (step + 1) * dt, dt, player);
  }
}

function playerPlatform(state: SubmarineState): AcousticPlatformState {
  return {
    position: { x: state.x, y: state.y, z: state.z },
    headingRad: state.heading,
    speedKt: Math.abs(metersPerSecondToKnots(state.speedMetersPerSecond)),
    accelerationKtPerSec: 0,
    turnRateDegPerSec: 0,
    propulsionStopped: isPropulsionStopped(state.throttle),
    classDefinition: AKULA_PLAYER_ACOUSTIC_CLASS,
  };
}

function playerPlatformAt(
  position: Readonly<{ x: number; y: number; z: number }>,
  speedKt: number,
): AcousticPlatformState {
  return {
    position,
    headingRad: 0,
    speedKt,
    accelerationKtPerSec: 0,
    turnRateDegPerSec: 0,
    propulsionStopped: false,
    classDefinition: AKULA_PLAYER_ACOUSTIC_CLASS,
  };
}

function playerSonarResult(
  player: AcousticPlatformState,
  enemy: EnemySubmarine["snapshot"],
) {
  return simulateVesselPassiveSonar(
    player.position,
    player.headingRad,
    knotsToMetersPerSecond(player.speedKt),
    enemy.source,
    enemy.classDefinition,
    player.propulsionStopped,
  );
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
