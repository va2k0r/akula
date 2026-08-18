import type { AcousticCode } from "../audio";
import {
  estimatedSpeedKnots,
  resolveVesselClassHypothesis,
  vesselClassById,
  type Vec2,
} from "./NavalContactCatalog";
import {
  observationResidualAgainstSolution,
  solveTma,
  type BearingObservation,
  type TmaSolution,
} from "./TmaSolver";

export const CONTACT_OBSERVATION_INTERVAL_SECONDS = 0.4;
export const CONTACT_LOST_AFTER_SECONDS = 2.4;
export const MINIMUM_TRACKING_SIGNAL_QUALITY = 0.25;
export const PRE_ACQUISITION_HISTORY_SECONDS = 24;
export const PROPULSION_RATE_WINDOW_SECONDS = 2.4;
export const MANEUVER_RESIDUAL_THRESHOLD = 1.15;
export const MANEUVER_CONFIRM_OBSERVATION_COUNT = 5;
export const MINIMUM_MOTION_LEG_DURATION_SECONDS = 18;
export const NEW_LEG_OBSERVATION_WINDOW_SECONDS = 8;

const MINIMUM_NEW_LEG_OBSERVATIONS = 8;
const PREVIOUS_PROJECTION_HOLD_SECONDS = 55;

export type ContactTrackStatus = "HELD" | "WEAK" | "LOST";

export interface OwnshipObservationState {
  readonly position: Vec2;
  readonly courseRad: number;
  readonly speedMps: number;
}

/** Sensor output with all simulation-truth coordinates removed. */
export interface SanitizedSonarMeasurement {
  readonly sourceEntityId: string;
  readonly timeSeconds: number;
  readonly worldBearingRad: number;
  readonly relativeBearingRad: number;
  readonly signalQuality: number;
  readonly perceivable: boolean;
  /** Shared cycle rate measured from the existing acoustic voice. */
  readonly observedPropulsionRateHz: number;
}

export interface ContactIdentification {
  readonly signatureCode: AcousticCode;
  readonly guessedClassId: string;
  readonly guessedClassName: string;
  readonly estimatedSpeedKt: number;
  readonly appliedAtSeconds: number;
}

export interface ContactMotionLeg {
  readonly index: number;
  readonly startTimeSeconds: number;
  readonly endTimeSeconds: number | null;
  readonly observations: readonly BearingObservation[];
  readonly bestCourseRad: number | undefined;
  readonly bestInitialPosition: Vec2 | undefined;
  readonly averageEstimatedSpeedKt: number;
  readonly fitResidual: number;
  readonly confidence: number;
}

export interface ContactTrackSnapshot {
  readonly id: string;
  readonly number: number;
  readonly label: string;
  readonly active: boolean;
  readonly status: ContactTrackStatus;
  readonly observations: readonly BearingObservation[];
  readonly identification: ContactIdentification | undefined;
  readonly solution: TmaSolution | undefined;
  readonly previousSolution: TmaSolution | undefined;
  readonly previousSolutionExpiresAtSeconds: number;
  readonly motionLegs: readonly ContactMotionLeg[];
  readonly currentMotionLegIndex: number;
  readonly possibleManeuver: boolean;
  readonly fitResidual: number;
  readonly confidence: number;
  readonly lastSignalQuality: number;
  readonly lastObservationTimeSeconds: number;
}

export interface ContactAssignmentEvent {
  readonly type: "contact-assigned";
  readonly isNew: boolean;
  readonly reacquired: boolean;
  readonly sourceEntityId: string;
  readonly contactTrackId: string;
  readonly contactNumber: number;
  readonly bearingRad: number;
  readonly timeSeconds: number;
}

export interface ContactAcquisitionOptions {
  /** Acoustic signature recognized by the sonar crew at the acquisition cut. */
  readonly recognizedSignatureCode?: AcousticCode;
}

interface PropulsionRateSample {
  readonly timeSeconds: number;
  readonly rateHz: number;
  readonly quality: number;
}

interface PendingSonarHistory {
  readonly observations: BearingObservation[];
  readonly propulsionRateSamples: PropulsionRateSample[];
  nextObservationTimeSeconds: number;
}

interface MutableMotionLeg {
  readonly index: number;
  readonly startTimeSeconds: number;
  endTimeSeconds: number | null;
  readonly observations: BearingObservation[];
  solution: TmaSolution | undefined;
  averageEstimatedSpeedKt: number;
}

interface MutableContactTrack {
  readonly id: string;
  readonly sourceEntityId: string;
  readonly number: number;
  readonly observations: BearingObservation[];
  readonly propulsionRateSamples: PropulsionRateSample[];
  readonly motionLegs: MutableMotionLeg[];
  status: ContactTrackStatus;
  reacquisitionAvailable: boolean;
  identification: ContactIdentification | undefined;
  solution: TmaSolution | undefined;
  previousSolution: TmaSolution | undefined;
  previousSolutionExpiresAtSeconds: number;
  lastCompatibleSolution: TmaSolution | undefined;
  lastCompatibleSolutionAtSeconds: number;
  possibleManeuver: boolean;
  incompatibleObservationCount: number;
  lastCompatibilityResidual: number;
  lastSignalQuality: number;
  lastObservationTimeSeconds: number;
  lastMeasurementTimeSeconds: number;
  nextObservationTimeSeconds: number;
}

/**
 * Owns numbering, permanent source identity, loss/reacquisition, acoustic
 * speed estimation, deterministic bearing history, and motion-leg TMA.
 */
export class ContactTracker {
  private readonly tracks = new Map<string, MutableContactTrack>();
  private readonly sourceToTrackId = new Map<string, string>();
  private readonly pendingSonarHistories = new Map<
    string,
    PendingSonarHistory
  >();
  private nextContactNumber = 1;
  private activeTrackIdValue: string | undefined;
  private loggingEnabled = false;

  public setLoggingEnabled(enabled: boolean): void {
    this.loggingEnabled = enabled;
  }

  public get activeTrackId(): string | undefined {
    return this.activeTrackIdValue;
  }

  /** Permanent entity-to-track relation, including a lost track. */
  public hasSource(sourceEntityId: string): boolean {
    return this.sourceToTrackId.has(sourceEntityId);
  }

  /** New sources and lost sources must both pass through camera acquisition. */
  public requiresAcquisition(sourceEntityId: string): boolean {
    const trackId = this.sourceToTrackId.get(sourceEntityId);
    return (
      trackId === undefined || this.requireTrack(trackId).status === "LOST"
    );
  }

  public acquire(
    measurement: SanitizedSonarMeasurement,
    ownship: OwnshipObservationState,
    options: ContactAcquisitionOptions = {},
  ): ContactAssignmentEvent {
    const existingTrackId = this.sourceToTrackId.get(
      measurement.sourceEntityId,
    );
    if (existingTrackId !== undefined) {
      const existingTrack = this.requireTrack(existingTrackId);
      const reacquired = existingTrack.status === "LOST";
      this.activeTrackIdValue = existingTrack.id;
      if (reacquired) {
        existingTrack.status = "HELD";
        existingTrack.reacquisitionAvailable = false;
        const observation = createBearingObservation(measurement, ownship);
        existingTrack.observations.push(observation);
        this.recordRateSample(existingTrack, measurement);
        this.openNewMotionLeg(existingTrack, observation, true);
        existingTrack.lastObservationTimeSeconds = measurement.timeSeconds;
        existingTrack.lastMeasurementTimeSeconds = measurement.timeSeconds;
        existingTrack.nextObservationTimeSeconds =
          measurement.timeSeconds + CONTACT_OBSERVATION_INTERVAL_SECONDS;
        this.log(
          `[PLAYER_CONTACT] ЦЕЛЬ ${String(existingTrack.number)} REACQUIRED`,
        );
      }
      if (options.recognizedSignatureCode !== undefined) {
        this.identifyTrack(
          existingTrack,
          options.recognizedSignatureCode,
          measurement.timeSeconds,
        );
      }
      return {
        type: "contact-assigned",
        isNew: false,
        reacquired,
        sourceEntityId: measurement.sourceEntityId,
        contactTrackId: existingTrack.id,
        contactNumber: existingTrack.number,
        bearingRad: measurement.worldBearingRad,
        timeSeconds: measurement.timeSeconds,
      };
    }

    const number = this.nextContactNumber;
    this.nextContactNumber += 1;
    const id = `contact-${String(number)}`;
    const pendingHistory = this.pendingSonarHistories.get(
      measurement.sourceEntityId,
    );
    const currentObservation = createBearingObservation(measurement, ownship);
    const historyCutoff =
      measurement.timeSeconds - PRE_ACQUISITION_HISTORY_SECONDS;
    const observations = (pendingHistory?.observations ?? []).filter(
      ({ timeSeconds }) => timeSeconds >= historyCutoff,
    );
    const latestPending = observations.at(-1);
    if (
      latestPending !== undefined &&
      measurement.timeSeconds - latestPending.timeSeconds <
        CONTACT_OBSERVATION_INTERVAL_SECONDS
    ) {
      observations[observations.length - 1] = currentObservation;
    } else {
      observations.push(currentObservation);
    }
    const firstObservation = observations[0] ?? currentObservation;
    const firstLeg: MutableMotionLeg = {
      index: 0,
      startTimeSeconds: firstObservation.timeSeconds,
      endTimeSeconds: null,
      observations: [...observations],
      solution: undefined,
      averageEstimatedSpeedKt: 0,
    };
    const track: MutableContactTrack = {
      id,
      sourceEntityId: measurement.sourceEntityId,
      number,
      observations: [...observations],
      propulsionRateSamples: (pendingHistory?.propulsionRateSamples ?? [])
        .filter(
          ({ timeSeconds }) =>
            timeSeconds < measurement.timeSeconds - Number.EPSILON,
        )
        .map((sample) => ({ ...sample })),
      motionLegs: [firstLeg],
      status: "HELD",
      reacquisitionAvailable: false,
      identification: undefined,
      solution: undefined,
      previousSolution: undefined,
      previousSolutionExpiresAtSeconds: 0,
      lastCompatibleSolution: undefined,
      lastCompatibleSolutionAtSeconds: measurement.timeSeconds,
      possibleManeuver: false,
      incompatibleObservationCount: 0,
      lastCompatibilityResidual: 0,
      lastSignalQuality: measurement.signalQuality,
      lastObservationTimeSeconds: measurement.timeSeconds,
      lastMeasurementTimeSeconds: measurement.timeSeconds,
      nextObservationTimeSeconds:
        measurement.timeSeconds + CONTACT_OBSERVATION_INTERVAL_SECONDS,
    };
    this.recordRateSample(track, measurement);
    this.pendingSonarHistories.delete(measurement.sourceEntityId);
    this.tracks.set(id, track);
    this.sourceToTrackId.set(measurement.sourceEntityId, id);
    this.activeTrackIdValue = id;
    if (options.recognizedSignatureCode !== undefined) {
      this.identifyTrack(
        track,
        options.recognizedSignatureCode,
        measurement.timeSeconds,
      );
    }

    return {
      type: "contact-assigned",
      isNew: true,
      reacquired: false,
      sourceEntityId: measurement.sourceEntityId,
      contactTrackId: id,
      contactNumber: number,
      bearingRad: measurement.worldBearingRad,
      timeSeconds: measurement.timeSeconds,
    };
  }

  public updateMeasurement(
    measurement: SanitizedSonarMeasurement,
    ownship: OwnshipObservationState,
  ): void {
    const trackId = this.sourceToTrackId.get(measurement.sourceEntityId);
    if (trackId === undefined) {
      this.recordPendingMeasurement(measurement, ownship);
      return;
    }
    const track = this.requireTrack(trackId);
    const previousStatus = track.status;
    track.lastSignalQuality = measurement.signalQuality;
    track.lastMeasurementTimeSeconds = measurement.timeSeconds;
    if (track.status === "LOST") {
      track.reacquisitionAvailable = measurement.perceivable;
      return;
    }

    const trackable =
      measurement.perceivable &&
      measurement.signalQuality >= MINIMUM_TRACKING_SIGNAL_QUALITY;
    if (!trackable) {
      track.status = "WEAK";
      if (
        measurement.timeSeconds - track.lastObservationTimeSeconds >=
        CONTACT_LOST_AFTER_SECONDS
      ) {
        track.status = "LOST";
        track.reacquisitionAvailable = false;
        if (previousStatus !== "LOST") {
          this.log(
            `[PLAYER_CONTACT] ЦЕЛЬ ${String(track.number)} ${previousStatus} -> LOST`,
          );
        }
      }
      return;
    }

    track.status =
      measurement.signalQuality < MINIMUM_TRACKING_SIGNAL_QUALITY * 1.24
        ? "WEAK"
        : "HELD";
    if (measurement.timeSeconds + 1e-8 < track.nextObservationTimeSeconds) {
      return;
    }
    const observation = createBearingObservation(measurement, ownship);
    track.observations.push(observation);
    track.lastObservationTimeSeconds = measurement.timeSeconds;
    track.nextObservationTimeSeconds =
      measurement.timeSeconds + CONTACT_OBSERVATION_INTERVAL_SECONDS;
    this.recordRateSample(track, measurement);
    this.updateIdentificationSpeed(track, measurement.timeSeconds);
    this.updateMotionLeg(track, observation);
  }

  public applyIdentification(
    trackId: string,
    signatureCode: AcousticCode,
    timeSeconds: number,
  ): ContactTrackSnapshot {
    const track = this.requireTrack(trackId);
    this.identifyTrack(track, signatureCode, timeSeconds);
    this.activeTrackIdValue = trackId;
    return this.snapshot(track);
  }

  private identifyTrack(
    track: MutableContactTrack,
    signatureCode: AcousticCode,
    timeSeconds: number,
  ): void {
    const hypothesis = resolveVesselClassHypothesis(signatureCode);
    const estimatedSpeedKt = estimatedSpeedKnots(
      smoothedPropulsionRate(track.propulsionRateSamples),
      hypothesis.definition,
    );
    track.identification = {
      signatureCode: copyCode(signatureCode),
      guessedClassId: hypothesis.definition.id,
      guessedClassName: hypothesis.definition.displayName,
      estimatedSpeedKt,
      appliedAtSeconds: timeSeconds,
    };
    for (const leg of track.motionLegs) {
      leg.averageEstimatedSpeedKt = estimatedSpeedKt;
      leg.solution = solveTma(leg.observations, estimatedSpeedKt);
    }
    const currentLeg = currentMotionLeg(track);
    track.solution = currentLeg.solution;
    track.lastCompatibleSolution = track.solution;
    track.lastCompatibleSolutionAtSeconds = timeSeconds;
  }

  public selectTrack(trackId: string): ContactTrackSnapshot {
    const track = this.requireTrack(trackId);
    this.activeTrackIdValue = track.id;
    return this.snapshot(track);
  }

  public activeTrack(): ContactTrackSnapshot | undefined {
    return this.activeTrackIdValue === undefined
      ? undefined
      : this.snapshot(this.requireTrack(this.activeTrackIdValue));
  }

  public snapshots(): readonly ContactTrackSnapshot[] {
    return [...this.tracks.values()]
      .sort((left, right) => left.number - right.number)
      .map((track) => this.snapshot(track));
  }

  private updateMotionLeg(
    track: MutableContactTrack,
    observation: BearingObservation,
  ): void {
    const leg = currentMotionLeg(track);
    const identification = track.identification;
    if (identification === undefined) {
      leg.observations.push(observation);
      return;
    }

    const wasPossibleManeuver = track.possibleManeuver;
    const comparisonSolution = track.lastCompatibleSolution ?? track.solution;
    const legAge = observation.timeSeconds - leg.startTimeSeconds;
    if (
      comparisonSolution?.best !== undefined &&
      legAge >= MINIMUM_MOTION_LEG_DURATION_SECONDS
    ) {
      const residual = observationResidualAgainstSolution(
        comparisonSolution,
        observation,
      );
      track.lastCompatibilityResidual = residual;
      if (residual >= MANEUVER_RESIDUAL_THRESHOLD) {
        track.incompatibleObservationCount += 1;
      } else {
        track.incompatibleObservationCount = Math.max(
          0,
          track.incompatibleObservationCount - 2,
        );
      }
      track.possibleManeuver = track.incompatibleObservationCount >= 2;
      if (!wasPossibleManeuver && track.possibleManeuver) {
        this.log("[TMA] residual rising");
        this.log("[TMA] possible maneuver");
      }
    }

    leg.observations.push(observation);
    if (
      track.incompatibleObservationCount >= MANEUVER_CONFIRM_OBSERVATION_COUNT
    ) {
      this.openNewMotionLeg(track, observation, false);
      return;
    }
    if (
      leg.index > 0 &&
      leg.solution === undefined &&
      leg.observations.length < MINIMUM_NEW_LEG_OBSERVATIONS
    ) {
      return;
    }

    const nextSolution = solveTma(
      leg.observations,
      identification.estimatedSpeedKt,
    );
    leg.solution = nextSolution;
    leg.averageEstimatedSpeedKt = identification.estimatedSpeedKt;
    track.solution = nextSolution;
    const canRefreshCompatibleSolution =
      legAge < MINIMUM_MOTION_LEG_DURATION_SECONDS ||
      track.lastCompatibleSolution === undefined ||
      (observation.timeSeconds - track.lastCompatibleSolutionAtSeconds >= 12 &&
        track.lastCompatibilityResidual < 1.6);
    if (!track.possibleManeuver && canRefreshCompatibleSolution) {
      track.lastCompatibleSolution = nextSolution;
      track.lastCompatibleSolutionAtSeconds = observation.timeSeconds;
    }
  }

  private openNewMotionLeg(
    track: MutableContactTrack,
    latestObservation: BearingObservation,
    afterReacquisition: boolean,
  ): void {
    const previousLeg = currentMotionLeg(track);
    this.log(`[TMA] closing motion leg ${String(previousLeg.index)}`);
    previousLeg.endTimeSeconds = latestObservation.timeSeconds;
    track.previousSolution =
      track.lastCompatibleSolution ?? track.solution ?? previousLeg.solution;
    track.previousSolutionExpiresAtSeconds =
      latestObservation.timeSeconds + PREVIOUS_PROJECTION_HOLD_SECONDS;
    const cutoff =
      latestObservation.timeSeconds - NEW_LEG_OBSERVATION_WINDOW_SECONDS;
    const seedObservations = afterReacquisition
      ? [latestObservation]
      : previousLeg.observations
          .filter(({ timeSeconds }) => timeSeconds >= cutoff)
          .slice(-(MANEUVER_CONFIRM_OBSERVATION_COUNT - 1));
    const leg: MutableMotionLeg = {
      index: track.motionLegs.length,
      startTimeSeconds:
        seedObservations[0]?.timeSeconds ?? latestObservation.timeSeconds,
      endTimeSeconds: null,
      observations: [...seedObservations],
      solution: undefined,
      averageEstimatedSpeedKt: track.identification?.estimatedSpeedKt ?? 0,
    };
    track.motionLegs.push(leg);
    this.log(`[TMA] opening motion leg ${String(leg.index)}`);
    track.solution = track.previousSolution;
    track.lastCompatibleSolution = undefined;
    track.lastCompatibleSolutionAtSeconds = latestObservation.timeSeconds;
    track.incompatibleObservationCount = 0;
    track.lastCompatibilityResidual = 0;
    track.possibleManeuver = false;
  }

  private recordRateSample(
    track: MutableContactTrack,
    measurement: SanitizedSonarMeasurement,
  ): void {
    if (
      !Number.isFinite(measurement.observedPropulsionRateHz) ||
      measurement.observedPropulsionRateHz <= 0
    ) {
      return;
    }
    track.propulsionRateSamples.push({
      timeSeconds: measurement.timeSeconds,
      rateHz: measurement.observedPropulsionRateHz,
      quality: clamp(measurement.signalQuality, 0.05, 1),
    });
    const cutoff = measurement.timeSeconds - PROPULSION_RATE_WINDOW_SECONDS;
    while ((track.propulsionRateSamples[0]?.timeSeconds ?? cutoff) < cutoff) {
      track.propulsionRateSamples.shift();
    }
  }

  private recordPendingMeasurement(
    measurement: SanitizedSonarMeasurement,
    ownship: OwnshipObservationState,
  ): void {
    const existing = this.pendingSonarHistories.get(measurement.sourceEntityId);
    const cutoff = measurement.timeSeconds - PRE_ACQUISITION_HISTORY_SECONDS;
    if (existing !== undefined) {
      while ((existing.observations[0]?.timeSeconds ?? cutoff) < cutoff) {
        existing.observations.shift();
      }
      while (
        (existing.propulsionRateSamples[0]?.timeSeconds ?? cutoff) < cutoff
      ) {
        existing.propulsionRateSamples.shift();
      }
    }

    const trackable =
      measurement.perceivable &&
      measurement.signalQuality >= MINIMUM_TRACKING_SIGNAL_QUALITY;
    if (!trackable) {
      return;
    }

    const history =
      existing ??
      ({
        observations: [],
        propulsionRateSamples: [],
        nextObservationTimeSeconds: measurement.timeSeconds,
      } satisfies PendingSonarHistory);
    if (measurement.timeSeconds + 1e-8 < history.nextObservationTimeSeconds) {
      return;
    }

    history.observations.push(createBearingObservation(measurement, ownship));
    if (
      Number.isFinite(measurement.observedPropulsionRateHz) &&
      measurement.observedPropulsionRateHz > 0
    ) {
      history.propulsionRateSamples.push({
        timeSeconds: measurement.timeSeconds,
        rateHz: measurement.observedPropulsionRateHz,
        quality: clamp(measurement.signalQuality, 0.05, 1),
      });
    }
    history.nextObservationTimeSeconds =
      measurement.timeSeconds + CONTACT_OBSERVATION_INTERVAL_SECONDS;
    this.pendingSonarHistories.set(measurement.sourceEntityId, history);
  }

  private updateIdentificationSpeed(
    track: MutableContactTrack,
    timeSeconds: number,
  ): void {
    const identification = track.identification;
    if (identification === undefined) {
      return;
    }
    const guessedClass = vesselClassById(identification.guessedClassId);
    const estimatedSpeedKt = estimatedSpeedKnots(
      smoothedPropulsionRate(track.propulsionRateSamples),
      guessedClass,
    );
    track.identification = { ...identification, estimatedSpeedKt };
    const leg = currentMotionLeg(track);
    leg.averageEstimatedSpeedKt = estimatedSpeedKt;
    if (
      leg.observations.length >= MINIMUM_NEW_LEG_OBSERVATIONS &&
      track.solution === track.previousSolution
    ) {
      leg.solution = solveTma(leg.observations, estimatedSpeedKt);
      track.solution = leg.solution;
      track.lastCompatibleSolution = leg.solution;
      track.lastCompatibleSolutionAtSeconds = timeSeconds;
      if (timeSeconds >= track.previousSolutionExpiresAtSeconds) {
        track.previousSolution = undefined;
      }
    }
  }

  private requireTrack(trackId: string): MutableContactTrack {
    const track = this.tracks.get(trackId);
    if (track === undefined) {
      throw new Error(`Unknown contact track: ${trackId}`);
    }
    return track;
  }

  private snapshot(track: MutableContactTrack): ContactTrackSnapshot {
    const observationAge = Math.max(
      0,
      track.lastMeasurementTimeSeconds - track.lastObservationTimeSeconds,
    );
    const statusFactor =
      track.status === "LOST" ? 0.25 : track.status === "WEAK" ? 0.68 : 1;
    const maneuverFactor = track.possibleManeuver ? 0.42 : 1;
    const baseConfidence = track.solution?.confidence ?? 0;
    return {
      id: track.id,
      number: track.number,
      label: `ЦЕЛЬ ${String(track.number)}`,
      active: track.id === this.activeTrackIdValue,
      status: track.status,
      observations: track.observations,
      identification: track.identification,
      solution: track.solution,
      previousSolution:
        track.lastMeasurementTimeSeconds <=
        track.previousSolutionExpiresAtSeconds
          ? track.previousSolution
          : undefined,
      previousSolutionExpiresAtSeconds: track.previousSolutionExpiresAtSeconds,
      motionLegs: track.motionLegs.map((leg) => motionLegSnapshot(leg)),
      currentMotionLegIndex: track.motionLegs.length - 1,
      possibleManeuver: track.possibleManeuver,
      fitResidual:
        track.lastCompatibilityResidual ||
        track.solution?.fitResidual ||
        Number.POSITIVE_INFINITY,
      confidence:
        baseConfidence *
        statusFactor *
        maneuverFactor *
        Math.exp(-observationAge / 90),
      lastSignalQuality: track.lastSignalQuality,
      lastObservationTimeSeconds: track.lastObservationTimeSeconds,
    };
  }

  private log(message: string): void {
    if (this.loggingEnabled) {
      console.warn(message);
    }
  }
}

export function bearingSigmaForQuality(signalQuality: number): number {
  const quality = clamp(signalQuality, 0, 1);
  const sigmaDegrees = 0.1 + (1 - quality) ** 2 * 1.4;
  return (sigmaDegrees * Math.PI) / 180;
}

function createBearingObservation(
  measurement: SanitizedSonarMeasurement,
  ownship: OwnshipObservationState,
): BearingObservation {
  return {
    timeSeconds: measurement.timeSeconds,
    ownshipPosition: {
      x: ownship.position.x,
      z: ownship.position.z,
    },
    ownshipCourseRad: ownship.courseRad,
    ownshipSpeedMps: ownship.speedMps,
    bearingRad: measurement.worldBearingRad,
    bearingSigmaRad: bearingSigmaForQuality(measurement.signalQuality),
    signalQuality: clamp(measurement.signalQuality, 0, 1),
  };
}

function currentMotionLeg(track: MutableContactTrack): MutableMotionLeg {
  const leg = track.motionLegs.at(-1);
  if (leg === undefined) {
    throw new Error("A contact track must always own a motion leg.");
  }
  return leg;
}

function motionLegSnapshot(leg: MutableMotionLeg): ContactMotionLeg {
  return {
    index: leg.index,
    startTimeSeconds: leg.startTimeSeconds,
    endTimeSeconds: leg.endTimeSeconds,
    observations: leg.observations,
    bestCourseRad: leg.solution?.best?.targetCourseRad,
    bestInitialPosition: leg.solution?.best?.initialTargetPosition,
    averageEstimatedSpeedKt: leg.averageEstimatedSpeedKt,
    fitResidual: leg.solution?.fitResidual ?? Number.POSITIVE_INFINITY,
    confidence: leg.solution?.confidence ?? 0,
  };
}

function smoothedPropulsionRate(
  samples: readonly PropulsionRateSample[],
): number {
  if (samples.length === 0) {
    throw new RangeError("A contact needs an observed propulsion rate.");
  }
  const weighted = samples.reduce(
    (total, sample) => ({
      rate: total.rate + sample.rateHz * sample.quality,
      weight: total.weight + sample.quality,
    }),
    { rate: 0, weight: 0 },
  );
  return weighted.rate / Math.max(Number.EPSILON, weighted.weight);
}

function copyCode(code: AcousticCode): AcousticCode {
  return [code[0], code[1], code[2]];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
