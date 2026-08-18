import { knotsToWorldMetersPerSecond, type Vec2 } from "./NavalContactCatalog";

const TAU = Math.PI * 2;
const MINIMUM_SIGMA_RAD = radians(0.05);

export interface BearingObservation {
  readonly timeSeconds: number;
  readonly ownshipPosition: Vec2;
  readonly ownshipCourseRad: number;
  readonly ownshipSpeedMps: number;
  /** True/world bearing on the horizontal X/Z plane. */
  readonly bearingRad: number;
  readonly bearingSigmaRad: number;
  readonly signalQuality: number;
}

export interface TrackHypothesis {
  readonly initialRangeM: number;
  readonly targetCourseRad: number;
  readonly targetSpeedMps: number;
  readonly initialTargetPosition: Vec2;
  readonly currentPredictedPosition: Vec2;
  readonly score: number;
  readonly weight: number;
}

export interface TmaSolution {
  readonly hypotheses: readonly TrackHypothesis[];
  readonly best: TrackHypothesis | undefined;
  readonly firstObservationTimeSeconds: number;
  readonly solvedAtSeconds: number;
  readonly weightedSpreadMeters: number;
  /** RMS bearing mismatch normalized by each observation's sigma. */
  readonly fitResidual: number;
  /** Solver confidence only; never a probability that the target is here. */
  readonly confidence: number;
}

export interface TmaSolverConfig {
  readonly minimumRangeM: number;
  readonly maximumRangeM: number;
  readonly coarseRangeSamples: number;
  readonly courseStepDegrees: number;
  readonly retainedHypotheses: number;
  readonly refinementSeeds: number;
}

export const DEFAULT_TMA_SOLVER_CONFIG: TmaSolverConfig = Object.freeze({
  minimumRangeM: 2_000,
  maximumRangeM: 25_000,
  coarseRangeSamples: 28,
  courseStepDegrees: 5,
  retainedHypotheses: 600,
  refinementSeeds: 48,
});

interface ScoredHypothesis {
  readonly initialRangeM: number;
  readonly targetCourseRad: number;
  readonly targetSpeedMps: number;
  readonly initialTargetPosition: Vec2;
  readonly currentPredictedPosition: Vec2;
  readonly score: number;
}

/**
 * Deterministic grid solver. Its API intentionally has no target-truth input:
 * it can only reconstruct motion from ownship states, timestamped bearings,
 * their deterministic sigmas, and the acoustically assumed speed.
 */
export function solveTma(
  observations: readonly BearingObservation[],
  estimatedSpeedKt: number,
  config: TmaSolverConfig = DEFAULT_TMA_SOLVER_CONFIG,
): TmaSolution {
  if (observations.length === 0 || !Number.isFinite(estimatedSpeedKt)) {
    return {
      hypotheses: [],
      best: undefined,
      firstObservationTimeSeconds: observations.at(0)?.timeSeconds ?? 0,
      solvedAtSeconds: observations.at(-1)?.timeSeconds ?? 0,
      weightedSpreadMeters: 0,
      fitResidual: Number.POSITIVE_INFINITY,
      confidence: 0,
    };
  }

  const orderedObservations = [...observations].sort(
    (left, right) => left.timeSeconds - right.timeSeconds,
  );
  const first = orderedObservations[0];
  const last = orderedObservations.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error("TMA observations unexpectedly disappeared.");
  }

  const speedMps = knotsToWorldMetersPerSecond(Math.max(0, estimatedSpeedKt));
  const ranges = logarithmicSamples(
    config.minimumRangeM,
    config.maximumRangeM,
    config.coarseRangeSamples,
  );
  const courseStep = radians(config.courseStepDegrees);
  const coarse: ScoredHypothesis[] = [];
  for (const rangeM of ranges) {
    for (let course = 0; course < TAU - 1e-8; course += courseStep) {
      coarse.push(
        evaluateHypothesis(
          orderedObservations,
          rangeM,
          normalizePositiveAngle(course),
          speedMps,
        ),
      );
    }
  }
  if (orderedObservations.length === 1) {
    const unresolved = assignNormalizedWeights(
      evenlySample(coarse, config.retainedHypotheses),
    );
    return {
      hypotheses: unresolved,
      best: undefined,
      firstObservationTimeSeconds: first.timeSeconds,
      solvedAtSeconds: last.timeSeconds,
      weightedSpreadMeters: weightedPositionSpread(unresolved),
      fitResidual: Number.POSITIVE_INFINITY,
      confidence: 0,
    };
  }
  coarse.sort(compareHypotheses);

  const refined: ScoredHypothesis[] = [];
  const rangeMultipliers = [0.88, 0.95, 1, 1.05, 1.12] as const;
  const courseOffsets = [-courseStep / 2, 0, courseStep / 2] as const;
  for (const seed of coarse.slice(0, config.refinementSeeds)) {
    for (const rangeMultiplier of rangeMultipliers) {
      const rangeM = clamp(
        seed.initialRangeM * rangeMultiplier,
        config.minimumRangeM,
        config.maximumRangeM,
      );
      for (const courseOffset of courseOffsets) {
        refined.push(
          evaluateHypothesis(
            orderedObservations,
            rangeM,
            normalizePositiveAngle(seed.targetCourseRad + courseOffset),
            speedMps,
          ),
        );
      }
    }
  }

  const retained = deduplicateHypotheses([...coarse, ...refined])
    .sort(compareHypotheses)
    .slice(0, config.retainedHypotheses);
  const weighted = assignNormalizedWeights(retained);
  const best = observations.length >= 2 ? weighted[0] : undefined;
  const weightedSpreadMeters = weightedPositionSpread(weighted);
  const fitResidual =
    best === undefined
      ? Number.POSITIVE_INFINITY
      : normalizedFitResidual(best.score, orderedObservations.length);
  return {
    hypotheses: weighted,
    best,
    firstObservationTimeSeconds: first.timeSeconds,
    solvedAtSeconds: last.timeSeconds,
    weightedSpreadMeters,
    fitResidual,
    confidence: tmaConfidence(
      orderedObservations.length,
      fitResidual,
      weightedSpreadMeters,
    ),
  };
}

/** Residual of a new bearing against a frozen solution projection. */
export function observationResidualAgainstSolution(
  solution: TmaSolution,
  observation: BearingObservation,
): number {
  const hypothesis = solution.best;
  if (hypothesis === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  const elapsed = Math.max(
    0,
    observation.timeSeconds - solution.firstObservationTimeSeconds,
  );
  const predictedPosition = {
    x:
      hypothesis.initialTargetPosition.x +
      Math.sin(hypothesis.targetCourseRad) *
        hypothesis.targetSpeedMps *
        elapsed,
    z:
      hypothesis.initialTargetPosition.z -
      Math.cos(hypothesis.targetCourseRad) *
        hypothesis.targetSpeedMps *
        elapsed,
  };
  const sigma = Math.max(
    MINIMUM_SIGMA_RAD,
    Math.abs(observation.bearingSigmaRad),
  );
  return Math.abs(
    wrapAngle(
      bearingFrom(observation.ownshipPosition, predictedPosition) -
        observation.bearingRad,
    ) / sigma,
  );
}

export function projectHypothesisPosition(
  hypothesis: TrackHypothesis,
  solvedAtSeconds: number,
  timeSeconds: number,
): Vec2 {
  const elapsed = Math.max(0, timeSeconds - solvedAtSeconds);
  return {
    x:
      hypothesis.currentPredictedPosition.x +
      Math.sin(hypothesis.targetCourseRad) *
        hypothesis.targetSpeedMps *
        elapsed,
    z:
      hypothesis.currentPredictedPosition.z -
      Math.cos(hypothesis.targetCourseRad) *
        hypothesis.targetSpeedMps *
        elapsed,
  };
}

export function bearingFrom(observer: Vec2, target: Vec2): number {
  return normalizePositiveAngle(
    Math.atan2(target.x - observer.x, -(target.z - observer.z)),
  );
}

export function bearingDirection(bearingRad: number): Vec2 {
  return {
    x: Math.sin(bearingRad),
    z: -Math.cos(bearingRad),
  };
}

export function huberLoss(value: number, delta = 1.5): number {
  const absolute = Math.abs(value);
  return absolute <= delta
    ? 0.5 * absolute * absolute
    : delta * (absolute - 0.5 * delta);
}

export function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function evaluateHypothesis(
  observations: readonly BearingObservation[],
  initialRangeM: number,
  targetCourseRad: number,
  targetSpeedMps: number,
): ScoredHypothesis {
  const first = observations[0];
  const last = observations.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error("A TMA hypothesis requires at least one observation.");
  }
  const direction = bearingDirection(first.bearingRad);
  const initialTargetPosition = {
    x: first.ownshipPosition.x + direction.x * initialRangeM,
    z: first.ownshipPosition.z + direction.z * initialRangeM,
  };
  let score = 0;
  let currentPredictedPosition = initialTargetPosition;
  for (const observation of observations) {
    const elapsed = Math.max(0, observation.timeSeconds - first.timeSeconds);
    const predictedTargetPosition = {
      x:
        initialTargetPosition.x +
        Math.sin(targetCourseRad) * targetSpeedMps * elapsed,
      z:
        initialTargetPosition.z -
        Math.cos(targetCourseRad) * targetSpeedMps * elapsed,
    };
    const predictedBearing = bearingFrom(
      observation.ownshipPosition,
      predictedTargetPosition,
    );
    const sigma = Math.max(
      MINIMUM_SIGMA_RAD,
      Math.abs(observation.bearingSigmaRad),
    );
    score += huberLoss(
      wrapAngle(predictedBearing - observation.bearingRad) / sigma,
    );
    if (observation === last) {
      currentPredictedPosition = predictedTargetPosition;
    }
  }

  return {
    initialRangeM,
    targetCourseRad,
    targetSpeedMps,
    initialTargetPosition,
    currentPredictedPosition,
    score,
  };
}

function assignNormalizedWeights(
  hypotheses: readonly ScoredHypothesis[],
): readonly TrackHypothesis[] {
  const bestScore = hypotheses[0]?.score ?? 0;
  const rawWeights = hypotheses.map((hypothesis) =>
    Math.exp(-0.5 * Math.min(80, hypothesis.score - bestScore)),
  );
  const totalWeight = rawWeights.reduce((sum, weight) => sum + weight, 0) || 1;
  return hypotheses.map((hypothesis, index) => ({
    ...hypothesis,
    weight: (rawWeights[index] ?? 0) / totalWeight,
  }));
}

function weightedPositionSpread(
  hypotheses: readonly TrackHypothesis[],
): number {
  if (hypotheses.length === 0) {
    return 0;
  }
  let centroidX = 0;
  let centroidZ = 0;
  for (const hypothesis of hypotheses) {
    centroidX += hypothesis.currentPredictedPosition.x * hypothesis.weight;
    centroidZ += hypothesis.currentPredictedPosition.z * hypothesis.weight;
  }
  let variance = 0;
  for (const hypothesis of hypotheses) {
    const deltaX = hypothesis.currentPredictedPosition.x - centroidX;
    const deltaZ = hypothesis.currentPredictedPosition.z - centroidZ;
    variance += (deltaX * deltaX + deltaZ * deltaZ) * hypothesis.weight;
  }
  return Math.sqrt(Math.max(0, variance));
}

function deduplicateHypotheses(
  hypotheses: readonly ScoredHypothesis[],
): ScoredHypothesis[] {
  const unique = new Map<string, ScoredHypothesis>();
  for (const hypothesis of hypotheses) {
    const key = `${hypothesis.initialRangeM.toFixed(3)}:${hypothesis.targetCourseRad.toFixed(7)}`;
    const existing = unique.get(key);
    if (existing === undefined || hypothesis.score < existing.score) {
      unique.set(key, hypothesis);
    }
  }
  return [...unique.values()];
}

function logarithmicSamples(
  minimum: number,
  maximum: number,
  count: number,
): readonly number[] {
  const safeCount = Math.max(2, Math.round(count));
  const ratio = maximum / minimum;
  return Array.from({ length: safeCount }, (_, index) =>
    index === safeCount - 1
      ? maximum
      : minimum * Math.pow(ratio, index / (safeCount - 1)),
  );
}

function evenlySample<T>(values: readonly T[], count: number): readonly T[] {
  if (values.length <= count) {
    return values;
  }
  const sampleCount = Math.max(1, Math.round(count));
  return Array.from({ length: sampleCount }, (_, index) => {
    const sourceIndex = Math.min(
      values.length - 1,
      Math.floor((index * values.length) / sampleCount),
    );
    const value = values[sourceIndex];
    if (value === undefined) {
      throw new Error("Unable to sample the TMA hypothesis bank.");
    }
    return value;
  });
}

function compareHypotheses(
  left: ScoredHypothesis,
  right: ScoredHypothesis,
): number {
  return (
    left.score - right.score ||
    left.initialRangeM - right.initialRangeM ||
    left.targetCourseRad - right.targetCourseRad
  );
}

function normalizePositiveAngle(angle: number): number {
  return ((angle % TAU) + TAU) % TAU;
}

function normalizedFitResidual(
  score: number,
  observationCount: number,
): number {
  return Math.sqrt((2 * Math.max(0, score)) / Math.max(1, observationCount));
}

function tmaConfidence(
  observationCount: number,
  fitResidual: number,
  weightedSpreadMeters: number,
): number {
  if (!Number.isFinite(fitResidual) || observationCount < 2) {
    return 0;
  }
  const evidence = clamp((observationCount - 1) / 18, 0, 1);
  const compatibility = Math.exp(-Math.max(0, fitResidual - 0.65) * 0.72);
  const concentration = 1 / (1 + weightedSpreadMeters / 12_000);
  return clamp(evidence * compatibility * Math.sqrt(concentration), 0, 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
