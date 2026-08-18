import { describe, expect, it } from "vitest";
import {
  strategicBearingHistorySamples,
  strategicBearingLineOpacity,
  strategicDevelopmentEnemyMarker,
  strategicDisplayHeading,
  strategicPlotHalfSpanMeters,
  strategicPlotWorldToCanvas,
  strategicRecommendedViewSpanMeters,
  strategicTmaArrowOpacity,
  strategicTmaPoseFollowAmount,
  strategicTmaSampleIntervalSeconds,
  strategicTorpedoMarkerMoved,
  strategicTrackHistory,
  strategicViewTransformChanged,
  type StrategicPlotFrame,
} from "../src/game/StrategicPlot";
import type { ContactTrackSnapshot } from "../src/game/ContactTracker";
import type {
  BearingObservation,
  TmaSolution,
  TrackHypothesis,
} from "../src/game/TmaSolver";
import { bearingFrom } from "../src/game/TmaSolver";

const EMPTY_FRAME: StrategicPlotFrame = {
  ownship: {
    position: { x: 100, z: -50 },
    headingRad: 0,
  },
  tracks: [],
  timeSeconds: 0,
};

describe("strategic bearing-only plot", () => {
  it("keeps ownship centred with north at the top", () => {
    const center = strategicPlotWorldToCanvas(
      EMPTY_FRAME.ownship.position,
      EMPTY_FRAME.ownship.position,
      1_000,
      1_000,
      600,
    );
    const north = strategicPlotWorldToCanvas(
      { x: 100, z: -150 },
      EMPTY_FRAME.ownship.position,
      1_000,
      1_000,
      600,
    );
    const east = strategicPlotWorldToCanvas(
      { x: 200, z: -50 },
      EMPTY_FRAME.ownship.position,
      1_000,
      1_000,
      600,
    );

    expect(center).toEqual({ x: 500, y: 300 });
    expect(north.y).toBeLessThan(center.y);
    expect(east.x).toBeGreaterThan(center.x);
  });

  it("uses a broad default before any range hypothesis exists", () => {
    expect(strategicPlotHalfSpanMeters(EMPTY_FRAME)).toBe(30_000);
  });

  it("clamps camera-provided plot spans to usable strategic bounds", () => {
    expect(
      strategicPlotHalfSpanMeters({
        ...EMPTY_FRAME,
        viewHalfSpanMeters: 100,
      }),
    ).toBe(220);
    expect(
      strategicPlotHalfSpanMeters({
        ...EMPTY_FRAME,
        viewHalfSpanMeters: 120_000,
      }),
    ).toBe(85_000);
  });

  it("reduces dense bearing history to nine meaningful time samples", () => {
    const observations = Array.from({ length: 101 }, (_, timeSeconds) =>
      bearingObservation(timeSeconds),
    );

    expect(
      strategicBearingHistorySamples(observations).map(
        ({ timeSeconds }) => timeSeconds,
      ),
    ).toEqual([0, 13, 25, 38, 50, 63, 75, 88, 100]);
  });

  it("intersects historical bearings with one estimated contact track", () => {
    const observations = [
      observationToward(0, { x: 0, z: 0 }, { x: 10_000, z: -6_000 }),
      observationToward(1, { x: 2_000, z: -1_000 }, { x: 10_000, z: -8_000 }),
      observationToward(2, { x: 4_000, z: -2_000 }, { x: 10_000, z: -10_000 }),
    ];
    const history = strategicTrackHistory(TEST_SOLUTION, observations, 0);

    expect(history).toBeDefined();
    expect(history?.currentPosition).toEqual({ x: 10_000, z: -8_000 });
    expect(history?.courseRad).toBeCloseTo(0);
    expect(history?.intersections).toHaveLength(3);
    expect(history?.intersections.map(({ position }) => position.x)).toEqual([
      10_000, 10_000, 10_000,
    ]);
    expect(
      history?.intersections.map(({ position }) => Math.round(position.z)),
    ).toEqual([-6_000, -8_000, -10_000]);
    expect(
      history?.intersections.map(({ distanceAlongTrackMeters }) =>
        Math.round(distanceAlongTrackMeters),
      ),
    ).toEqual([-2_000, 0, 2_000]);
  });

  it("makes a converged estimated track more visible than a wide one", () => {
    const observations = [
      observationToward(0, { x: 0, z: 0 }, { x: 10_000, z: -6_000 }),
      observationToward(1, { x: 2_000, z: -1_000 }, { x: 10_000, z: -8_000 }),
      observationToward(2, { x: 4_000, z: -2_000 }, { x: 10_000, z: -10_000 }),
    ];
    const converged = strategicTrackHistory(TEST_SOLUTION, observations, 0);
    const wide = strategicTrackHistory(
      { ...TEST_SOLUTION, weightedSpreadMeters: 12_000, confidence: 0.08 },
      observations,
      0,
    );

    expect(converged?.confidence).toBeGreaterThan(wide?.confidence ?? 1);
    expect(converged?.confidence).toBeLessThanOrEqual(1);
    expect(wide?.confidence).toBeGreaterThanOrEqual(0);
  });

  it("fades hairline bearings strongly and monotonically with age", () => {
    const oldest = strategicBearingLineOpacity(0, 1, true);
    const middle = strategicBearingLineOpacity(0.5, 1, true);
    const newest = strategicBearingLineOpacity(1, 1, true);

    expect(oldest).toBeLessThan(0.03);
    expect(middle).toBeGreaterThan(oldest);
    expect(newest).toBeGreaterThan(middle);
    expect(strategicBearingLineOpacity(1, 1, false)).toBeLessThan(newest);
  });

  it("keeps the dotted course arrow faint until confidence is very high", () => {
    expect(strategicTmaArrowOpacity(0.8)).toBeLessThan(0.05);
    expect(strategicTmaArrowOpacity(0.9)).toBeGreaterThan(0.5);
    expect(strategicTmaArrowOpacity(0.95)).toBeGreaterThan(0.8);
  });

  it("samples the TMA pose slowly, then follows faster while the marker moves", () => {
    expect(strategicTmaSampleIntervalSeconds(false)).toBeGreaterThan(1);
    expect(strategicTmaSampleIntervalSeconds(true)).toBeLessThan(0.4);
    expect(strategicTmaPoseFollowAmount(1, true)).toBeGreaterThan(
      strategicTmaPoseFollowAmount(1, false),
    );
  });

  it("recommends a useful entry frame around ownship and the estimated track", () => {
    const span = strategicRecommendedViewSpanMeters({
      ...EMPTY_FRAME,
      ownship: { position: { x: 0, z: 0 }, headingRad: 0 },
      tracks: [TEST_TRACK],
    });

    expect(span).toBeGreaterThan(25_000);
    expect(span).toBeLessThan(40_000);
  });
});

describe("strategic plot camera alignment", () => {
  it("rotates world positions with the live top-down camera", () => {
    const east = strategicPlotWorldToCanvas(
      { x: 100, z: 0 },
      { x: 0, z: 0 },
      100,
      200,
      200,
      Math.PI / 2,
    );

    expect(east.x).toBeCloseTo(100);
    expect(east.y).toBeCloseTo(0);
  });

  it("keeps ownship heading aligned with the 3D marker", () => {
    expect(strategicDisplayHeading(Math.PI / 2, Math.PI / 4)).toBeCloseTo(
      Math.PI / 4,
    );
    expect(strategicDisplayHeading(0, Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
  });

  it("redraws camera motion immediately but retains settled plot cadence", () => {
    const nextTime = { ...EMPTY_FRAME, timeSeconds: 0.1 };
    expect(strategicViewTransformChanged(EMPTY_FRAME, nextTime)).toBe(false);
    expect(
      strategicViewTransformChanged(EMPTY_FRAME, {
        ...nextTime,
        viewHalfSpanMeters: 18_100,
      }),
    ).toBe(true);
    expect(
      strategicViewTransformChanged(EMPTY_FRAME, {
        ...nextTime,
        viewYawRad: 0.01,
      }),
    ).toBe(true);
    expect(
      strategicViewTransformChanged(EMPTY_FRAME, {
        ...nextTime,
        torpedoPlan: {
          status: "placing",
          enablePoint: { x: 2_000, z: -4_000 },
        },
      }),
    ).toBe(true);
    expect(
      strategicViewTransformChanged(EMPTY_FRAME, {
        ...nextTime,
        torpedoPlans: [
          {
            status: "confirmed",
            enablePoint: { x: 2_000, z: -4_000 },
          },
        ],
      }),
    ).toBe(true);
    const targetPrediction = {
      trackId: "contact-1",
      trackLabel: "ЦЕЛЬ 1",
      currentPosition: { x: 1_000, z: -2_000 },
      predictedPosition: { x: 1_500, z: -3_000 },
      travelTimeSeconds: 250,
      markerSeparationMeters: 400,
      selectionMode: "automatic" as const,
      candidateIndex: 1,
      candidateCount: 2,
    };
    const targetingFrame: StrategicPlotFrame = {
      ...nextTime,
      torpedoTargetPrediction: targetPrediction,
    };
    expect(strategicViewTransformChanged(EMPTY_FRAME, targetingFrame)).toBe(
      true,
    );
    expect(
      strategicViewTransformChanged(targetingFrame, {
        ...targetingFrame,
        torpedoTargetPrediction: {
          ...targetPrediction,
          trackId: "contact-2",
          trackLabel: "ЦЕЛЬ 2",
          candidateIndex: 2,
          selectionMode: "manual",
        },
      }),
    ).toBe(true);
  });

  it("detects only active torpedo-marker motion for adaptive TMA sampling", () => {
    const placingFrame: StrategicPlotFrame = {
      ...EMPTY_FRAME,
      torpedoPlan: {
        status: "placing",
        enablePoint: { x: 2_000, z: -4_000 },
      },
    };

    expect(strategicTorpedoMarkerMoved(EMPTY_FRAME, placingFrame)).toBe(true);
    expect(strategicTorpedoMarkerMoved(placingFrame, placingFrame)).toBe(false);
    expect(
      strategicTorpedoMarkerMoved(placingFrame, {
        ...placingFrame,
        torpedoPlan: {
          status: "placing",
          enablePoint: { x: 2_000.1, z: -4_000 },
        },
      }),
    ).toBe(true);
    expect(
      strategicTorpedoMarkerMoved(placingFrame, {
        ...placingFrame,
        torpedoPlan: {
          status: "confirmed",
          enablePoint: { x: 2_100, z: -4_000 },
        },
      }),
    ).toBe(false);
  });
});

describe("strategic development enemy marker", () => {
  it("plots exact enemy truth when it is inside the strategic view", () => {
    const marker = strategicDevelopmentEnemyMarker(
      EMPTY_FRAME,
      { x: 10_100, z: -50 },
      30_000,
      1_000,
      600,
      30,
    );

    expect(marker.offPlot).toBe(false);
    expect(marker.point).toEqual({ x: 600, y: 300 });
  });

  it("pins an enemy outside the camera view to a visible edge marker", () => {
    const marker = strategicDevelopmentEnemyMarker(
      EMPTY_FRAME,
      { x: 100_100, z: -100_050 },
      30_000,
      1_000,
      600,
      30,
    );

    expect(marker.offPlot).toBe(true);
    expect(marker.point.x).toBeCloseTo(770);
    expect(marker.point.y).toBeCloseTo(30);
    expect(marker.directionRad).toBeCloseTo(Math.PI / 4);
  });
});

const TEST_HYPOTHESES: readonly TrackHypothesis[] = [
  hypothesis(9_000, -8_000, 0.25),
  hypothesis(10_000, -8_000, 0.5),
  hypothesis(11_000, -8_000, 0.25),
];

const TEST_SOLUTION: TmaSolution = {
  hypotheses: TEST_HYPOTHESES,
  best: TEST_HYPOTHESES[1],
  firstObservationTimeSeconds: 0,
  solvedAtSeconds: 0,
  weightedSpreadMeters: 500,
  fitResidual: 0.4,
  confidence: 0.78,
};

const TEST_TRACK: ContactTrackSnapshot = {
  id: "contact-1",
  number: 1,
  label: "ЦЕЛЬ 1",
  active: true,
  status: "HELD",
  observations: [bearingObservation(0)],
  identification: {
    signatureCode: [1, 2, 4],
    guessedClassId: "project-671rtm-victor-iii",
    guessedClassName: "Project 671RTM Victor III",
    estimatedSpeedKt: 8,
    appliedAtSeconds: 0,
  },
  solution: TEST_SOLUTION,
  previousSolution: undefined,
  previousSolutionExpiresAtSeconds: 0,
  motionLegs: [],
  currentMotionLegIndex: 0,
  possibleManeuver: false,
  fitResidual: 0,
  confidence: 0.8,
  lastSignalQuality: 0.8,
  lastObservationTimeSeconds: 0,
};

function hypothesis(x: number, z: number, weight: number): TrackHypothesis {
  return {
    initialRangeM: Math.hypot(x, z),
    targetCourseRad: 0,
    targetSpeedMps: 4,
    initialTargetPosition: { x, z },
    currentPredictedPosition: { x, z },
    score: 0,
    weight,
  };
}

function bearingObservation(timeSeconds: number): BearingObservation {
  return {
    timeSeconds,
    ownshipPosition: { x: 0, z: -timeSeconds * 4 },
    ownshipCourseRad: 0,
    ownshipSpeedMps: 4,
    bearingRad: Math.PI / 4,
    bearingSigmaRad: 0.01,
    signalQuality: 0.8,
  };
}

function observationToward(
  timeSeconds: number,
  ownshipPosition: Readonly<{ x: number; z: number }>,
  targetPosition: Readonly<{ x: number; z: number }>,
): BearingObservation {
  return {
    timeSeconds,
    ownshipPosition,
    ownshipCourseRad: 0,
    ownshipSpeedMps: 4,
    bearingRad: bearingFrom(ownshipPosition, targetPosition),
    bearingSigmaRad: 0.01,
    signalQuality: 0.8,
  };
}
