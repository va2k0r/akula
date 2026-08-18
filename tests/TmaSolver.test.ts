import { describe, expect, it } from "vitest";
import {
  DEFAULT_TMA_SOLVER_CONFIG,
  bearingFrom,
  huberLoss,
  observationResidualAgainstSolution,
  solveTma,
  type BearingObservation,
} from "../src/game/TmaSolver";
import {
  FROSTBITE_TEST_CONTACT,
  GAMEPLAY_MOVEMENT_SCALE,
  knotsToMetersPerSecond,
  knotsToWorldMetersPerSecond,
  vesselPositionAt,
} from "../src/game/NavalContactCatalog";

const TARGET_SPEED_KT = 8;
const TARGET_COURSE_RAD = radians(300);
const TARGET_INITIAL = { x: 15_000, z: -13_000 };
const OWNSHIP_SPEED_MPS = 5;
const OWNSHIP_WORLD_SPEED_MPS = OWNSHIP_SPEED_MPS * GAMEPLAY_MOVEMENT_SCALE;

describe("deterministic bearing-only TMA", () => {
  it("uses Huber loss so a weak outlier cannot dominate quadratically", () => {
    expect(huberLoss(1)).toBe(0.5);
    expect(huberLoss(10)).toBeLessThan(10 * 10 * 0.5);
  });

  it("produces a hypothesis cloud without inventing a point from one bearing", () => {
    const observations = [observationAt(0, false)];
    const result = solveTma(observations, TARGET_SPEED_KT);

    expect(result.hypotheses.length).toBeGreaterThan(300);
    expect(result.best).toBeUndefined();
    expect(result.weightedSpreadMeters).toBeGreaterThan(4_000);
    expect(
      result.hypotheses.every(
        ({ initialRangeM }) =>
          initialRangeM >= DEFAULT_TMA_SOLVER_CONFIG.minimumRangeM &&
          initialRangeM <= DEFAULT_TMA_SOLVER_CONFIG.maximumRangeM,
      ),
    ).toBe(true);
  });

  it("narrows the geometric cloud after ownship changes course", () => {
    const straight = Array.from({ length: 13 }, (_, index) =>
      observationAt(index * 5, false),
    );
    const maneuvered = [
      ...straight,
      ...Array.from({ length: 12 }, (_, index) =>
        observationAt(65 + index * 5, true),
      ),
    ];
    const beforeTurn = solveTma(straight, TARGET_SPEED_KT);
    const afterTurn = solveTma(maneuvered, TARGET_SPEED_KT);

    expect(afterTurn.weightedSpreadMeters).toBeLessThan(
      beforeTurn.weightedSpreadMeters,
    );
    expect(afterTurn.best).toBeDefined();
    const best = afterTurn.best;
    if (best === undefined) {
      return;
    }
    const truth = targetPositionAt(120);
    expect(
      Math.hypot(
        best.currentPredictedPosition.x - truth.x,
        best.currentPredictedPosition.z - truth.z,
      ),
    ).toBeLessThan(2_500);
    expect(
      Math.abs(
        Math.atan2(
          Math.sin(best.targetCourseRad - TARGET_COURSE_RAD),
          Math.cos(best.targetCourseRad - TARGET_COURSE_RAD),
        ),
      ),
    ).toBeLessThan(radians(10));
  });

  it("builds an actionable opening-hunt estimate after a player-created second leg", () => {
    const indicatedOwnshipSpeedKt = 16;
    const ownshipSpeedMps = knotsToMetersPerSecond(indicatedOwnshipSpeedKt);
    const ownshipWorldSpeedMps = knotsToWorldMetersPerSecond(
      indicatedOwnshipSpeedKt,
    );
    const observations = Array.from({ length: 161 }, (_, index) => {
      const timeSeconds = index * 0.4;
      const secondLegElapsed = Math.max(0, timeSeconds - 24);
      const secondLegCourseRad = radians(45);
      const ownshipPosition =
        timeSeconds <= 24
          ? { x: 0, z: -ownshipWorldSpeedMps * timeSeconds }
          : {
              x:
                Math.sin(secondLegCourseRad) *
                ownshipWorldSpeedMps *
                secondLegElapsed,
              z:
                -ownshipWorldSpeedMps * 24 -
                Math.cos(secondLegCourseRad) *
                  ownshipWorldSpeedMps *
                  secondLegElapsed,
            };
      const targetPosition = vesselPositionAt(
        FROSTBITE_TEST_CONTACT,
        timeSeconds,
      );
      return {
        timeSeconds,
        ownshipPosition,
        ownshipCourseRad: timeSeconds <= 24 ? 0 : secondLegCourseRad,
        ownshipSpeedMps,
        bearingRad: bearingFrom(ownshipPosition, targetPosition),
        bearingSigmaRad: radians(0.45),
        signalQuality: 0.5,
      } satisfies BearingObservation;
    });

    const result = solveTma(observations, FROSTBITE_TEST_CONTACT.trueSpeedKt);
    const truth = vesselPositionAt(FROSTBITE_TEST_CONTACT, 64);
    expect(result.weightedSpreadMeters).toBeLessThan(400);
    expect(result.best).toBeDefined();
    expect(
      Math.hypot(
        (result.best?.currentPredictedPosition.x ?? 0) - truth.x,
        (result.best?.currentPredictedPosition.z ?? 0) - truth.z,
      ),
    ).toBeLessThan(500);
  });

  it("keeps a low residual on constant motion and rejects a later turn", () => {
    const stableObservations = Array.from({ length: 25 }, (_, index) =>
      observationAt(index * 5, index * 5 > 60),
    );
    const stableSolution = solveTma(stableObservations, TARGET_SPEED_KT);
    expect(stableSolution.fitResidual).toBeLessThan(1);
    expect(stableSolution.confidence).toBeGreaterThan(0);

    const timeSeconds = 180;
    const observer = {
      x: Math.sin(radians(30)) * OWNSHIP_WORLD_SPEED_MPS * (timeSeconds - 60),
      z:
        -OWNSHIP_WORLD_SPEED_MPS * 60 -
        Math.cos(radians(30)) * OWNSHIP_WORLD_SPEED_MPS * (timeSeconds - 60),
    };
    const targetAtTurn = targetPositionAt(120);
    const turnedCourse = radians(70);
    const turnedTarget = {
      x:
        targetAtTurn.x +
        Math.sin(turnedCourse) *
          knotsToWorldMetersPerSecond(TARGET_SPEED_KT) *
          (timeSeconds - 120),
      z:
        targetAtTurn.z -
        Math.cos(turnedCourse) *
          knotsToWorldMetersPerSecond(TARGET_SPEED_KT) *
          (timeSeconds - 120),
    };
    const incompatible: BearingObservation = {
      timeSeconds,
      ownshipPosition: observer,
      ownshipCourseRad: radians(30),
      ownshipSpeedMps: OWNSHIP_SPEED_MPS,
      bearingRad: bearingFrom(observer, turnedTarget),
      bearingSigmaRad: radians(0.42),
      signalQuality: 0.78,
    };
    expect(
      observationResidualAgainstSolution(stableSolution, incompatible),
    ).toBeGreaterThan(1.5);
  });
});

function observationAt(
  timeSeconds: number,
  maneuvering: boolean,
): BearingObservation {
  const ownship =
    maneuvering && timeSeconds > 60
      ? {
          x:
            Math.sin(radians(30)) *
            OWNSHIP_WORLD_SPEED_MPS *
            (timeSeconds - 60),
          z:
            -OWNSHIP_WORLD_SPEED_MPS * 60 -
            Math.cos(radians(30)) *
              OWNSHIP_WORLD_SPEED_MPS *
              (timeSeconds - 60),
        }
      : { x: 0, z: -OWNSHIP_WORLD_SPEED_MPS * timeSeconds };
  const target = targetPositionAt(timeSeconds);
  return {
    timeSeconds,
    ownshipPosition: ownship,
    ownshipCourseRad: maneuvering ? radians(30) : 0,
    ownshipSpeedMps: OWNSHIP_SPEED_MPS,
    bearingRad: bearingFrom(ownship, target),
    bearingSigmaRad: radians(0.42),
    signalQuality: 0.78,
  };
}

function targetPositionAt(timeSeconds: number) {
  const targetSpeedMps = knotsToWorldMetersPerSecond(TARGET_SPEED_KT);
  return {
    x:
      TARGET_INITIAL.x +
      Math.sin(TARGET_COURSE_RAD) * targetSpeedMps * timeSeconds,
    z:
      TARGET_INITIAL.z -
      Math.cos(TARGET_COURSE_RAD) * targetSpeedMps * timeSeconds,
  };
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
