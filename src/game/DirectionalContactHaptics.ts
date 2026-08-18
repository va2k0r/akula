import type { AcousticCode } from "../audio";
import {
  CONTACT_ACQUISITION_PULSE_GAPS_SECONDS,
  CONTACT_ACQUISITION_TERMINAL_BURST_SECONDS,
  CONTACT_CAMERA_HALF_ANGLE_RADIANS,
} from "./ContactAcquisition";
import { CONTACT_HAPTIC_MINIMUM_SIGNAL_QUALITY } from "./ContactSensoryProgression";

export const DIRECTIONAL_HAPTIC_MINIMUM_CYCLE_GAP = 3;
export const DIRECTIONAL_HAPTIC_MAXIMUM_CYCLE_GAP = 7;
export const DIRECTIONAL_HAPTIC_MINIMUM_SIGNAL_QUALITY =
  CONTACT_HAPTIC_MINIMUM_SIGNAL_QUALITY;
export const DIRECTIONAL_HAPTIC_FULL_MARKER_CADENCE_SIGNAL_QUALITY = 0.58;

// Signal quality never changes force: it changes only omission and cadence.
// This is the explicitly requested doubled envelope; keep it fixed throughout
// the directional lock sequence so proximity cannot leak through pulse
// intensity. Completion gates crew marking and TMA entry.
export const DIRECTIONAL_HAPTIC_STRONG_MAGNITUDE = 0.36;
export const DIRECTIONAL_HAPTIC_WEAK_MAGNITUDE = 0.84;
export const DIRECTIONAL_HAPTIC_FRAGMENT_DURATION_MILLISECONDS = 90;
const TARGET_CONVERGED_TICK_FREQUENCY_HERTZ = 16;
export const DIRECTIONAL_CONTACT_LOCK_GRID_FREQUENCY_HERTZ = 20;
/** 0.75 / 1 / 0.5 / 0.2 / 0.1 seconds on a precise 50 ms grid. */
export const DIRECTIONAL_CONTACT_LOCK_GAP_TICKS = Object.freeze(
  CONTACT_ACQUISITION_PULSE_GAPS_SECONDS.map((gapSeconds) =>
    Math.round(gapSeconds * DIRECTIONAL_CONTACT_LOCK_GRID_FREQUENCY_HERTZ),
  ),
);
export const DIRECTIONAL_CONTACT_LOCK_SETTLE_TICKS = Math.round(
  CONTACT_ACQUISITION_TERMINAL_BURST_SECONDS *
    DIRECTIONAL_CONTACT_LOCK_GRID_FREQUENCY_HERTZ,
);
export const DIRECTIONAL_CONTACT_TERMINAL_BURST_DURATION_MILLISECONDS =
  Math.round(CONTACT_ACQUISITION_TERMINAL_BURST_SECONDS * 1_000);

export interface DirectionalContactHapticInput {
  readonly enabled: boolean;
  /** Angular separation between the camera axis and the source direction. */
  readonly alignmentRadians: number;
  readonly signalQuality: number;
  readonly signature: AcousticCode;
  readonly cycleDurationSeconds: number;
}

export interface DirectionalContactHapticProfile {
  readonly active: boolean;
  readonly firstComponent: number;
  readonly markerFrequencyHertz: number;
  readonly tickFrequencyHertz: number;
  readonly intervalMilliseconds: number;
  readonly durationMilliseconds: number;
  readonly scheduleSeed: number;
  readonly strongMagnitude: number;
  readonly weakMagnitude: number;
  readonly alignmentDegrees: number;
  readonly alignmentAmount: number;
  readonly signalQuality: number;
  readonly gridSubdivision: number;
  readonly minimumCycleGap: number;
  readonly maximumCycleGap: number;
  readonly continuous: boolean;
}

export interface DirectionalContactHapticPulse {
  /** Absolute tick on the source-A-derived grid since voice start. */
  readonly beatIndex: number;
  readonly cycleIndex: number;
  readonly eventIndex: number;
  readonly durationMilliseconds: number;
  readonly magnitudeMultiplier: number;
}

export interface DirectionalContactLockSchedule {
  readonly gridFrequencyHertz: number;
  /** Pulse offsets from the instant the camera enters the contact cone. */
  readonly pulseBeatOffsets: readonly number[];
  readonly completionBeatOffset: number;
}

export const INACTIVE_DIRECTIONAL_HAPTIC_PROFILE: DirectionalContactHapticProfile =
  Object.freeze({
    active: false,
    firstComponent: 0,
    markerFrequencyHertz: 0,
    tickFrequencyHertz: 0,
    intervalMilliseconds: 0,
    durationMilliseconds: DIRECTIONAL_HAPTIC_FRAGMENT_DURATION_MILLISECONDS,
    scheduleSeed: 0,
    strongMagnitude: 0,
    weakMagnitude: 0,
    alignmentDegrees: 180,
    alignmentAmount: 0,
    signalQuality: 0,
    gridSubdivision: 1,
    minimumCycleGap: DIRECTIONAL_HAPTIC_MINIMUM_CYCLE_GAP,
    maximumCycleGap: DIRECTIONAL_HAPTIC_MAXIMUM_CYCLE_GAP,
    continuous: false,
  });

/**
 * Keep the pre-contact cue alive before Web Audio has produced an audible
 * clock. Once audio is running its clock remains the phase authority; until
 * then the deterministic mission clock drives the same component-A grid.
 */
export function directionalContactHapticElapsedTime(
  audibleElapsedSeconds: number | undefined,
  simulationElapsedSeconds: number,
  audibleClockRunning = true,
): number | undefined {
  if (
    audibleClockRunning &&
    audibleElapsedSeconds !== undefined &&
    Number.isFinite(audibleElapsedSeconds) &&
    audibleElapsedSeconds >= 0
  ) {
    return audibleElapsedSeconds;
  }
  return Number.isFinite(simulationElapsedSeconds) &&
    simulationElapsedSeconds >= 0
    ? simulationElapsedSeconds
    : undefined;
}

/**
 * Component A still defines the acoustic profile and the fixed physical
 * envelope. Camera alignment only opens or closes the cone; once open,
 * InputController runs the explicit acquisition cadence below.
 */
export function directionalContactHapticProfile(
  input: DirectionalContactHapticInput,
): DirectionalContactHapticProfile {
  const firstComponent = input.signature[0];
  if (
    !Number.isSafeInteger(firstComponent) ||
    firstComponent <= 0 ||
    !Number.isFinite(input.cycleDurationSeconds) ||
    input.cycleDurationSeconds <= 0
  ) {
    return INACTIVE_DIRECTIONAL_HAPTIC_PROFILE;
  }

  const alignmentRadians = Math.abs(normalizeAngle(input.alignmentRadians));
  const alignmentAmount = smootherstep(
    CONTACT_CAMERA_HALF_ANGLE_RADIANS,
    0,
    alignmentRadians,
  );
  const signalQuality = clamp(input.signalQuality, 0, 1);
  const markerFrequencyHertz = firstComponent / input.cycleDurationSeconds;
  const sparseProgress = smootherstep(
    DIRECTIONAL_HAPTIC_MINIMUM_SIGNAL_QUALITY,
    DIRECTIONAL_HAPTIC_FULL_MARKER_CADENCE_SIGNAL_QUALITY,
    signalQuality,
  );
  const minimumCycleGap = Math.max(
    1,
    Math.round(lerp(DIRECTIONAL_HAPTIC_MINIMUM_CYCLE_GAP, 1, sparseProgress)),
  );
  const maximumCycleGap = Math.max(
    minimumCycleGap,
    Math.round(lerp(DIRECTIONAL_HAPTIC_MAXIMUM_CYCLE_GAP, 1, sparseProgress)),
  );
  const convergenceProgress = smootherstep(
    DIRECTIONAL_HAPTIC_FULL_MARKER_CADENCE_SIGNAL_QUALITY,
    1,
    signalQuality,
  );
  const maximumSubdivisionPower = Math.max(
    0,
    Math.round(
      Math.log2(TARGET_CONVERGED_TICK_FREQUENCY_HERTZ / markerFrequencyHertz),
    ),
  );
  const gridSubdivision =
    2 ** Math.round(convergenceProgress * maximumSubdivisionPower);
  const tickFrequencyHertz = markerFrequencyHertz * gridSubdivision;
  const active =
    input.enabled &&
    signalQuality >= DIRECTIONAL_HAPTIC_MINIMUM_SIGNAL_QUALITY &&
    alignmentRadians <= CONTACT_CAMERA_HALF_ANGLE_RADIANS + 1e-9;

  return {
    active,
    firstComponent,
    markerFrequencyHertz,
    tickFrequencyHertz,
    intervalMilliseconds: Math.round(1_000 / tickFrequencyHertz),
    durationMilliseconds: DIRECTIONAL_HAPTIC_FRAGMENT_DURATION_MILLISECONDS,
    scheduleSeed: signatureScheduleSeed(input.signature),
    strongMagnitude: active ? DIRECTIONAL_HAPTIC_STRONG_MAGNITUDE : 0,
    weakMagnitude: active ? DIRECTIONAL_HAPTIC_WEAK_MAGNITUDE : 0,
    alignmentDegrees: (alignmentRadians * 180) / Math.PI,
    alignmentAmount,
    signalQuality,
    gridSubdivision,
    minimumCycleGap,
    maximumCycleGap,
    continuous: false,
  };
}

/**
 * Builds the exact acquisition cadence. It starts with 0.75 seconds of silence,
 * then closes through 1 / 0.5 / 0.2 / 0.1 second gaps. The last pulse is the
 * terminal burst; completion follows only after that burst has fully elapsed.
 */
export function directionalContactLockSchedule(
  profile: DirectionalContactHapticProfile,
): DirectionalContactLockSchedule | undefined {
  if (profile.markerFrequencyHertz <= 0) {
    return undefined;
  }
  const pulseBeatOffsets: number[] = [];
  let beatOffset = 0;
  for (const gap of DIRECTIONAL_CONTACT_LOCK_GAP_TICKS) {
    beatOffset += gap;
    pulseBeatOffsets.push(beatOffset);
  }
  return {
    gridFrequencyHertz: DIRECTIONAL_CONTACT_LOCK_GRID_FREQUENCY_HERTZ,
    pulseBeatOffsets,
    completionBeatOffset: beatOffset + DIRECTIONAL_CONTACT_LOCK_SETTLE_TICKS,
  };
}

export function directionalContactLockBeatIndex(
  schedule: DirectionalContactLockSchedule,
  playbackElapsedSeconds: number,
): number | undefined {
  if (
    !Number.isFinite(playbackElapsedSeconds) ||
    playbackElapsedSeconds < 0 ||
    schedule.gridFrequencyHertz <= 0
  ) {
    return undefined;
  }
  return Math.floor(
    playbackElapsedSeconds * schedule.gridFrequencyHertz + 1e-7,
  );
}

/** Returns the source-derived tick currently reached on the audible clock. */
export function directionalContactHapticBeatIndex(
  profile: DirectionalContactHapticProfile,
  playbackElapsedSeconds: number,
): number | undefined {
  if (
    profile.firstComponent <= 0 ||
    profile.tickFrequencyHertz <= 0 ||
    !Number.isFinite(playbackElapsedSeconds) ||
    playbackElapsedSeconds < 0
  ) {
    return undefined;
  }
  return Math.floor(playbackElapsedSeconds * profile.tickFrequencyHertz + 1e-7);
}

/** Chooses a stable but irregular real A onset after fully silent cycles. */
export function nextDirectionalContactHapticPulse(
  profile: DirectionalContactHapticProfile,
  afterBeatIndex: number,
): DirectionalContactHapticPulse | undefined {
  if (
    profile.firstComponent <= 0 ||
    !Number.isSafeInteger(afterBeatIndex) ||
    afterBeatIndex < 0
  ) {
    return undefined;
  }

  if (profile.minimumCycleGap === 1 && profile.maximumCycleGap === 1) {
    const beatIndex = afterBeatIndex + 1;
    return {
      beatIndex,
      cycleIndex: Math.floor(beatIndex / profile.firstComponent),
      eventIndex: beatIndex % profile.firstComponent,
      durationMilliseconds: profile.durationMilliseconds,
      magnitudeMultiplier: 1,
    };
  }

  const afterCycle = Math.floor(afterBeatIndex / profile.firstComponent);
  const hash = scheduleHash(afterCycle, profile.scheduleSeed);
  const cycleGap =
    profile.minimumCycleGap +
    (hash % (profile.maximumCycleGap - profile.minimumCycleGap + 1));
  const cycleIndex = afterCycle + cycleGap;
  const eventIndex = (hash >>> 8) % profile.firstComponent;
  const durationVariation = ((hash >>> 16) & 0xff) / 0xff;
  const magnitudeVariation = ((hash >>> 24) & 0xff) / 0xff;

  return {
    beatIndex: cycleIndex * profile.firstComponent + eventIndex,
    cycleIndex,
    eventIndex,
    durationMilliseconds: Math.round(
      profile.durationMilliseconds * (0.9 + durationVariation * 0.16),
    ),
    magnitudeMultiplier: 0.9 + magnitudeVariation * 0.1,
  };
}

function signatureScheduleSeed(signature: AcousticCode): number {
  let seed = 0x811c9dc5;
  for (const component of signature) {
    seed ^= component;
    seed = Math.imul(seed, 0x01000193);
  }
  return seed >>> 0;
}

function scheduleHash(cycleIndex: number, scheduleSeed: number): number {
  let hash = (scheduleSeed ^ Math.imul(cycleIndex + 1, 0x9e3779b1)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function smootherstep(edge0: number, edge1: number, value: number): number {
  const normalized = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return (
    normalized *
    normalized *
    normalized *
    (normalized * (normalized * 6 - 15) + 10)
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, value));
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}
