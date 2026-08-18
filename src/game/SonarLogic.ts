import { clamp, terrainHeightAt } from "./WorldGeometry";
import {
  FROSTBITE_TEST_CONTACT,
  type VesselClassDefinition,
  vesselPositionAt,
} from "./NavalContactCatalog";
import { MAP_HALF_LENGTH, MAP_HALF_WIDTH } from "./WorldGeometry";
import { CONTACT_AUDIO_MINIMUM_SIGNAL_QUALITY } from "./ContactSensoryProgression";

export interface WorldPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SonarSolution {
  readonly rangeMeters: number;
  readonly relativeBearing: number;
  readonly signalQuality: number;
}

export interface PassiveSonarMeasurement {
  readonly worldBearingRad: number;
  readonly relativeBearingRad: number;
  readonly signalQuality: number;
  readonly perceivable: boolean;
  readonly inBlindCone: boolean;
  readonly environmentMasked: boolean;
}

export interface PassiveSonarSimulationResult {
  /** Only simulation and opt-in TMA debug may inspect this field. */
  readonly truth: Readonly<{ rangeMeters: number }>;
  /** Safe boundary for UI, ContactTrack, and TMA. */
  readonly measurement: PassiveSonarMeasurement;
}

export interface VesselAcousticState {
  readonly position: WorldPoint;
  readonly headingRad: number;
  readonly speedKt: number;
  readonly accelerationKtPerSec: number;
  readonly turnRateDegPerSec: number;
}

export interface VesselPassiveSonarResult extends PassiveSonarSimulationResult {
  readonly acoustics: Readonly<{
    readonly sourceLevel: number;
    readonly aspectGain: number;
    readonly propagationLoss: number;
    readonly listenerSelfNoise: number;
    readonly occlusionLoss: number;
    readonly receivedSignal: number;
    readonly cavitating: boolean;
  }>;
}

export const DEBUG_SENSOR_RANGE_MULTIPLIER = 100;
export const PASSIVE_SONAR_CLOSE_GAIN_START_METERS = 8_000;
export const PASSIVE_SONAR_CLOSE_GAIN_FULL_METERS = 500;
export const PASSIVE_SONAR_MAXIMUM_CLOSE_GAIN = 3.2;
export const PASSIVE_SONAR_CLOSE_GAIN_FULL_SOURCE_LEVEL = 0.34;
export const PASSIVE_SONAR_CLOSE_GAIN_FADE_SOURCE_LEVEL = 0.5;

export function contactPositionAt(elapsedSeconds: number): WorldPoint {
  const position = vesselPositionAt(FROSTBITE_TEST_CONTACT, elapsedSeconds);
  return { x: position.x, y: -92, z: position.z };
}

export function simulatePassiveSonar(
  observer: WorldPoint,
  observerHeading: number,
  observerSpeedMetersPerSecond: number,
  contact: WorldPoint,
  propulsionStopped = false,
  sourceRadiatedNoise = 1,
  sensorRangeMultiplier = 1,
): PassiveSonarSimulationResult {
  const deltaX = contact.x - observer.x;
  const deltaY = contact.y - observer.y;
  const deltaZ = contact.z - observer.z;
  const horizontalRangeMeters = Math.hypot(deltaX, deltaZ);
  const rangeMeters = Math.hypot(horizontalRangeMeters, deltaY);
  const effectiveHorizontalRangeMeters =
    horizontalRangeMeters /
    normalizeSensorRangeMultiplier(sensorRangeMultiplier);
  const worldBearingRad = normalizePositiveAngle(Math.atan2(deltaX, -deltaZ));
  const relativeBearingRad = normalizeAngle(worldBearingRad - observerHeading);
  const rangeFactor = clamp(
    1 - (effectiveHorizontalRangeMeters - 5_000) / 45_000,
    0.08,
    1,
  );
  const signalCleanliness = propulsionStopped
    ? 1
    : clamp(1 - Math.abs(observerSpeedMetersPerSecond) / 26, 0.45, 1);
  const canyonClearance = clamp(
    (observer.y - terrainHeightAt(observer.x, observer.z)) / 50,
    0,
    1,
  );
  const environmentTransmission = 0.72 + canyonClearance * 0.28;
  const depthCompatibility = clamp(1 - Math.abs(deltaY) / 520, 0.48, 1);
  const sourceAudibility = clamp(sourceRadiatedNoise, 0.25, 1.4);
  const closeRangeGain = passiveSonarCloseRangeGain(
    effectiveHorizontalRangeMeters,
    sourceAudibility,
  );
  const physicalSignalQuality = clamp(
    0.1 +
      rangeFactor *
        signalCleanliness *
        depthCompatibility *
        environmentTransmission *
        sourceAudibility *
        closeRangeGain,
    0.06,
    1,
  );
  // The x100 switch is an explicit debug sensor, not a second physical sonar
  // model. Besides extending falloff, drive any otherwise valid return toward
  // full-scale so the ring and acquisition channels visibly stress-test. The
  // baffle and environmental masks below remain authoritative.
  const debugGain =
    1 - 1 / normalizeSensorRangeMultiplier(sensorRangeMultiplier);
  const signalQuality = clamp(
    physicalSignalQuality + (1 - physicalSignalQuality) * debugGain,
    0.06,
    1,
  );
  const inBlindCone = Math.abs(relativeBearingRad) >= radians(135);
  const environmentMasked =
    environmentTransmission < 0.76 && signalQuality < 0.2;
  return {
    truth: { rangeMeters },
    measurement: {
      worldBearingRad,
      relativeBearingRad,
      signalQuality,
      perceivable:
        signalQuality >= CONTACT_AUDIO_MINIMUM_SIGNAL_QUALITY &&
        !inBlindCone &&
        !environmentMasked,
      inBlindCone,
      environmentMasked,
    },
  };
}

/**
 * Movement-coupled passive return used by both sides of the hunt.  The
 * controller consuming this result receives only the measurement; truth and
 * the diagnostic terms stay at the simulation/debug boundary.
 */
export function simulateVesselPassiveSonar(
  listener: WorldPoint,
  listenerHeadingRad: number,
  listenerSpeedMetersPerSecond: number,
  source: VesselAcousticState,
  sourceClass: VesselClassDefinition,
  listenerPropulsionStopped = false,
  sensorRangeMultiplier = 1,
): VesselPassiveSonarResult {
  const effectiveRangeMultiplier = normalizeSensorRangeMultiplier(
    sensorRangeMultiplier,
  );
  const deltaX = listener.x - source.position.x;
  const deltaZ = listener.z - source.position.z;
  const listenerBearingFromSource = normalizePositiveAngle(
    Math.atan2(deltaX, -deltaZ),
  );
  const sourceAspectRad = normalizeAngle(
    listenerBearingFromSource - source.headingRad,
  );
  const sternAmount = (1 - Math.cos(sourceAspectRad)) * 0.5;
  const aspectGain = 0.78 + sternAmount * 0.36;
  const sourceLevel = vesselSourceLevel(source, sourceClass);
  const occlusionLoss = terrainOcclusionLoss(listener, source.position);
  const transmission = Math.max(0.2, 1 - occlusionLoss);
  const simulation = simulatePassiveSonar(
    listener,
    listenerHeadingRad,
    listenerSpeedMetersPerSecond,
    source.position,
    listenerPropulsionStopped,
    sourceLevel * aspectGain * transmission,
    effectiveRangeMultiplier,
  );
  const listenerSelfNoise = listenerPropulsionStopped
    ? 0
    : clamp(Math.abs(listenerSpeedMetersPerSecond) / 18, 0, 1);
  const rangeKilometers = Math.max(
    0.1,
    simulation.truth.rangeMeters / effectiveRangeMultiplier / 1_000,
  );
  const propagationLoss = 0.12 + Math.log10(rangeKilometers + 1) * 0.34;
  const receivedSignal =
    sourceLevel +
    (aspectGain - 1) -
    propagationLoss -
    listenerSelfNoise * 0.34 -
    occlusionLoss;
  const perceivable =
    simulation.measurement.signalQuality >=
      CONTACT_AUDIO_MINIMUM_SIGNAL_QUALITY &&
    !simulation.measurement.inBlindCone &&
    !simulation.measurement.environmentMasked;

  return {
    truth: simulation.truth,
    measurement: {
      ...simulation.measurement,
      perceivable,
      environmentMasked:
        simulation.measurement.environmentMasked || occlusionLoss >= 0.58,
    },
    acoustics: {
      sourceLevel,
      aspectGain,
      propagationLoss,
      listenerSelfNoise,
      occlusionLoss,
      receivedSignal,
      cavitating: source.speedKt >= sourceClass.cavitationThresholdKt,
    },
  };
}

/**
 * The former quality curve stopped increasing inside five kilometres. This
 * received-signal gain restores the missing close-range part of propagation:
 * source level is unchanged, while an equally noisy contact keeps becoming
 * cleaner as the listener closes from 8 km to 500 m.
 */
export function passiveSonarCloseRangeGain(
  effectiveHorizontalRangeMeters: number,
  sourceAudibility = 0.25,
): number {
  if (!Number.isFinite(effectiveHorizontalRangeMeters)) {
    return 1;
  }
  const proximity = clamp(
    (PASSIVE_SONAR_CLOSE_GAIN_START_METERS -
      Math.max(0, effectiveHorizontalRangeMeters)) /
      (PASSIVE_SONAR_CLOSE_GAIN_START_METERS -
        PASSIVE_SONAR_CLOSE_GAIN_FULL_METERS),
    0,
    1,
  );
  const easedProximity = proximity * proximity * (3 - 2 * proximity);
  const sourceLevelProgress = clamp(
    (sourceAudibility - PASSIVE_SONAR_CLOSE_GAIN_FULL_SOURCE_LEVEL) /
      (PASSIVE_SONAR_CLOSE_GAIN_FADE_SOURCE_LEVEL -
        PASSIVE_SONAR_CLOSE_GAIN_FULL_SOURCE_LEVEL),
    0,
    1,
  );
  const easedSourceLevel =
    sourceLevelProgress * sourceLevelProgress * (3 - 2 * sourceLevelProgress);
  // Quiet machinery needs the receiver's close-range gain to remain legible;
  // already loud returns retain headroom instead of clipping every distinction
  // to quality 1 at short range.
  const weakSourceGainAmount = 1 - easedSourceLevel;
  return (
    1 +
    easedProximity *
      (PASSIVE_SONAR_MAXIMUM_CLOSE_GAIN - 1) *
      weakSourceGainAmount
  );
}

export function vesselSourceLevel(
  source: Pick<
    VesselAcousticState,
    "speedKt" | "accelerationKtPerSec" | "turnRateDegPerSec"
  >,
  sourceClass: VesselClassDefinition,
): number {
  const speedKt = Math.max(0, source.speedKt);
  const speedFraction = clamp(
    speedKt / Math.max(1, sourceClass.maxOperationalSpeedKt),
    0,
    1.4,
  );
  const speedNoise = speedKt * 0.014 + speedFraction * speedFraction * 0.42;
  const accelerationNoise =
    clamp(
      Math.abs(source.accelerationKtPerSec) /
        Math.max(0.05, sourceClass.accelerationKtPerSec),
      0,
      2,
    ) * 0.13;
  const maneuverNoise =
    clamp(
      Math.abs(source.turnRateDegPerSec) /
        Math.max(0.1, sourceClass.maxTurnRateDegPerSec),
      0,
      1.5,
    ) * 0.09;
  const cavitationNoise =
    speedKt < sourceClass.cavitationThresholdKt
      ? 0
      : 0.48 +
        clamp(
          (speedKt - sourceClass.cavitationThresholdKt) /
            Math.max(
              1,
              sourceClass.maxOperationalSpeedKt -
                sourceClass.cavitationThresholdKt,
            ),
          0,
          1,
        ) *
          0.42;
  return clamp(
    sourceClass.baseRadiatedNoise +
      speedNoise +
      accelerationNoise +
      maneuverNoise +
      cavitationNoise,
    0.08,
    2.2,
  );
}

export function solvePassiveSonar(
  observer: WorldPoint,
  observerHeading: number,
  observerSpeedMetersPerSecond: number,
  contact: WorldPoint,
  propulsionStopped = false,
  sourceRadiatedNoise = 1,
): SonarSolution {
  const result = simulatePassiveSonar(
    observer,
    observerHeading,
    observerSpeedMetersPerSecond,
    contact,
    propulsionStopped,
    sourceRadiatedNoise,
  );
  return {
    rangeMeters: result.truth.rangeMeters,
    relativeBearing: result.measurement.relativeBearingRad,
    signalQuality: result.measurement.signalQuality,
  };
}

export function formatBearing(radians: number): string {
  const degrees = Math.round((radians * 180) / Math.PI);
  if (Math.abs(degrees) < 1) {
    return "000";
  }
  const absolute = String(Math.abs(degrees)).padStart(3, "0");
  return `${degrees < 0 ? "P" : "S"} ${absolute}`;
}

export function formatCircularBearing(radians: number): string {
  const roundedDegrees = Math.round((radians * 180) / Math.PI);
  const normalizedDegrees = ((roundedDegrees % 360) + 360) % 360;
  return String(normalizedDegrees).padStart(3, "0");
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function normalizePositiveAngle(angle: number): number {
  const tau = Math.PI * 2;
  return ((angle % tau) + tau) % tau;
}

function normalizeSensorRangeMultiplier(multiplier: number): number {
  return Number.isFinite(multiplier) && multiplier > 1 ? multiplier : 1;
}

function terrainOcclusionLoss(
  listener: WorldPoint,
  source: WorldPoint,
): number {
  let obstructedSamples = 0;
  let localSamples = 0;
  for (let index = 1; index <= 7; index += 1) {
    const amount = index / 8;
    const x = listener.x + (source.x - listener.x) * amount;
    const z = listener.z + (source.z - listener.z) * amount;
    if (Math.abs(x) > MAP_HALF_WIDTH || Math.abs(z) > MAP_HALF_LENGTH) {
      continue;
    }
    localSamples += 1;
    const acousticRayY = listener.y + (source.y - listener.y) * amount;
    if (acousticRayY <= terrainHeightAt(x, z) + 12) {
      obstructedSamples += 1;
    }
  }
  if (localSamples === 0 || obstructedSamples === 0) {
    return 0;
  }
  return clamp((obstructedSamples / localSamples) * 0.72, 0, 0.72);
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
