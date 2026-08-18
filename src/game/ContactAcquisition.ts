import { CONTACT_AUDIO_MINIMUM_SIGNAL_QUALITY } from "./ContactSensoryProgression";

// One shared camera cone for the audible search cue, directional haptics, and
// contact acquisition. Their range thresholds remain deliberately different.
// The public value is the full cone; all bearing checks use its half-angle
// around camera center.
export const CONTACT_CAMERA_CONE_DEGREES = 30;
export const CONTACT_CAMERA_HALF_ANGLE_DEGREES =
  CONTACT_CAMERA_CONE_DEGREES / 2;
/**
 * Silence before the first tactile fragment, then the progressively shorter
 * gaps of the directional lock pattern. The completed pattern gates the crew
 * mark, while its deterministic clock remains independent of gamepad hardware.
 */
export const CONTACT_ACQUISITION_PULSE_GAPS_SECONDS = Object.freeze([
  0.75, 1, 0.5, 0.2, 0.1,
] as const);
export const CONTACT_ACQUISITION_TERMINAL_BURST_SECONDS = 0.3;
export const CONTACT_ACQUISITION_PULSE_OFFSETS_SECONDS = Object.freeze(
  CONTACT_ACQUISITION_PULSE_GAPS_SECONDS.map((_, index, gaps) =>
    Number(
      gaps
        .slice(0, index + 1)
        .reduce((total, gap) => total + gap, 0)
        .toFixed(3),
    ),
  ),
);
export const CONTACT_ACQUISITION_DWELL_SECONDS = Number(
  (
    (CONTACT_ACQUISITION_PULSE_OFFSETS_SECONDS.at(-1) ?? 0) +
    CONTACT_ACQUISITION_TERMINAL_BURST_SECONDS
  ).toFixed(3),
);

export const CONTACT_CAMERA_HALF_ANGLE_RADIANS = radians(
  CONTACT_CAMERA_HALF_ANGLE_DEGREES,
);

export interface AcquisitionCandidate {
  readonly sourceEntityId: string;
  readonly angularErrorRad: number;
  readonly signalQuality: number;
  readonly perceivable: boolean;
}

export interface ContactAcquisitionState {
  readonly candidateSourceEntityId: string | undefined;
  readonly cueStarted: boolean;
  readonly pulseCount: number;
  readonly dwellSeconds: number;
  readonly acquired: boolean;
}

export interface ContactAcquisitionInput {
  readonly enabled: boolean;
  readonly candidate: AcquisitionCandidate | undefined;
  readonly sequenceStarted: boolean;
  readonly sequenceProgress: number;
  readonly sequencePulseCount: number;
  readonly sequenceComplete: boolean;
}

export const INITIAL_CONTACT_ACQUISITION_STATE: ContactAcquisitionState =
  Object.freeze({
    candidateSourceEntityId: undefined,
    cueStarted: false,
    pulseCount: 0,
    dwellSeconds: 0,
    acquired: false,
  });

export function contactBearingInsideCameraCone(
  angularErrorRadians: number,
): boolean {
  if (!Number.isFinite(angularErrorRadians)) {
    return false;
  }
  const normalized = Math.atan2(
    Math.sin(angularErrorRadians),
    Math.cos(angularErrorRadians),
  );
  return Math.abs(normalized) <= CONTACT_CAMERA_HALF_ANGLE_RADIANS + 1e-9;
}

/** Opens the faint audio stage before the higher-quality haptic stage. */
export function contactSearchCueEnabled(
  sensoryEnabled: boolean,
  candidate: AcquisitionCandidate | undefined,
): boolean {
  return (
    sensoryEnabled &&
    candidate?.perceivable === true &&
    candidate.signalQuality >= CONTACT_AUDIO_MINIMUM_SIGNAL_QUALITY
  );
}

/**
 * Keeps directional sound available for both unmarked and tracked contacts.
 * Track assignment must not cut a source that remains audible.
 */
export function contactDirectionalCueEnabled(
  sensoryEnabled: boolean,
  candidate: AcquisitionCandidate | undefined,
): boolean {
  return (
    contactSearchCueEnabled(sensoryEnabled, candidate) &&
    contactBearingInsideCameraCone(candidate?.angularErrorRad ?? Number.NaN)
  );
}

/** Considers exactly one perceivable, untracked source nearest camera center. */
export function selectAcquisitionCandidate(
  candidates: readonly AcquisitionCandidate[],
  sourceAlreadyTracked: (sourceEntityId: string) => boolean,
): AcquisitionCandidate | undefined {
  return candidates
    .filter(
      (candidate) =>
        candidate.perceivable &&
        !sourceAlreadyTracked(candidate.sourceEntityId) &&
        contactBearingInsideCameraCone(candidate.angularErrorRad),
    )
    .sort(
      (left, right) =>
        Math.abs(left.angularErrorRad) - Math.abs(right.angularErrorRad) ||
        left.sourceEntityId.localeCompare(right.sourceEntityId),
    )[0];
}

/**
 * The deterministic tactile lock owns contact acquisition. Its clock runs
 * independently of the physical actuator, so a missing gamepad cannot make the
 * billboard impossible to reveal. Leaving the cone discards the sequence.
 */
export function updateContactAcquisition(
  state: ContactAcquisitionState,
  input: ContactAcquisitionInput,
): ContactAcquisitionState {
  if (state.acquired) {
    return state;
  }
  const candidate = input.enabled ? input.candidate : undefined;
  if (
    candidate === undefined ||
    !candidate.perceivable ||
    candidate.signalQuality < CONTACT_AUDIO_MINIMUM_SIGNAL_QUALITY
  ) {
    return INITIAL_CONTACT_ACQUISITION_STATE;
  }

  const continuingCandidate =
    state.candidateSourceEntityId === candidate.sourceEntityId;
  const sequenceProgress =
    continuingCandidate && input.sequenceStarted
      ? clamp(input.sequenceProgress, 0, 1)
      : 0;
  const pulseCount =
    continuingCandidate && input.sequenceStarted
      ? Math.max(0, Math.floor(input.sequencePulseCount))
      : 0;
  const acquired =
    continuingCandidate && input.sequenceStarted && input.sequenceComplete;
  const dwellSeconds = acquired
    ? CONTACT_ACQUISITION_DWELL_SECONDS
    : sequenceProgress * CONTACT_ACQUISITION_DWELL_SECONDS;
  return {
    candidateSourceEntityId: candidate.sourceEntityId,
    cueStarted: pulseCount > 0,
    pulseCount,
    dwellSeconds,
    acquired,
  };
}

export function contactAcquisitionProgress(
  state: ContactAcquisitionState,
): number {
  if (state.acquired) {
    return 1;
  }
  if (!state.cueStarted) {
    return 0;
  }
  return Math.max(
    0,
    Math.min(1, state.dwellSeconds / CONTACT_ACQUISITION_DWELL_SECONDS),
  );
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, value));
}
