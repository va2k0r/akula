import { describe, expect, it } from "vitest";
import {
  CONTACT_LOST_AFTER_SECONDS,
  CONTACT_OBSERVATION_INTERVAL_SECONDS,
  PRE_ACQUISITION_HISTORY_SECONDS,
  ContactTracker,
  bearingSigmaForQuality,
  type OwnshipObservationState,
  type SanitizedSonarMeasurement,
} from "../src/game/ContactTracker";
import {
  GAMEPLAY_MOVEMENT_SCALE,
  knotsToWorldMetersPerSecond,
  vesselClassById,
} from "../src/game/NavalContactCatalog";
import { bearingFrom } from "../src/game/TmaSolver";

const ownship: OwnshipObservationState = {
  position: { x: 0, z: 0 },
  courseRad: 0,
  speedMps: 4,
};

function measurement(
  timeSeconds: number,
  overrides: Partial<SanitizedSonarMeasurement> = {},
): SanitizedSonarMeasurement {
  return {
    sourceEntityId: "source-1",
    timeSeconds,
    worldBearingRad: Math.PI / 4,
    relativeBearingRad: Math.PI / 4,
    signalQuality: 0.72,
    perceivable: true,
    observedPropulsionRateHz: 1 / 4.45,
    ...overrides,
  };
}

describe("contact tracking lifecycle", () => {
  it("assigns one permanent progressive number per source", () => {
    const tracker = new ContactTracker();
    expect(tracker.hasSource("source-1")).toBe(false);

    const first = tracker.acquire(measurement(0), ownship);
    const duplicate = tracker.acquire(measurement(1), ownship);

    expect(first.isNew).toBe(true);
    expect(first.contactNumber).toBe(1);
    expect(duplicate.isNew).toBe(false);
    expect(duplicate.contactTrackId).toBe(first.contactTrackId);
    expect(tracker.snapshots()).toHaveLength(1);
    expect(tracker.activeTrack()?.label).toBe("ЦЕЛЬ 1");
  });

  it("samples deterministic bearings at 2.5 Hz and retains them when lost", () => {
    const tracker = new ContactTracker();
    tracker.acquire(measurement(0), ownship);
    tracker.updateMeasurement(
      measurement(CONTACT_OBSERVATION_INTERVAL_SECONDS - 0.01),
      ownship,
    );
    expect(tracker.activeTrack()?.observations).toHaveLength(1);

    tracker.updateMeasurement(
      measurement(CONTACT_OBSERVATION_INTERVAL_SECONDS),
      ownship,
    );
    expect(tracker.activeTrack()?.observations).toHaveLength(2);

    tracker.updateMeasurement(
      measurement(
        CONTACT_OBSERVATION_INTERVAL_SECONDS +
          CONTACT_LOST_AFTER_SECONDS +
          0.01,
        { perceivable: false, signalQuality: 0.05 },
      ),
      ownship,
    );
    const lost = tracker.activeTrack();
    expect(lost?.status).toBe("LOST");
    expect(lost?.observations).toHaveLength(2);
  });

  it("brings a rolling sanitized sonar history into a newly assigned track", () => {
    const tracker = new ContactTracker();
    for (
      let timeSeconds = 0;
      timeSeconds <= 30;
      timeSeconds += CONTACT_OBSERVATION_INTERVAL_SECONDS
    ) {
      tracker.updateMeasurement(measurement(timeSeconds), ownship);
    }
    expect(tracker.hasSource("source-1")).toBe(false);

    tracker.acquire(measurement(30.4), ownship);
    const track = tracker.activeTrack();
    expect(track?.observations.length).toBeGreaterThan(50);
    expect(track?.observations[0]?.timeSeconds).toBeGreaterThanOrEqual(
      30.4 - PRE_ACQUISITION_HISTORY_SECONDS - 1e-6,
    );
    expect(track?.observations.at(-1)?.timeSeconds).toBeCloseTo(30.4, 6);
    expect(track).not.toHaveProperty("truePosition");
  });

  it("uses a tighter but still quality-dependent sonar-operator bearing error", () => {
    const degrees = (radians: number) => (radians * 180) / Math.PI;
    expect(degrees(bearingSigmaForQuality(1))).toBeCloseTo(0.1, 8);
    expect(degrees(bearingSigmaForQuality(0.5))).toBeCloseTo(0.45, 8);
    expect(degrees(bearingSigmaForQuality(0))).toBeCloseTo(1.5, 8);
    expect(bearingSigmaForQuality(0.25)).toBeGreaterThan(
      bearingSigmaForQuality(0.75),
    );
  });

  it("rebuilds TMA from all bearings when the operational identity changes", () => {
    const tracker = new ContactTracker();
    const assignment = tracker.acquire(measurement(0), ownship);
    tracker.updateMeasurement(measurement(0.4), ownship);
    tracker.updateMeasurement(measurement(0.8), ownship);

    const correct = tracker.applyIdentification(
      assignment.contactTrackId,
      [1, 2, 4],
      0.8,
    );
    const wrong = tracker.applyIdentification(
      assignment.contactTrackId,
      [3, 4, 5],
      1,
    );

    expect(correct.identification?.estimatedSpeedKt).toBeCloseTo(8, 8);
    expect(wrong.identification?.estimatedSpeedKt).not.toBeCloseTo(8, 2);
    expect(wrong.observations).toHaveLength(3);
    expect(wrong.solution?.hypotheses.length).toBeGreaterThan(100);
    expect(wrong).not.toHaveProperty("correct");
    expect(wrong).not.toHaveProperty("truePosition");
  });

  it("requires camera reacquisition and keeps the permanent contact number", () => {
    const tracker = new ContactTracker();
    const first = tracker.acquire(measurement(0), ownship);
    tracker.updateMeasurement(
      measurement(CONTACT_LOST_AFTER_SECONDS + 0.01, {
        perceivable: false,
        signalQuality: 0.04,
      }),
      ownship,
    );
    expect(tracker.activeTrack()?.status).toBe("LOST");
    expect(tracker.requiresAcquisition("source-1")).toBe(true);
    const observationsAtLoss = tracker.activeTrack()?.observations.length;

    tracker.updateMeasurement(measurement(3), ownship);
    expect(tracker.activeTrack()?.status).toBe("LOST");
    expect(tracker.activeTrack()?.observations.length).toBe(observationsAtLoss);

    const reacquired = tracker.acquire(measurement(3), ownship);
    expect(reacquired.reacquired).toBe(true);
    expect(reacquired.contactTrackId).toBe(first.contactTrackId);
    expect(reacquired.contactNumber).toBe(1);
    expect(tracker.activeTrack()?.status).toBe("HELD");
    expect(tracker.activeTrack()?.motionLegs).toHaveLength(2);
    expect(tracker.snapshots()).toHaveLength(1);
  });

  it("crew-classifies every assignment and immediately restores the TMA", () => {
    const tracker = new ContactTracker();
    const trueClass = vesselClassById("los-angeles-flight-i");
    const rateHz = trueClass.propulsionRatePerKnot * 8;
    const first = tracker.acquire(
      measurement(0, { observedPropulsionRateHz: rateHz }),
      ownship,
      { recognizedSignatureCode: trueClass.signatureCode },
    );

    const firstTrack = tracker.activeTrack();
    expect(firstTrack?.identification?.guessedClassId).toBe(trueClass.id);
    expect(firstTrack?.identification?.signatureCode).toEqual(
      trueClass.signatureCode,
    );
    expect(firstTrack?.solution?.hypotheses.length).toBeGreaterThan(0);
    expect(firstTrack).not.toHaveProperty("truePosition");

    tracker.applyIdentification(first.contactTrackId, [3, 4, 5], 0.1);
    expect(tracker.activeTrack()?.identification?.guessedClassId).not.toBe(
      trueClass.id,
    );
    tracker.updateMeasurement(
      measurement(CONTACT_LOST_AFTER_SECONDS + 0.11, {
        perceivable: false,
        signalQuality: 0.04,
      }),
      ownship,
    );
    expect(tracker.activeTrack()?.status).toBe("LOST");

    const reacquired = tracker.acquire(
      measurement(3, { observedPropulsionRateHz: rateHz }),
      ownship,
      { recognizedSignatureCode: trueClass.signatureCode },
    );
    const restored = tracker.activeTrack();
    expect(reacquired.reacquired).toBe(true);
    expect(reacquired.contactTrackId).toBe(first.contactTrackId);
    expect(restored?.identification?.guessedClassId).toBe(trueClass.id);
    expect(restored?.solution?.hypotheses.length).toBeGreaterThan(0);
    expect(restored?.motionLegs).toHaveLength(2);
  });

  it("updates estimated speed from a short acoustic-rate window", () => {
    const tracker = new ContactTracker();
    const trueClass = vesselClassById("los-angeles-flight-i");
    const rateAt8Kt = trueClass.propulsionRatePerKnot * 8;
    const rateAt16Kt = trueClass.propulsionRatePerKnot * 16;
    const assignment = tracker.acquire(
      measurement(0, { observedPropulsionRateHz: rateAt8Kt }),
      ownship,
    );
    tracker.applyIdentification(assignment.contactTrackId, [1, 2, 4], 0);
    expect(tracker.activeTrack()?.identification?.estimatedSpeedKt).toBeCloseTo(
      8,
      8,
    );

    for (let sample = 1; sample <= 8; sample += 1) {
      const timeSeconds = sample * 0.4;
      tracker.updateMeasurement(
        measurement(timeSeconds, {
          observedPropulsionRateHz: rateAt16Kt,
        }),
        ownship,
      );
    }
    expect(
      tracker.activeTrack()?.identification?.estimatedSpeedKt,
    ).toBeGreaterThan(14);

    const wrong = tracker.applyIdentification(
      assignment.contactTrackId,
      [3, 4, 5],
      3.2,
    );
    expect(wrong.identification?.estimatedSpeedKt).not.toBeCloseTo(16, 1);
  });

  it("opens a new motion leg only after persistent post-turn residuals", () => {
    const tracker = new ContactTracker();
    const trueClass = vesselClassById("los-angeles-flight-i");
    const rateHz = trueClass.propulsionRatePerKnot * 8;
    const firstOwnship = ownshipAt(0);
    const assignment = tracker.acquire(
      movingMeasurement(0, targetAt(0), firstOwnship, rateHz),
      firstOwnship,
    );
    tracker.applyIdentification(assignment.contactTrackId, [1, 2, 4], 0);

    for (let timeSeconds = 2; timeSeconds <= 40; timeSeconds += 2) {
      const observer = ownshipAt(timeSeconds);
      tracker.updateMeasurement(
        movingMeasurement(timeSeconds, targetAt(timeSeconds), observer, rateHz),
        observer,
      );
    }
    const atTrueTurn = tracker.activeTrack();
    expect(atTrueTurn?.motionLegs).toHaveLength(1);
    const courseAtTrueTurn = atTrueTurn?.solution?.best?.targetCourseRad;
    expect(courseAtTrueTurn).toBeDefined();
    if (courseAtTrueTurn !== undefined) {
      expect(
        Math.abs(wrapAngle(courseAtTrueTurn - radians(70))),
      ).toBeGreaterThan(radians(20));
    }

    for (let timeSeconds = 42; timeSeconds <= 100; timeSeconds += 2) {
      const observer = ownshipAt(timeSeconds);
      tracker.updateMeasurement(
        movingMeasurement(timeSeconds, targetAt(timeSeconds), observer, rateHz),
        observer,
      );
    }
    const rebuilt = tracker.activeTrack();
    expect(rebuilt?.motionLegs.length).toBeGreaterThan(1);
    expect(rebuilt?.currentMotionLegIndex).toBeGreaterThan(0);
    expect(rebuilt?.previousSolution).toBeDefined();
    expect(rebuilt?.motionLegs.at(-1)?.observations.length).toBeGreaterThan(4);
  });

  it("keeps one motion leg while constant target motion remains compatible", () => {
    const tracker = new ContactTracker();
    const trueClass = vesselClassById("los-angeles-flight-i");
    const rateHz = trueClass.propulsionRatePerKnot * 8;
    const firstOwnship = ownshipAt(0);
    const assignment = tracker.acquire(
      movingMeasurement(0, stableTargetAt(0), firstOwnship, rateHz),
      firstOwnship,
    );
    tracker.applyIdentification(assignment.contactTrackId, [1, 2, 4], 0);
    for (let timeSeconds = 2; timeSeconds <= 100; timeSeconds += 2) {
      const observer = ownshipAt(timeSeconds);
      tracker.updateMeasurement(
        movingMeasurement(
          timeSeconds,
          stableTargetAt(timeSeconds),
          observer,
          rateHz,
        ),
        observer,
      );
    }
    expect(tracker.activeTrack()?.motionLegs).toHaveLength(1);
    expect(tracker.activeTrack()?.possibleManeuver).toBe(false);
  });
});

function movingMeasurement(
  timeSeconds: number,
  target: Readonly<{ x: number; z: number }>,
  observer: OwnshipObservationState,
  rateHz: number,
): SanitizedSonarMeasurement {
  const worldBearingRad = bearingFrom(observer.position, target);
  return measurement(timeSeconds, {
    worldBearingRad,
    relativeBearingRad: wrapAngle(worldBearingRad - observer.courseRad),
    signalQuality: 0.9,
    observedPropulsionRateHz: rateHz,
  });
}

function ownshipAt(timeSeconds: number): OwnshipObservationState {
  const speedMps = 4;
  const worldSpeedMps = speedMps * GAMEPLAY_MOVEMENT_SCALE;
  if (timeSeconds <= 30) {
    return {
      position: { x: 0, z: -worldSpeedMps * timeSeconds },
      courseRad: 0,
      speedMps,
    };
  }
  const courseRad = radians(45);
  const elapsed = timeSeconds - 30;
  return {
    position: {
      x: Math.sin(courseRad) * worldSpeedMps * elapsed,
      z: -worldSpeedMps * 30 - Math.cos(courseRad) * worldSpeedMps * elapsed,
    },
    courseRad,
    speedMps,
  };
}

function targetAt(timeSeconds: number): Readonly<{ x: number; z: number }> {
  const speedMps = knotsToWorldMetersPerSecond(8);
  const initial = { x: 12_000, z: -10_000 };
  const firstCourse = radians(300);
  const turnTime = 40;
  const firstElapsed = Math.min(timeSeconds, turnTime);
  const turnPosition = {
    x: initial.x + Math.sin(firstCourse) * speedMps * firstElapsed,
    z: initial.z - Math.cos(firstCourse) * speedMps * firstElapsed,
  };
  if (timeSeconds <= turnTime) {
    return turnPosition;
  }
  const secondCourse = radians(70);
  const secondElapsed = timeSeconds - turnTime;
  return {
    x: turnPosition.x + Math.sin(secondCourse) * speedMps * secondElapsed,
    z: turnPosition.z - Math.cos(secondCourse) * speedMps * secondElapsed,
  };
}

function stableTargetAt(
  timeSeconds: number,
): Readonly<{ x: number; z: number }> {
  const speedMps = knotsToWorldMetersPerSecond(8);
  const course = radians(300);
  return {
    x: 12_000 + Math.sin(course) * speedMps * timeSeconds,
    z: -10_000 - Math.cos(course) * speedMps * timeSeconds,
  };
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
