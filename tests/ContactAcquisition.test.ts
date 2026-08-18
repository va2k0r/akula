import { describe, expect, it } from "vitest";
import {
  CONTACT_ACQUISITION_DWELL_SECONDS,
  CONTACT_ACQUISITION_PULSE_GAPS_SECONDS,
  CONTACT_ACQUISITION_PULSE_OFFSETS_SECONDS,
  CONTACT_ACQUISITION_TERMINAL_BURST_SECONDS,
  CONTACT_CAMERA_CONE_DEGREES,
  CONTACT_CAMERA_HALF_ANGLE_DEGREES,
  INITIAL_CONTACT_ACQUISITION_STATE,
  contactAcquisitionProgress,
  contactBearingInsideCameraCone,
  contactDirectionalCueEnabled,
  contactSearchCueEnabled,
  selectAcquisitionCandidate,
  updateContactAcquisition,
  type AcquisitionCandidate,
  type ContactAcquisitionState,
} from "../src/game/ContactAcquisition";
import { CONTACT_AUDIO_MINIMUM_SIGNAL_QUALITY } from "../src/game/ContactSensoryProgression";

const SOURCE_ID = "source-1";
const DEGREES = Math.PI / 180;

interface SequenceState {
  readonly started: boolean;
  readonly progress: number;
  readonly pulseCount: number;
  readonly complete: boolean;
}

const WAITING_SEQUENCE: SequenceState = Object.freeze({
  started: true,
  progress: 0,
  pulseCount: 0,
  complete: false,
});

function candidate(
  signalQuality: number,
  angularErrorDegrees: number,
  sourceEntityId = SOURCE_ID,
): AcquisitionCandidate {
  return {
    sourceEntityId,
    angularErrorRad: angularErrorDegrees * DEGREES,
    signalQuality,
    perceivable: true,
  };
}

function update(
  state: ContactAcquisitionState,
  nextCandidate: AcquisitionCandidate | undefined,
  sequence: SequenceState = WAITING_SEQUENCE,
  enabled = true,
): ContactAcquisitionState {
  return updateContactAcquisition(state, {
    enabled,
    candidate: nextCandidate,
    sequenceStarted: sequence.started,
    sequenceProgress: sequence.progress,
    sequencePulseCount: sequence.pulseCount,
    sequenceComplete: sequence.complete,
  });
}

describe("passive contact acquisition", () => {
  it("selects the nearest perceivable untracked source inside the haptic cone", () => {
    const selected = selectAcquisitionCandidate(
      [
        candidate(0.8, 7, "far-angle"),
        candidate(0.8, 2, "tracked"),
        candidate(0.8, 4, "nearest-free"),
        candidate(0.8, 100, "outside"),
        { ...candidate(0.8, 1, "masked"), perceivable: false },
      ],
      (sourceEntityId) => sourceEntityId === "tracked",
    );

    expect(selected?.sourceEntityId).toBe("nearest-free");
  });

  it("uses one 30-degree camera cone while range thresholds remain separate", () => {
    expect(CONTACT_CAMERA_CONE_DEGREES).toBe(30);
    expect(CONTACT_CAMERA_HALF_ANGLE_DEGREES).toBe(15);
    expect(contactBearingInsideCameraCone(14.9 * DEGREES)).toBe(true);
    expect(contactBearingInsideCameraCone(-14.9 * DEGREES)).toBe(true);
    expect(contactBearingInsideCameraCone(15.1 * DEGREES)).toBe(false);
    expect(contactBearingInsideCameraCone(Number.NaN)).toBe(false);
  });

  it("uses the complete tactile cadence as the crew-mark gate", () => {
    expect(CONTACT_ACQUISITION_PULSE_GAPS_SECONDS).toEqual([
      0.75, 1, 0.5, 0.2, 0.1,
    ]);
    expect(CONTACT_ACQUISITION_PULSE_OFFSETS_SECONDS).toEqual([
      0.75, 1.75, 2.25, 2.45, 2.55,
    ]);
    expect(CONTACT_ACQUISITION_TERMINAL_BURST_SECONDS).toBe(0.3);
    expect(CONTACT_ACQUISITION_DWELL_SECONDS).toBe(2.85);
  });

  it("opens the faint pre-contact audio gate at its first signal threshold", () => {
    const inside = candidate(0.55, 10);
    const tooWeak = candidate(CONTACT_AUDIO_MINIMUM_SIGNAL_QUALITY - 0.001, 10);

    expect(contactSearchCueEnabled(true, inside)).toBe(true);
    expect(contactSearchCueEnabled(true, tooWeak)).toBe(false);
    expect(contactSearchCueEnabled(false, inside)).toBe(false);
    expect(contactSearchCueEnabled(true, undefined)).toBe(false);
    expect(
      contactSearchCueEnabled(true, { ...inside, perceivable: false }),
    ).toBe(false);
  });

  it("keeps the directional cue gated by audibility and angle, not mark state", () => {
    const audible = candidate(CONTACT_AUDIO_MINIMUM_SIGNAL_QUALITY, 10);

    expect(contactDirectionalCueEnabled(true, audible)).toBe(true);
    expect(
      contactDirectionalCueEnabled(true, {
        ...audible,
        angularErrorRad: 15.1 * DEGREES,
      }),
    ).toBe(false);
    expect(contactDirectionalCueEnabled(false, audible)).toBe(false);
  });

  it("keeps an audible source unmarked until the tactile lock completes", () => {
    const lockable = candidate(0.55, 10);
    const entered = update(INITIAL_CONTACT_ACQUISITION_STATE, lockable);
    const beforeFirstFragment = update(entered, lockable, {
      started: true,
      progress: 0.74 / CONTACT_ACQUISITION_DWELL_SECONDS,
      pulseCount: 0,
      complete: false,
    });
    const firstFragment = update(beforeFirstFragment, lockable, {
      started: true,
      progress: 0.75 / CONTACT_ACQUISITION_DWELL_SECONDS,
      pulseCount: 1,
      complete: false,
    });
    const terminalBurstStarted = update(firstFragment, lockable, {
      started: true,
      progress: 2.55 / CONTACT_ACQUISITION_DWELL_SECONDS,
      pulseCount: 5,
      complete: false,
    });
    const acquired = update(terminalBurstStarted, lockable, {
      started: true,
      progress: 1,
      pulseCount: 5,
      complete: true,
    });

    expect(beforeFirstFragment.acquired).toBe(false);
    expect(contactAcquisitionProgress(beforeFirstFragment)).toBe(0);
    expect(firstFragment.acquired).toBe(false);
    expect(firstFragment.pulseCount).toBe(1);
    expect(terminalBurstStarted.acquired).toBe(false);
    expect(acquired.acquired).toBe(true);
    expect(acquired.candidateSourceEntityId).toBe(SOURCE_ID);
    expect(acquired.dwellSeconds).toBe(CONTACT_ACQUISITION_DWELL_SECONDS);
    expect(contactAcquisitionProgress(acquired)).toBe(1);
  });

  it("does not mark before the source is actually audible", () => {
    const tooWeak = candidate(CONTACT_AUDIO_MINIMUM_SIGNAL_QUALITY - 0.001, 10);

    expect(update(INITIAL_CONTACT_ACQUISITION_STATE, tooWeak)).toBe(
      INITIAL_CONTACT_ACQUISITION_STATE,
    );
    expect(
      update(
        INITIAL_CONTACT_ACQUISITION_STATE,
        candidate(CONTACT_AUDIO_MINIMUM_SIGNAL_QUALITY, 10),
        WAITING_SEQUENCE,
        false,
      ),
    ).toBe(INITIAL_CONTACT_ACQUISITION_STATE);
  });

  it("discards an interrupted partial lock instead of banking it", () => {
    const lockable = candidate(0.55, 10);
    const entered = update(INITIAL_CONTACT_ACQUISITION_STATE, lockable);
    const partial = update(entered, lockable, {
      started: true,
      progress: 2.5 / CONTACT_ACQUISITION_DWELL_SECONDS,
      pulseCount: 4,
      complete: false,
    });

    expect(update(partial, undefined)).toBe(INITIAL_CONTACT_ACQUISITION_STATE);
  });

  it("does not transfer a completed tactile lock to another source", () => {
    const sourceA = candidate(0.55, 10, "source-a");
    const entered = update(INITIAL_CONTACT_ACQUISITION_STATE, sourceA);
    const partial = update(entered, sourceA, {
      started: true,
      progress: 0.8,
      pulseCount: 4,
      complete: false,
    });
    const switched = update(partial, candidate(0.55, 10, "source-b"), {
      started: true,
      progress: 1,
      pulseCount: 5,
      complete: true,
    });

    expect(switched.candidateSourceEntityId).toBe("source-b");
    expect(switched.acquired).toBe(false);
    expect(switched.pulseCount).toBe(0);
  });
});
