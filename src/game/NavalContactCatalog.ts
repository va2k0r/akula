import type { AcousticCode } from "../audio";

export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

export type VesselFaction = "USSR" | "NATO" | "CIVILIAN";

export interface VesselClassDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly faction: VesselFaction;
  readonly signatureCode: AcousticCode;
  readonly audioProfileId: string;
  /** Shared acoustic-cycle rate in hertz produced by one knot. */
  readonly propulsionRatePerKnot: number;
  readonly minOperationalSpeedKt: number;
  readonly maxOperationalSpeedKt: number;
  readonly quietSpeedKt: number;
  readonly patrolSpeedKt: number;
  readonly sprintSpeedKt: number;
  readonly accelerationKtPerSec: number;
  readonly decelerationKtPerSec: number;
  readonly maxTurnRateDegPerSec: number;
  readonly baseRadiatedNoise: number;
  readonly cavitationThresholdKt: number;
}

export interface VesselInstance {
  readonly entityId: string;
  readonly classId: string;
  /** Simulation truth at mission time zero. Never pass this into tracking UI. */
  readonly truePosition: Vec2;
  readonly trueCourseRad: number;
  readonly trueSpeedKt: number;
}

export interface VesselClassHypothesis {
  readonly requestedCode: AcousticCode;
  readonly definition: VesselClassDefinition;
  readonly exactSignatureMatch: boolean;
}

export const TMA_DEBUG = false;

/**
 * Gameplay distance scale. Knots remain the speed shown to the player and the
 * speed used by the acoustic model; only travel through world space is
 * compressed so useful bearing geometry develops on a game-length clock.
 */
export const GAMEPLAY_MOVEMENT_SCALE = 4;

export const FROSTBITE_TRUE_SPEED_KT = 8;
export const FROSTBITE_CONTACT_CYCLE_DURATION_SECONDS = 4.45;
export const FROSTBITE_OBSERVED_PROPULSION_RATE_HZ =
  1 / FROSTBITE_CONTACT_CYCLE_DURATION_SECONDS;

const FROSTBITE_PROPULSION_RATE_PER_KNOT =
  FROSTBITE_OBSERVED_PROPULSION_RATE_HZ / FROSTBITE_TRUE_SPEED_KT;

/**
 * Hand-authored class data. The easy 1:2:4 Frostbite voice remains the
 * reference; nearby coefficients make a similar but wrong class drift
 * plausibly rather than fail an answer check.
 */
export const VESSEL_CLASS_CATALOG: readonly VesselClassDefinition[] =
  Object.freeze([
    Object.freeze({
      id: "project-671rtm-victor-iii",
      displayName: "Project 671RTM Victor III",
      faction: "USSR",
      signatureCode: [1, 2, 3] as const,
      audioProfileId: "frostbite-victor-iii",
      propulsionRatePerKnot: FROSTBITE_PROPULSION_RATE_PER_KNOT,
      minOperationalSpeedKt: 3,
      maxOperationalSpeedKt: 30,
      quietSpeedKt: 5,
      patrolSpeedKt: 8,
      sprintSpeedKt: 25,
      accelerationKtPerSec: 0.2,
      decelerationKtPerSec: 0.24,
      maxTurnRateDegPerSec: 2,
      baseRadiatedNoise: 0.42,
      cavitationThresholdKt: 18,
    }),
    Object.freeze({
      id: "project-945-sierra-i",
      displayName: "Project 945 Sierra I",
      faction: "USSR",
      signatureCode: [3, 4, 5] as const,
      audioProfileId: "sierra-i-machinery",
      propulsionRatePerKnot: FROSTBITE_PROPULSION_RATE_PER_KNOT * 1.055,
      minOperationalSpeedKt: 3,
      maxOperationalSpeedKt: 32,
      quietSpeedKt: 5,
      patrolSpeedKt: 8,
      sprintSpeedKt: 27,
      accelerationKtPerSec: 0.21,
      decelerationKtPerSec: 0.25,
      maxTurnRateDegPerSec: 2.1,
      baseRadiatedNoise: 0.39,
      cavitationThresholdKt: 19,
    }),
    Object.freeze({
      id: "sturgeon",
      displayName: "Sturgeon class",
      faction: "NATO",
      signatureCode: [2, 3, 5] as const,
      audioProfileId: "sturgeon-machinery",
      propulsionRatePerKnot: FROSTBITE_PROPULSION_RATE_PER_KNOT * 0.92,
      minOperationalSpeedKt: 3,
      maxOperationalSpeedKt: 26,
      quietSpeedKt: 4,
      patrolSpeedKt: 7,
      sprintSpeedKt: 22,
      accelerationKtPerSec: 0.18,
      decelerationKtPerSec: 0.22,
      maxTurnRateDegPerSec: 1.8,
      baseRadiatedNoise: 0.48,
      cavitationThresholdKt: 16,
    }),
    Object.freeze({
      id: "los-angeles-flight-i",
      displayName: "Los Angeles Flight I",
      faction: "NATO",
      // THE HUNT keeps the approved Frostbite 1:2:4 count and cadence. The
      // class-specific timbre comes from the licensed field-recording bank.
      signatureCode: [1, 2, 4] as const,
      audioProfileId: "los-angeles-machinery",
      propulsionRatePerKnot: FROSTBITE_PROPULSION_RATE_PER_KNOT,
      minOperationalSpeedKt: 3,
      maxOperationalSpeedKt: 33,
      quietSpeedKt: 5,
      patrolSpeedKt: 8,
      sprintSpeedKt: 28,
      accelerationKtPerSec: 0.24,
      decelerationKtPerSec: 0.28,
      maxTurnRateDegPerSec: 2.2,
      // Quiet enough to fall below a clean 16 km passive hold at five knots,
      // while the patrol and sprint speed curves remain detectable.
      baseRadiatedNoise: 0.185,
      cavitationThresholdKt: 20,
    }),
    Object.freeze({
      id: "merchant-slow-diesel",
      displayName: "Slow merchant",
      faction: "CIVILIAN",
      signatureCode: [1, 4, 7] as const,
      audioProfileId: "merchant-slow-diesel",
      propulsionRatePerKnot: FROSTBITE_PROPULSION_RATE_PER_KNOT * 0.68,
      minOperationalSpeedKt: 2,
      maxOperationalSpeedKt: 19,
      quietSpeedKt: 5,
      patrolSpeedKt: 11,
      sprintSpeedKt: 17,
      accelerationKtPerSec: 0.12,
      decelerationKtPerSec: 0.14,
      maxTurnRateDegPerSec: 0.75,
      baseRadiatedNoise: 0.78,
      cavitationThresholdKt: 14,
    }),
  ] satisfies readonly VesselClassDefinition[]);

// Keep the opening hunt close enough to sustain a usable passive track while
// preserving bearing-only uncertainty and the enemy's later break-contact
// manoeuvres.
const FROSTBITE_INITIAL_RANGE_METERS = 6_000;
const FROSTBITE_INITIAL_BEARING_RAD = radians(50);
const AKULA_INITIAL_POSITION: Vec2 = { x: 0, z: 0 };

export const FROSTBITE_TEST_CONTACT: VesselInstance = Object.freeze({
  entityId: "hunt-los-angeles-01",
  classId: "los-angeles-flight-i",
  truePosition: Object.freeze({
    x:
      AKULA_INITIAL_POSITION.x +
      Math.sin(FROSTBITE_INITIAL_BEARING_RAD) * FROSTBITE_INITIAL_RANGE_METERS,
    z:
      AKULA_INITIAL_POSITION.z -
      Math.cos(FROSTBITE_INITIAL_BEARING_RAD) * FROSTBITE_INITIAL_RANGE_METERS,
  }),
  trueCourseRad: radians(315),
  trueSpeedKt: FROSTBITE_TRUE_SPEED_KT,
});

export function vesselClassById(classId: string): VesselClassDefinition {
  const definition = VESSEL_CLASS_CATALOG.find(({ id }) => id === classId);
  if (definition === undefined) {
    throw new Error(`Unknown vessel class: ${classId}`);
  }
  return definition;
}

/**
 * Class identity remains permutation-invariant per the accepted acoustic
 * canon. The UI still preserves three independently editable ordered slots.
 */
export function signatureCodesMatch(
  left: AcousticCode,
  right: AcousticCode,
): boolean {
  const sortedLeft = sortedSignature(left);
  const sortedRight = sortedSignature(right);
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

/** Always returns an operational hypothesis without exposing right/wrong. */
export function resolveVesselClassHypothesis(
  requestedCode: AcousticCode,
): VesselClassHypothesis {
  const exact = VESSEL_CLASS_CATALOG.find(({ signatureCode }) =>
    signatureCodesMatch(requestedCode, signatureCode),
  );
  if (exact !== undefined) {
    return {
      requestedCode: copyCode(requestedCode),
      definition: exact,
      exactSignatureMatch: true,
    };
  }

  const requested = sortedSignature(requestedCode);
  const nearest = VESSEL_CLASS_CATALOG.map((definition, catalogIndex) => ({
    definition,
    catalogIndex,
    distance: sortedSignature(definition.signatureCode).reduce(
      (sum, value, index) => sum + Math.abs(value - (requested[index] ?? 1)),
      0,
    ),
  })).sort(
    (left, right) =>
      left.distance - right.distance || left.catalogIndex - right.catalogIndex,
  )[0];

  if (nearest === undefined) {
    throw new Error("The vessel class catalog is empty.");
  }
  return {
    requestedCode: copyCode(requestedCode),
    definition: nearest.definition,
    exactSignatureMatch: false,
  };
}

/** Audio/simulation boundary: this is the only true-speed conversion. */
export function observedPropulsionRateHz(
  vessel: VesselInstance,
  trueClass: VesselClassDefinition,
): number {
  if (vessel.classId !== trueClass.id) {
    throw new Error("The supplied true class does not belong to this vessel.");
  }
  return vessel.trueSpeedKt * trueClass.propulsionRatePerKnot;
}

/** Simulation/audio boundary for a moving physical entity. */
export function observedPropulsionRateFromSpeed(
  speedKt: number,
  trueClass: VesselClassDefinition,
): number {
  return Math.max(0, speedKt) * trueClass.propulsionRatePerKnot;
}

/** Player-knowledge boundary: estimated speed comes only from acoustic rate. */
export function estimatedSpeedKnots(
  observedRateHz: number,
  guessedClass: VesselClassDefinition,
): number {
  if (!Number.isFinite(observedRateHz) || observedRateHz <= 0) {
    throw new RangeError("Observed propulsion rate must be positive.");
  }
  return observedRateHz / guessedClass.propulsionRatePerKnot;
}

export function vesselPositionAt(
  vessel: VesselInstance,
  elapsedSeconds: number,
): Vec2 {
  const seconds = Math.max(0, elapsedSeconds);
  const speedMps = knotsToWorldMetersPerSecond(vessel.trueSpeedKt);
  return {
    x:
      vessel.truePosition.x +
      Math.sin(vessel.trueCourseRad) * speedMps * seconds,
    z:
      vessel.truePosition.z -
      Math.cos(vessel.trueCourseRad) * speedMps * seconds,
  };
}

export function knotsToMetersPerSecond(knots: number): number {
  return knots * 0.514_444;
}

/** Converts an indicated nautical speed into compressed gameplay travel. */
export function knotsToWorldMetersPerSecond(knots: number): number {
  return knotsToMetersPerSecond(knots) * GAMEPLAY_MOVEMENT_SCALE;
}

function sortedSignature(code: AcousticCode): readonly number[] {
  return [...code].sort((left, right) => left - right);
}

function copyCode(code: AcousticCode): AcousticCode {
  return [code[0], code[1], code[2]];
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
