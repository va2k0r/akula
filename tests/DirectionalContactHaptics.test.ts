import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONTACT_ACQUISITION_DWELL_SECONDS,
  CONTACT_ACQUISITION_PULSE_OFFSETS_SECONDS,
} from "../src/game/ContactAcquisition";
import {
  DIRECTIONAL_CONTACT_LOCK_GAP_TICKS,
  DIRECTIONAL_CONTACT_LOCK_GRID_FREQUENCY_HERTZ,
  DIRECTIONAL_CONTACT_TERMINAL_BURST_DURATION_MILLISECONDS,
  DIRECTIONAL_HAPTIC_FRAGMENT_DURATION_MILLISECONDS,
  DIRECTIONAL_HAPTIC_FULL_MARKER_CADENCE_SIGNAL_QUALITY,
  DIRECTIONAL_HAPTIC_STRONG_MAGNITUDE,
  DIRECTIONAL_HAPTIC_WEAK_MAGNITUDE,
  directionalContactHapticElapsedTime,
  directionalContactHapticProfile,
  directionalContactLockSchedule,
} from "../src/game/DirectionalContactHaptics";
import {
  CONTACT_AUDIO_MINIMUM_SIGNAL_QUALITY,
  CONTACT_HAPTIC_MINIMUM_SIGNAL_QUALITY,
} from "../src/game/ContactSensoryProgression";
import {
  DEBUG_HAPTIC_MAGNITUDE_MULTIPLIER,
  DIRECTIONAL_AUDIO_LEAD_MILLISECONDS,
  DIRECTIONAL_SCAN_BURST_INTERVAL_MILLISECONDS,
  DIRECTIONAL_SCAN_BURST_PULSE_COUNT,
  DIRECTIONAL_SCAN_BURST_PULSE_DURATION_MILLISECONDS,
  InputController,
} from "../src/game/InputController";
import {
  PASSIVE_SONAR_VISIBLE_SIGNAL_THRESHOLD,
  directionalWaveDisplacement,
} from "../src/game/PassiveSonarRing";

const DEGREES = Math.PI / 180;
const CYCLE_DURATION_SECONDS = 4.45;

function profile(
  signalQuality = 0.68,
  alignmentDegrees = 0,
  signature: readonly [number, number, number] = [2, 4, 5],
) {
  return directionalContactHapticProfile({
    enabled: true,
    alignmentRadians: alignmentDegrees * DEGREES,
    signalQuality,
    signature,
    cycleDurationSeconds: CYCLE_DURATION_SECONDS,
  });
}

describe("directional pre-contact haptics", () => {
  it("keeps component A in the profile and uses the doubled pad envelope", () => {
    const cue = profile();

    expect(cue.firstComponent).toBe(2);
    expect(cue.markerFrequencyHertz).toBeCloseTo(2 / CYCLE_DURATION_SECONDS);
    expect(cue.durationMilliseconds).toBe(
      DIRECTIONAL_HAPTIC_FRAGMENT_DURATION_MILLISECONDS,
    );
    expect(cue.strongMagnitude).toBe(DIRECTIONAL_HAPTIC_STRONG_MAGNITUDE);
    expect(cue.weakMagnitude).toBe(DIRECTIONAL_HAPTIC_WEAK_MAGNITUDE);
    expect(cue.durationMilliseconds).toBe(90);
    expect(cue.strongMagnitude).toBe(0.36);
    expect(cue.weakMagnitude).toBe(0.84);
    expect(cue.continuous).toBe(false);
  });

  it("uses camera direction only as the shared 30-degree gate", () => {
    const centered = profile(0.5, 0);
    const nearEdge = profile(0.5, 14.9);

    expect(centered.active).toBe(true);
    expect(nearEdge.active).toBe(true);
    expect(nearEdge.weakMagnitude).toBe(centered.weakMagnitude);
    expect(profile(0.5, 15.1).active).toBe(false);
    expect(
      profile(CONTACT_HAPTIC_MINIMUM_SIGNAL_QUALITY - 0.001, 0).active,
    ).toBe(false);
  });

  it("stays silent on the controller throughout the earlier audio-only stage", () => {
    const audioOnlyQuality =
      (CONTACT_AUDIO_MINIMUM_SIGNAL_QUALITY +
        CONTACT_HAPTIC_MINIMUM_SIGNAL_QUALITY) /
      2;

    expect(profile(audioOnlyQuality).active).toBe(false);
    expect(profile(CONTACT_HAPTIC_MINIMUM_SIGNAL_QUALITY).active).toBe(true);
  });

  it("is tactile while the passive ring is still geometrically flat", () => {
    const previsualQuality = 0.68;

    expect(profile(previsualQuality).active).toBe(true);
    expect(
      directionalWaveDisplacement(0.08, 0, 0, previsualQuality, 0, 0.37, 12),
    ).toBe(0);
    expect(PASSIVE_SONAR_VISIBLE_SIGNAL_THRESHOLD).toBeGreaterThan(
      DIRECTIONAL_HAPTIC_FULL_MARKER_CADENCE_SIGNAL_QUALITY,
    );
    expect(PASSIVE_SONAR_VISIBLE_SIGNAL_THRESHOLD).toBeLessThan(1);
  });

  it("uses the mission clock before Web Audio exposes its playback clock", () => {
    expect(directionalContactHapticElapsedTime(undefined, 14.25)).toBe(14.25);
    expect(directionalContactHapticElapsedTime(3.5, 14.25)).toBe(3.5);
    expect(directionalContactHapticElapsedTime(0, 14.25, false)).toBe(14.25);
    expect(directionalContactHapticElapsedTime(undefined, Number.NaN)).toBe(
      undefined,
    );
  });

  it("builds exactly 0.75 / 1 / 0.5 / 0.2 / 0.1 seconds, then bbbt", () => {
    const schedule = directionalContactLockSchedule(profile());
    expect(schedule).toBeDefined();
    if (schedule === undefined) {
      return;
    }

    expect(schedule.gridFrequencyHertz).toBe(
      DIRECTIONAL_CONTACT_LOCK_GRID_FREQUENCY_HERTZ,
    );
    expect(DIRECTIONAL_CONTACT_LOCK_GAP_TICKS).toEqual([15, 20, 10, 4, 2]);
    expect(schedule.pulseBeatOffsets).toEqual([15, 35, 45, 49, 51]);
    expect(
      schedule.pulseBeatOffsets.map(
        (offset) => offset / schedule.gridFrequencyHertz,
      ),
    ).toEqual(CONTACT_ACQUISITION_PULSE_OFFSETS_SECONDS);
    expect(schedule.completionBeatOffset / schedule.gridFrequencyHertz).toBe(
      CONTACT_ACQUISITION_DWELL_SECONDS,
    );
    expect(DIRECTIONAL_CONTACT_TERMINAL_BURST_DURATION_MILLISECONDS).toBe(300);
  });

  it("lets the audio lead, then fires three scan ticks before the first lock fragment", () => {
    const playEffect = vi.fn().mockResolvedValue("complete");
    const controller = controllerWithGamepad(playEffect);
    const cue = profile();
    const enteredAtSeconds = 12.345;

    controller.updateDirectionalContactHaptics(cue, enteredAtSeconds, 1_000);
    expect(playEffect).not.toHaveBeenCalled();
    controller.updateDirectionalContactHaptics(
      cue,
      enteredAtSeconds + (DIRECTIONAL_AUDIO_LEAD_MILLISECONDS - 1) / 1_000,
      1_000 + DIRECTIONAL_AUDIO_LEAD_MILLISECONDS - 1,
    );
    expect(playEffect).not.toHaveBeenCalled();
    controller.updateDirectionalContactHaptics(
      cue,
      enteredAtSeconds + DIRECTIONAL_AUDIO_LEAD_MILLISECONDS / 1_000,
      1_000 + DIRECTIONAL_AUDIO_LEAD_MILLISECONDS,
    );
    expect(playEffect).toHaveBeenCalledTimes(1);
    expect(playEffect).toHaveBeenLastCalledWith("dual-rumble", {
      duration: DIRECTIONAL_SCAN_BURST_PULSE_DURATION_MILLISECONDS,
      strongMagnitude: cue.strongMagnitude,
      weakMagnitude: cue.weakMagnitude,
    });
    controller.updateDirectionalContactHaptics(
      cue,
      enteredAtSeconds +
        (DIRECTIONAL_AUDIO_LEAD_MILLISECONDS +
          DIRECTIONAL_SCAN_BURST_INTERVAL_MILLISECONDS) /
          1_000,
      1_000 +
        DIRECTIONAL_AUDIO_LEAD_MILLISECONDS +
        DIRECTIONAL_SCAN_BURST_INTERVAL_MILLISECONDS,
    );
    controller.updateDirectionalContactHaptics(
      cue,
      enteredAtSeconds +
        (DIRECTIONAL_AUDIO_LEAD_MILLISECONDS +
          DIRECTIONAL_SCAN_BURST_INTERVAL_MILLISECONDS * 2) /
          1_000,
      1_000 +
        DIRECTIONAL_AUDIO_LEAD_MILLISECONDS +
        DIRECTIONAL_SCAN_BURST_INTERVAL_MILLISECONDS * 2,
    );
    expect(playEffect).toHaveBeenCalledTimes(
      DIRECTIONAL_SCAN_BURST_PULSE_COUNT,
    );
    controller.updateDirectionalContactHaptics(
      cue,
      enteredAtSeconds + 0.749,
      1_749,
    );
    expect(playEffect).toHaveBeenCalledTimes(
      DIRECTIONAL_SCAN_BURST_PULSE_COUNT,
    );
    expect(controller.directionalContactLockState).toMatchObject({
      started: true,
      pulseCount: 0,
      complete: false,
    });

    controller.updateDirectionalContactHaptics(
      cue,
      enteredAtSeconds + 0.75,
      1_750,
    );
    expect(playEffect).toHaveBeenCalledTimes(
      DIRECTIONAL_SCAN_BURST_PULSE_COUNT + 1,
    );
    expect(playEffect).toHaveBeenLastCalledWith("dual-rumble", {
      duration: DIRECTIONAL_HAPTIC_FRAGMENT_DURATION_MILLISECONDS,
      strongMagnitude: cue.strongMagnitude,
      weakMagnitude: cue.weakMagnitude,
    });
    controller.dispose();
  });

  it("gives a spinning camera one fast scan burst but banks no lock timing", () => {
    const playEffect = vi.fn().mockResolvedValue("complete");
    const controller = controllerWithGamepad(playEffect);
    const cue = profile();

    controller.updateDirectionalContactHaptics(cue, 0, 1_000);
    controller.updateDirectionalContactHaptics(cue, 0.18, 1_180);
    controller.updateDirectionalContactHaptics(cue, 0.265, 1_265);
    controller.updateDirectionalContactHaptics(cue, 0.35, 1_350);
    controller.updateDirectionalContactHaptics(cue, 0.74, 1_740);
    controller.updateDirectionalContactHaptics(profile(0.68, 16), 0.75, 1_750);
    expect(playEffect).toHaveBeenCalledTimes(
      DIRECTIONAL_SCAN_BURST_PULSE_COUNT,
    );
    expect(controller.directionalContactLockState.started).toBe(false);

    controller.updateDirectionalContactHaptics(cue, 10, 10_000);
    controller.updateDirectionalContactHaptics(cue, 10.18, 10_180);
    controller.updateDirectionalContactHaptics(cue, 10.265, 10_265);
    controller.updateDirectionalContactHaptics(cue, 10.35, 10_350);
    controller.updateDirectionalContactHaptics(cue, 10.74, 10_740);
    expect(playEffect).toHaveBeenCalledTimes(
      DIRECTIONAL_SCAN_BURST_PULSE_COUNT * 2,
    );
    controller.updateDirectionalContactHaptics(cue, 10.75, 10_750);
    expect(playEffect).toHaveBeenCalledTimes(
      DIRECTIONAL_SCAN_BURST_PULSE_COUNT * 2 + 1,
    );
    controller.dispose();
  });

  it("saturates the scan tick at the controller API ceiling in x100 debug mode", () => {
    const playEffect = vi.fn().mockResolvedValue("complete");
    const controller = controllerWithGamepad(playEffect);

    controller.setHapticMagnitudeMultiplier(DEBUG_HAPTIC_MAGNITUDE_MULTIPLIER);
    controller.updateDirectionalContactHaptics(profile(), 0, 1_000);
    controller.updateDirectionalContactHaptics(
      profile(),
      DIRECTIONAL_AUDIO_LEAD_MILLISECONDS / 1_000,
      1_000 + DIRECTIONAL_AUDIO_LEAD_MILLISECONDS,
    );

    expect(controller.hapticMagnitudeScale).toBe(100);
    expect(playEffect).toHaveBeenLastCalledWith("dual-rumble", {
      duration: DIRECTIONAL_SCAN_BURST_PULSE_DURATION_MILLISECONDS,
      strongMagnitude: 1,
      weakMagnitude: 1,
    });
    controller.dispose();
  });

  it("plays four fragments and a 300 ms terminal bbbt, then stops cleanly", () => {
    const playEffect = vi.fn().mockResolvedValue("complete");
    const reset = vi.fn().mockResolvedValue(undefined);
    const controller = controllerWithGamepad(playEffect, reset);
    const cue = profile();
    const startSeconds = 5;

    controller.updateDirectionalContactHaptics(cue, startSeconds, 1_000);
    controller.updateDirectionalContactHaptics(
      cue,
      startSeconds + DIRECTIONAL_AUDIO_LEAD_MILLISECONDS / 1_000,
      1_000 + DIRECTIONAL_AUDIO_LEAD_MILLISECONDS,
    );
    controller.updateDirectionalContactHaptics(
      cue,
      startSeconds +
        (DIRECTIONAL_AUDIO_LEAD_MILLISECONDS +
          DIRECTIONAL_SCAN_BURST_INTERVAL_MILLISECONDS) /
          1_000,
      1_000 +
        DIRECTIONAL_AUDIO_LEAD_MILLISECONDS +
        DIRECTIONAL_SCAN_BURST_INTERVAL_MILLISECONDS,
    );
    controller.updateDirectionalContactHaptics(
      cue,
      startSeconds +
        (DIRECTIONAL_AUDIO_LEAD_MILLISECONDS +
          DIRECTIONAL_SCAN_BURST_INTERVAL_MILLISECONDS * 2) /
          1_000,
      1_000 +
        DIRECTIONAL_AUDIO_LEAD_MILLISECONDS +
        DIRECTIONAL_SCAN_BURST_INTERVAL_MILLISECONDS * 2,
    );
    for (const offsetSeconds of CONTACT_ACQUISITION_PULSE_OFFSETS_SECONDS) {
      controller.updateDirectionalContactHaptics(
        cue,
        startSeconds + offsetSeconds,
        1_000 + offsetSeconds * 1_000,
      );
    }

    expect(playEffect).toHaveBeenCalledTimes(
      DIRECTIONAL_SCAN_BURST_PULSE_COUNT + 5,
    );
    expect(
      playEffect.mock.calls.map(
        (call) => (call[1] as GamepadEffectParameters).duration,
      ),
    ).toEqual([70, 70, 70, 90, 90, 90, 90, 300]);
    expect(controller.directionalContactLockState).toMatchObject({
      pulseCount: 5,
      complete: false,
    });

    controller.updateDirectionalContactHaptics(
      cue,
      startSeconds + CONTACT_ACQUISITION_DWELL_SECONDS,
      1_000 + CONTACT_ACQUISITION_DWELL_SECONDS * 1_000,
    );
    expect(controller.directionalContactLockState).toMatchObject({
      progress: 1,
      pulseCount: 5,
      complete: true,
    });
    controller.stopDirectionalContactHaptics();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(controller.directionalContactLockState.started).toBe(false);
    expect(controller.hapticStatus).toContain("SOURCE LOCK · STOPPED");
    controller.dispose();
  });

  it("completes the same sequence without requiring rumble hardware", () => {
    const controller = controllerWithoutGamepad();
    const cue = profile();

    controller.updateDirectionalContactHaptics(cue, 0, 1_000);
    for (const offsetSeconds of CONTACT_ACQUISITION_PULSE_OFFSETS_SECONDS) {
      controller.updateDirectionalContactHaptics(
        cue,
        offsetSeconds,
        1_000 + offsetSeconds * 1_000,
      );
    }
    controller.updateDirectionalContactHaptics(
      cue,
      CONTACT_ACQUISITION_DWELL_SECONDS,
      1_000 + CONTACT_ACQUISITION_DWELL_SECONDS * 1_000,
    );

    expect(controller.directionalContactLockState).toEqual({
      started: true,
      progress: 1,
      pulseCount: 5,
      complete: true,
    });
    expect(controller.hapticStatus).toContain("NO GAMEPAD");
    controller.dispose();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function controllerWithGamepad(
  playEffect: ReturnType<typeof vi.fn>,
  reset: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined),
): InputController {
  const gamepad = {
    id: "AKULA QA PAD",
    index: 0,
    connected: true,
    mapping: "standard",
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({
      pressed: false,
      touched: false,
      value: 0,
    })),
    vibrationActuator: { effects: ["dual-rumble"], playEffect, reset },
  } as unknown as Gamepad;
  vi.stubGlobal("addEventListener", vi.fn());
  vi.stubGlobal("navigator", { getGamepads: () => [gamepad] });
  const controller = new InputController();
  controller.sample();
  return controller;
}

function controllerWithoutGamepad(): InputController {
  vi.stubGlobal("addEventListener", vi.fn());
  vi.stubGlobal("navigator", { getGamepads: () => [] });
  const controller = new InputController();
  controller.sample();
  return controller;
}
