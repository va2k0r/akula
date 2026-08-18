import {
  DIRECTIONAL_CONTACT_TERMINAL_BURST_DURATION_MILLISECONDS,
  directionalContactLockSchedule,
  type DirectionalContactHapticProfile,
  type DirectionalContactLockSchedule,
} from "./DirectionalContactHaptics";
import type { SeabedLidarHapticPulse } from "./SeabedLidar";

export interface ControlFrame {
  readonly turn: number;
  readonly dive: number;
  /** Raw standard-gamepad LT travel in the 0..1 range. */
  readonly leftTrigger: number;
  /** Raw standard-gamepad RT travel in the 0..1 range. */
  readonly rightTrigger: number;
  readonly ballast: number;
  /** One discrete telegraph step: -1 slower, +1 faster. */
  readonly throttleStep: number;
  /** The telegraph step requested specifically by LB/RB. */
  readonly gamepadThrottleStep: number;
  /** The LB/RB direction released during this frame. */
  readonly gamepadThrottleReleaseStep: number;
  readonly cameraYaw: number;
  readonly cameraPitch: number;
  /** Keyboard-only chase recenter; gamepad B is reserved for fire control. */
  readonly cameraCenter: boolean;
  readonly cameraMapToggle: boolean;
  /** B on a standard pad (T on keyboard): open or cancel weapon placement. */
  readonly torpedoPlan: boolean;
  readonly ping: boolean;
  readonly submit: boolean;
  readonly cancel: boolean;
  readonly digitSelectDelta: number;
  readonly digitValueDelta: number;
  readonly directDigit: number | undefined;
  readonly reset: boolean;
  readonly gamepadConnected: boolean;
  /** Safari has foreground focus but still needs fresh controller intent. */
  readonly gamepadWakePending: boolean;
}

const DEAD_ZONE = 0.16;
const GAMEPAD_WAKE_AXIS_THRESHOLD = 0.5;
const GAMEPAD_WAKE_BUTTON_THRESHOLD = 0.55;
const GAMEPAD_NEUTRAL_AXIS_THRESHOLD = 0.2;
const GAMEPAD_NEUTRAL_BUTTON_THRESHOLD = 0.12;
export const DEBUG_HAPTIC_MAGNITUDE_MULTIPLIER = 100;
export const DIRECTIONAL_AUDIO_LEAD_MILLISECONDS = 180;
export const DIRECTIONAL_SCAN_BURST_PULSE_COUNT = 3;
export const DIRECTIONAL_SCAN_BURST_INTERVAL_MILLISECONDS = 85;
export const DIRECTIONAL_SCAN_BURST_PULSE_DURATION_MILLISECONDS = 70;

export type GamepadWakePhase =
  "ready" | "unfocused" | "awaiting-input" | "awaiting-neutral";

export type TelegraphHapticFeedback = "arrived" | "limit";

export interface TelegraphHapticPulse {
  readonly delayMilliseconds: number;
  readonly durationMilliseconds: number;
  readonly strongMagnitude: number;
  readonly weakMagnitude: number;
}

export type DepthHapticDirection = "descent" | "ascent";

export interface DepthCreakHapticPulse extends TelegraphHapticPulse {
  readonly intervalMilliseconds: number;
  readonly triggerMagnitude: number;
  readonly direction: DepthHapticDirection;
}

export interface DirectionalContactLockState {
  readonly started: boolean;
  readonly progress: number;
  readonly pulseCount: number;
  readonly complete: boolean;
}

const DEPTH_CREAK_START_SPEED = 0.14;
const DEPTH_CREAK_FULL_SPEED = 3.2;
const DEPTH_CREAK_FULL_PRESSURE_METERS = 280;
const TELEGRAPH_ARRIVAL_PATTERN: readonly TelegraphHapticPulse[] = [
  {
    delayMilliseconds: 0,
    durationMilliseconds: 30,
    strongMagnitude: 0.48,
    weakMagnitude: 1,
  },
  {
    delayMilliseconds: 30,
    durationMilliseconds: 74,
    strongMagnitude: 1,
    weakMagnitude: 0.74,
  },
];

const TELEGRAPH_LIMIT_PATTERN: readonly TelegraphHapticPulse[] = [
  {
    delayMilliseconds: 0,
    durationMilliseconds: 28,
    strongMagnitude: 0.5,
    weakMagnitude: 0.86,
  },
  {
    delayMilliseconds: 58,
    durationMilliseconds: 42,
    strongMagnitude: 0.74,
    weakMagnitude: 0.52,
  },
];

interface LegacyHapticActuator {
  pulse(magnitude: number, duration: number): Promise<boolean>;
}

interface RuntimeGamepadHapticActuator extends GamepadHapticActuator {
  readonly effects?: readonly GamepadHapticEffectType[];
}

interface RuntimeGamepadHaptics {
  readonly vibrationActuator?: RuntimeGamepadHapticActuator | null;
  readonly hapticActuators?: readonly LegacyHapticActuator[];
}

export function telegraphHapticPattern(
  feedback: TelegraphHapticFeedback,
): readonly TelegraphHapticPulse[] {
  return feedback === "arrived"
    ? TELEGRAPH_ARRIVAL_PATTERN
    : TELEGRAPH_LIMIT_PATTERN;
}

export function telegraphHapticFeedbackForTransition(
  gamepadThrottleStep: number,
  previousThrottle: number,
  currentThrottle: number,
): TelegraphHapticFeedback | undefined {
  if (gamepadThrottleStep === 0) {
    return undefined;
  }
  return currentThrottle === previousThrottle ? "limit" : "arrived";
}

export function shouldPlayTelegraphClunkOnRelease(
  pendingStep: number,
  releasedStep: number,
): boolean {
  return releasedStep !== 0 && releasedStep === pendingStep;
}

export function depthCreakHapticPulse(
  depthRateMetersPerSecond: number,
  depthMeters: number,
): DepthCreakHapticPulse | undefined {
  const verticalSpeed = Math.abs(depthRateMetersPerSecond);
  if (verticalSpeed <= DEPTH_CREAK_START_SPEED) {
    return undefined;
  }
  const speedAmount = Math.min(
    1,
    (verticalSpeed - DEPTH_CREAK_START_SPEED) /
      (DEPTH_CREAK_FULL_SPEED - DEPTH_CREAK_START_SPEED),
  );
  const cadence = speedAmount ** 0.62;
  const normalizedDepth = Math.max(
    0,
    Math.min(1, (depthMeters - 12) / (DEPTH_CREAK_FULL_PRESSURE_METERS - 12)),
  );
  const pressure = normalizedDepth ** 0.7;
  return {
    intervalMilliseconds: Math.round(900 + (115 - 900) * cadence),
    durationMilliseconds: 56,
    delayMilliseconds: 0,
    triggerMagnitude: 0.25 + pressure * 0.75,
    direction: depthRateMetersPerSecond > 0 ? "descent" : "ascent",
    // Both pad motors remain depth-driven when impulse-trigger rumble is not
    // exposed by the browser. The weak motor keeps shallow clicks perceptible.
    strongMagnitude: 0.35 + pressure * 0.65,
    weakMagnitude: 0.55 + pressure * 0.45,
  };
}

export class InputController {
  private readonly abortController = new AbortController();
  private readonly heldKeys = new Set<string>();
  private readonly pressedKeys = new Set<string>();
  private readonly previousButtons = new Map<number, boolean>();
  private readonly hapticTimeouts = new Set<
    ReturnType<typeof globalThis.setTimeout>
  >();
  private activeGamepadIndex: number | undefined;
  private knownGamepadIndex: number | undefined;
  private lastGamepadTimestamp = 0;
  private gamepadWakePhaseValue: GamepadWakePhase = "ready";
  private hapticSupportValue = "NO GAMEPAD";
  private hapticResultValue = "IDLE";
  private hapticSequenceId = 0;
  private hapticExclusiveUntilMilliseconds = 0;
  private hapticMagnitudeMultiplier = 1;
  private nextDepthCreakMilliseconds = 0;
  private directionalContactLockSchedule:
    DirectionalContactLockSchedule | undefined;
  private directionalContactLockStartSeconds: number | undefined;
  private directionalContactLockNextPulseIndex = 0;
  private directionalContactLockProgress = 0;
  private directionalContactLockPulseCount = 0;
  private directionalContactLockComplete = false;
  private directionalContactActive = false;
  private directionalScanBurstPulsesPlayed = 0;
  private nextDirectionalScanBurstPulseMilliseconds = 0;
  private depthHapticDirection = 0;
  private directDigit: number | undefined;

  private readonly handleWindowBlur = (): void => {
    this.heldKeys.clear();
    this.pressedKeys.clear();
    this.directDigit = undefined;
    this.suspendGamepadForFocusLoss();
  };

  private readonly handleWindowFocus = (): void => {
    if (this.knownGamepadIndex === undefined) {
      this.gamepadWakePhaseValue = "ready";
      return;
    }
    this.activeGamepadIndex = undefined;
    this.previousButtons.clear();
    this.gamepadWakePhaseValue = "awaiting-input";
    this.hapticResultValue = "FOCUS · INPUT REQUIRED";
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.visibilityState !== "visible") {
      this.handleWindowBlur();
      return;
    }
    if (document.hasFocus()) {
      this.handleWindowFocus();
    }
  };

  private readonly handleGamepadDisconnected = (event: GamepadEvent): void => {
    if (
      event.gamepad.index !== this.knownGamepadIndex &&
      event.gamepad.index !== this.activeGamepadIndex
    ) {
      return;
    }
    this.stopActiveHaptics();
    this.activeGamepadIndex = undefined;
    this.knownGamepadIndex = undefined;
    this.lastGamepadTimestamp = 0;
    this.previousButtons.clear();
    this.gamepadWakePhaseValue =
      typeof document === "undefined" || document.hasFocus()
        ? "ready"
        : "unfocused";
    this.hapticSupportValue = "NO GAMEPAD";
    this.hapticResultValue = "DISCONNECTED";
    this.resetDepthHaptics();
    this.resetDirectionalContactHaptics();
  };

  public constructor() {
    globalThis.addEventListener(
      "keydown",
      (event) => {
        if (!event.repeat) {
          this.pressedKeys.add(event.code);
        }
        this.heldKeys.add(event.code);
        if (
          event.code === "Space" ||
          event.code.startsWith("Arrow") ||
          event.code === "Tab"
        ) {
          event.preventDefault();
        }
        const digit = parseDigitCode(event.code);
        if (digit !== undefined) {
          this.directDigit = digit;
        }
      },
      { signal: this.abortController.signal },
    );
    globalThis.addEventListener(
      "keyup",
      (event) => {
        this.heldKeys.delete(event.code);
      },
      { signal: this.abortController.signal },
    );
    globalThis.addEventListener("blur", this.handleWindowBlur, {
      signal: this.abortController.signal,
    });
    globalThis.addEventListener("focus", this.handleWindowFocus, {
      signal: this.abortController.signal,
    });
    globalThis.addEventListener(
      "gamepaddisconnected",
      this.handleGamepadDisconnected,
      { signal: this.abortController.signal },
    );
    if (typeof document !== "undefined") {
      document.addEventListener(
        "visibilitychange",
        this.handleVisibilityChange,
        { signal: this.abortController.signal },
      );
      if (document.visibilityState !== "visible" || !document.hasFocus()) {
        this.gamepadWakePhaseValue = "unfocused";
      }
    }
  }

  public sample(): ControlFrame {
    const detectedGamepad = firstStandardGamepad();
    const nextHapticSupport = describeHapticSupport(detectedGamepad);
    if (nextHapticSupport !== this.hapticSupportValue) {
      this.hapticSupportValue = nextHapticSupport;
      this.hapticResultValue = "IDLE";
    }
    const gamepad = this.resolveGamepadForControls(detectedGamepad);
    if (this.gamepadWakePhaseValue === "awaiting-input") {
      this.hapticResultValue = "FOCUS · MOVE STICK OR PRESS BUTTON";
    } else if (this.gamepadWakePhaseValue === "awaiting-neutral") {
      this.hapticResultValue = "FOCUS · RELEASE CONTROLS";
    }
    const button = (index: number): number =>
      gamepad?.buttons[index]?.value ?? 0;
    const buttonTransition = (
      index: number,
    ): Readonly<{ pressed: boolean; released: boolean }> => {
      const current =
        (gamepad?.buttons[index]?.pressed ?? false) || button(index) > 0.55;
      const previous = this.previousButtons.get(index) ?? false;
      this.previousButtons.set(index, current);
      return {
        pressed: current && !previous,
        released: !current && previous,
      };
    };
    const pressed = (index: number): boolean => buttonTransition(index).pressed;
    const axis = (index: number): number =>
      applyDeadZone(gamepad?.axes[index] ?? 0);

    const pilotAxes = standardPilotAxes(
      gamepad?.axes ?? [],
      Array.from(gamepad?.buttons ?? [], ({ value }) => value),
    );
    const turn = strongest(
      keyboardAxis(this.heldKeys, "KeyA", "KeyD"),
      pilotAxes.turn,
    );
    const dive = strongest(
      keyboardAxis(this.heldKeys, "KeyR", "KeyF"),
      pilotAxes.dive,
    );
    const ballast = keyboardAxis(this.heldKeys, "KeyB", "KeyG");
    const leftBumper = buttonTransition(4);
    const rightBumper = buttonTransition(5);
    const gamepadThrottleStep = standardTelegraphStep(
      leftBumper.pressed,
      rightBumper.pressed,
    );
    const gamepadThrottleReleaseStep = standardTelegraphStep(
      leftBumper.released,
      rightBumper.released,
    );
    const throttleStep =
      (this.wasPressed("KeyW") ? 1 : 0) -
      (this.wasPressed("KeyS") ? 1 : 0) +
      gamepadThrottleStep;
    const cameraYaw = strongest(
      keyboardAxis(this.heldKeys, "ArrowLeft", "ArrowRight"),
      axis(2),
    );
    const cameraPitch = strongest(
      keyboardAxis(this.heldKeys, "ArrowUp", "ArrowDown"),
      axis(3),
    );

    const digitSelectDelta =
      (this.wasPressed("BracketRight") || pressed(15) ? 1 : 0) -
      (this.wasPressed("BracketLeft") || pressed(14) ? 1 : 0);
    const digitValueDelta =
      (this.wasPressed("Equal") || pressed(12) ? 1 : 0) -
      (this.wasPressed("Minus") || pressed(13) ? 1 : 0);
    const directDigit = this.directDigit;
    this.directDigit = undefined;
    const cancelPressed = pressed(1);

    const frame: ControlFrame = {
      turn,
      dive,
      leftTrigger: pilotAxes.leftTrigger,
      rightTrigger: pilotAxes.rightTrigger,
      ballast,
      throttleStep,
      gamepadThrottleStep,
      gamepadThrottleReleaseStep,
      cameraYaw,
      cameraPitch,
      cameraCenter: this.wasPressed("KeyC"),
      cameraMapToggle:
        this.wasPressed("KeyM") || standardCameraMapToggle(pressed(11)),
      torpedoPlan:
        this.wasPressed("KeyT") || standardTorpedoPlanButton(cancelPressed),
      ping: this.wasPressed("KeyP") || pressed(3),
      submit: this.wasPressed("Enter") || pressed(0),
      cancel:
        this.wasPressed("Escape") || this.wasPressed("KeyC") || cancelPressed,
      digitSelectDelta,
      digitValueDelta,
      directDigit,
      reset: this.wasPressed("Backspace") || pressed(8),
      gamepadConnected:
        detectedGamepad !== undefined || this.knownGamepadIndex !== undefined,
      gamepadWakePending: this.gamepadWakePending,
    };

    this.pressedKeys.clear();
    if (gamepad === undefined) {
      this.previousButtons.clear();
    }
    return frame;
  }

  public get gamepadWakePending(): boolean {
    return (
      this.gamepadWakePhaseValue === "awaiting-input" ||
      this.gamepadWakePhaseValue === "awaiting-neutral"
    );
  }

  public get gamepadWakePhase(): GamepadWakePhase {
    return this.gamepadWakePhaseValue;
  }

  public get hapticStatus(): string {
    return `${this.hapticSupportValue} · ${this.hapticResultValue}`;
  }

  public get hapticMagnitudeScale(): number {
    return this.hapticMagnitudeMultiplier;
  }

  public setHapticMagnitudeMultiplier(multiplier: number): void {
    this.hapticMagnitudeMultiplier = Number.isFinite(multiplier)
      ? Math.min(DEBUG_HAPTIC_MAGNITUDE_MULTIPLIER, Math.max(0, multiplier))
      : 1;
  }

  public get directionalContactLockState(): DirectionalContactLockState {
    return {
      started: this.directionalContactLockStartSeconds !== undefined,
      progress: this.directionalContactLockProgress,
      pulseCount: this.directionalContactLockPulseCount,
      complete: this.directionalContactLockComplete,
    };
  }

  public playTelegraphFeedback(feedback: TelegraphHapticFeedback): void {
    this.playDualRumblePattern(
      telegraphHapticPattern(feedback),
      feedback.toUpperCase(),
    );
  }

  /**
   * Hull-pressure feedback follows the boat, not the control input: vertical
   * speed sets cadence while hydrostatic depth sets pulse strength.
   */
  public updateDepthHaptics(
    depthRateMetersPerSecond: number,
    depthMeters: number,
    nowMilliseconds = globalThis.performance.now(),
  ): void {
    const creak = depthCreakHapticPulse(depthRateMetersPerSecond, depthMeters);
    if (creak === undefined) {
      this.resetDepthHaptics();
      return;
    }
    const direction = creak.direction === "descent" ? 1 : -1;
    if (direction !== this.depthHapticDirection) {
      this.depthHapticDirection = direction;
      this.nextDepthCreakMilliseconds = 0;
    }
    if (this.nextDepthCreakMilliseconds > 0) {
      this.nextDepthCreakMilliseconds = Math.min(
        this.nextDepthCreakMilliseconds,
        nowMilliseconds + creak.intervalMilliseconds,
      );
    }
    if (
      nowMilliseconds >= this.nextDepthCreakMilliseconds &&
      nowMilliseconds >= this.hapticExclusiveUntilMilliseconds
    ) {
      this.playDepthCreak(creak, depthRateMetersPerSecond, depthMeters);
      this.nextDepthCreakMilliseconds =
        nowMilliseconds + creak.intervalMilliseconds;
      this.hapticExclusiveUntilMilliseconds =
        nowMilliseconds + creak.durationMilliseconds;
    }
  }

  /**
   * Entering the cone with sufficient haptic-quality signal starts a fresh lock
   * clock, then leaves one short perceptual lead for the soundtrack duck and
   * directional propeller before the three-tick scan burst. The lower-quality
   * audio-only stage never reaches this method as an active profile. The burst
   * is still over before the timed sequence begins after 0.75 continuous
   * seconds in the haptic stage.
   */
  public updateDirectionalContactHaptics(
    profile: DirectionalContactHapticProfile,
    playbackElapsedSeconds: number | undefined,
    nowMilliseconds = globalThis.performance.now(),
  ): void {
    if (
      !profile.active ||
      playbackElapsedSeconds === undefined ||
      !Number.isFinite(playbackElapsedSeconds) ||
      playbackElapsedSeconds < 0
    ) {
      if (this.directionalContactActive) {
        this.stopDirectionalContactHaptics();
      } else {
        this.resetDirectionalContactHaptics();
      }
      return;
    }

    if (this.directionalContactLockStartSeconds === undefined) {
      this.beginDirectionalContactLock(profile, playbackElapsedSeconds);
      this.nextDirectionalScanBurstPulseMilliseconds =
        nowMilliseconds + DIRECTIONAL_AUDIO_LEAD_MILLISECONDS;
    }
    this.updateDirectionalScanBurst(profile, nowMilliseconds);
    this.updateDirectionalContactLock(
      profile,
      playbackElapsedSeconds,
      nowMilliseconds,
    );
  }

  /** Stops the directional contact cue and clears its tactile sequence. */
  public stopDirectionalContactHaptics(): void {
    const completedLock = this.directionalContactLockComplete;
    if (this.directionalContactActive) {
      const gamepadIndex = this.activeGamepadIndex;
      const gamepad =
        gamepadIndex === undefined ? undefined : gamepadAtIndex(gamepadIndex);
      if (gamepad !== undefined) {
        const actuator = vibrationActuatorFor(gamepad);
        if (actuator !== undefined) {
          void actuator.reset().catch((error: unknown) => {
            console.warn("AKULA directional haptic stop failed.", error);
          });
        } else {
          const legacyActuator = legacyHapticActuatorFor(gamepad);
          if (legacyActuator !== undefined) {
            void legacyActuator.pulse(0, 0);
          }
        }
      }
    }
    this.resetDirectionalContactHaptics();
    if (completedLock) {
      this.hapticResultValue = "SOURCE LOCK · STOPPED";
    }
  }

  /**
   * Medium-priority floor echo: a short dual-motor knock synchronized with
   * the terrain return. It reserves its own brief gap so the faint directional
   * cue and hull creaks cannot blur the parking-sensor cadence.
   */
  public playSeabedLidarReturn(
    pulse: SeabedLidarHapticPulse,
    nowMilliseconds = globalThis.performance.now(),
  ): void {
    const gamepadIndex = this.activeGamepadIndex;
    const gamepad =
      gamepadIndex === undefined ? undefined : gamepadAtIndex(gamepadIndex);
    const feedbackLabel = `FLOOR ECHO ${Math.round(pulse.returnIntervalSeconds * 1_000)}MS`;
    if (gamepad === undefined) {
      this.hapticResultValue = `${feedbackLabel} · NO GAMEPAD`;
      return;
    }

    const sequenceId = ++this.hapticSequenceId;
    this.hapticExclusiveUntilMilliseconds =
      nowMilliseconds + pulse.durationMilliseconds;
    this.playImmediateHapticPulse(
      gamepad,
      {
        delayMilliseconds: 0,
        durationMilliseconds: pulse.durationMilliseconds,
        strongMagnitude: pulse.strongMagnitude,
        weakMagnitude: pulse.weakMagnitude,
      },
      feedbackLabel,
      sequenceId,
    );
  }

  public dispose(): void {
    this.abortController.abort();
    this.stopActiveHaptics();
    this.clearHapticTimeouts();
    this.heldKeys.clear();
    this.pressedKeys.clear();
    this.previousButtons.clear();
    this.resetDepthHaptics();
    this.stopDirectionalContactHaptics();
  }

  private resolveGamepadForControls(
    detectedGamepad: Gamepad | undefined,
  ): Gamepad | undefined {
    if (this.gamepadWakePhaseValue === "unfocused") {
      return undefined;
    }

    if (this.gamepadWakePhaseValue === "awaiting-input") {
      if (detectedGamepad === undefined) {
        return undefined;
      }
      this.knownGamepadIndex = detectedGamepad.index;
      if (!this.hasFreshGamepadIntent(detectedGamepad)) {
        return undefined;
      }
      this.beginGamepadWakeNeutralization(detectedGamepad);
      return undefined;
    }

    if (this.gamepadWakePhaseValue === "awaiting-neutral") {
      if (detectedGamepad === undefined) {
        this.gamepadWakePhaseValue = "awaiting-input";
        return undefined;
      }
      this.knownGamepadIndex = detectedGamepad.index;
      this.lastGamepadTimestamp = Math.max(
        this.lastGamepadTimestamp,
        finiteGamepadTimestamp(detectedGamepad),
      );
      if (!gamepadIsNeutral(detectedGamepad)) {
        return undefined;
      }
      this.gamepadWakePhaseValue = "ready";
      this.activeGamepadIndex = detectedGamepad.index;
      this.previousButtons.clear();
      this.hapticResultValue = "FOCUS READY";
      // Keep the neutral hand-off frame command-free. Gameplay resumes on the
      // following sample, after the wake gesture has been fully released.
      return undefined;
    }

    if (detectedGamepad === undefined) {
      if (this.activeGamepadIndex !== undefined) {
        this.knownGamepadIndex = this.activeGamepadIndex;
        this.activeGamepadIndex = undefined;
        this.previousButtons.clear();
        this.resetDepthHaptics();
        this.resetDirectionalContactHaptics();
        this.gamepadWakePhaseValue = "awaiting-input";
      }
      return undefined;
    }

    const changedGamepad =
      detectedGamepad.index !== this.activeGamepadIndex ||
      detectedGamepad.index !== this.knownGamepadIndex;
    if (changedGamepad) {
      this.resetDepthHaptics();
      this.resetDirectionalContactHaptics();
      this.previousButtons.clear();
      this.knownGamepadIndex = detectedGamepad.index;
      if (!gamepadIsNeutral(detectedGamepad)) {
        this.beginGamepadWakeNeutralization(detectedGamepad);
        return undefined;
      }
      this.activeGamepadIndex = detectedGamepad.index;
    }

    this.lastGamepadTimestamp = Math.max(
      this.lastGamepadTimestamp,
      finiteGamepadTimestamp(detectedGamepad),
    );
    return detectedGamepad;
  }

  private hasFreshGamepadIntent(gamepad: Gamepad): boolean {
    return (
      finiteGamepadTimestamp(gamepad) > this.lastGamepadTimestamp + 1e-6 ||
      gamepadHasExplicitIntent(gamepad)
    );
  }

  private beginGamepadWakeNeutralization(gamepad: Gamepad): void {
    this.activeGamepadIndex = undefined;
    this.knownGamepadIndex = gamepad.index;
    this.lastGamepadTimestamp = Math.max(
      this.lastGamepadTimestamp,
      finiteGamepadTimestamp(gamepad),
    );
    this.previousButtons.clear();
    this.resetDepthHaptics();
    this.resetDirectionalContactHaptics();
    this.gamepadWakePhaseValue = "awaiting-neutral";
  }

  private suspendGamepadForFocusLoss(): void {
    if (this.gamepadWakePhaseValue === "unfocused") {
      return;
    }
    this.stopActiveHaptics();
    this.clearHapticTimeouts();
    this.hapticSequenceId += 1;
    this.knownGamepadIndex ??= this.activeGamepadIndex;
    this.activeGamepadIndex = undefined;
    this.previousButtons.clear();
    this.resetDepthHaptics();
    this.resetDirectionalContactHaptics();
    this.gamepadWakePhaseValue = "unfocused";
    this.hapticResultValue = "FOCUS LOST";
  }

  private stopActiveHaptics(): void {
    const gamepadIndex = this.activeGamepadIndex;
    if (gamepadIndex === undefined) {
      return;
    }
    const gamepad = gamepadAtIndex(gamepadIndex);
    if (gamepad === undefined) {
      return;
    }
    const actuator = vibrationActuatorFor(gamepad);
    if (actuator !== undefined) {
      void actuator.reset().catch((error: unknown) => {
        console.warn("AKULA controller haptic focus reset failed.", error);
      });
      return;
    }
    const legacyActuator = legacyHapticActuatorFor(gamepad);
    if (legacyActuator !== undefined) {
      void legacyActuator.pulse(0, 0);
    }
  }

  private wasPressed(code: string): boolean {
    return this.pressedKeys.has(code);
  }

  private clearHapticTimeouts(): void {
    for (const timeout of this.hapticTimeouts) {
      globalThis.clearTimeout(timeout);
    }
    this.hapticTimeouts.clear();
  }

  private resetDepthHaptics(): void {
    this.nextDepthCreakMilliseconds = 0;
    this.depthHapticDirection = 0;
  }

  private resetDirectionalContactHaptics(): void {
    this.directionalContactLockSchedule = undefined;
    this.directionalContactLockStartSeconds = undefined;
    this.directionalContactLockNextPulseIndex = 0;
    this.directionalContactLockProgress = 0;
    this.directionalContactLockPulseCount = 0;
    this.directionalContactLockComplete = false;
    this.directionalContactActive = false;
    this.directionalScanBurstPulsesPlayed = 0;
    this.nextDirectionalScanBurstPulseMilliseconds = 0;
  }

  private updateDirectionalScanBurst(
    profile: DirectionalContactHapticProfile,
    nowMilliseconds: number,
  ): void {
    if (
      this.directionalScanBurstPulsesPlayed >=
        DIRECTIONAL_SCAN_BURST_PULSE_COUNT ||
      nowMilliseconds + 1e-7 < this.nextDirectionalScanBurstPulseMilliseconds ||
      nowMilliseconds < this.hapticExclusiveUntilMilliseconds
    ) {
      return;
    }

    const played = this.playDirectionalContactFragment(
      profile,
      DIRECTIONAL_SCAN_BURST_PULSE_DURATION_MILLISECONDS,
      1,
      `SOURCE SCAN TIC ${String(this.directionalScanBurstPulsesPlayed + 1)}/${String(DIRECTIONAL_SCAN_BURST_PULSE_COUNT)}`,
      DIRECTIONAL_SCAN_BURST_INTERVAL_MILLISECONDS,
    );
    if (!played) {
      // The controller may still be completing its foreground wake handshake.
      // Retry on the next frame instead of permanently losing the entry cue.
      return;
    }

    this.directionalContactActive = true;
    this.directionalScanBurstPulsesPlayed += 1;
    this.nextDirectionalScanBurstPulseMilliseconds =
      nowMilliseconds + DIRECTIONAL_SCAN_BURST_INTERVAL_MILLISECONDS;
    // Once this low-priority cue gets a free slot, let the short tick finish;
    // otherwise the later depth update in the same frame can erase it.
    this.hapticExclusiveUntilMilliseconds =
      nowMilliseconds + DIRECTIONAL_SCAN_BURST_PULSE_DURATION_MILLISECONDS;
  }

  private beginDirectionalContactLock(
    profile: DirectionalContactHapticProfile,
    playbackElapsedSeconds: number,
  ): void {
    const schedule = directionalContactLockSchedule(profile);
    if (
      schedule === undefined ||
      !Number.isFinite(playbackElapsedSeconds) ||
      playbackElapsedSeconds < 0
    ) {
      return;
    }
    this.directionalContactLockSchedule = schedule;
    this.directionalContactLockStartSeconds = playbackElapsedSeconds;
    this.directionalContactLockNextPulseIndex = 0;
    this.directionalContactLockProgress = 0;
    this.directionalContactLockPulseCount = 0;
    this.directionalContactLockComplete = false;
  }

  private updateDirectionalContactLock(
    profile: DirectionalContactHapticProfile,
    playbackElapsedSeconds: number,
    nowMilliseconds: number,
  ): void {
    const schedule = this.directionalContactLockSchedule;
    const startSeconds = this.directionalContactLockStartSeconds;
    if (schedule === undefined || startSeconds === undefined) {
      return;
    }
    const elapsedSeconds = playbackElapsedSeconds - startSeconds;
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < -1e-7) {
      this.resetDirectionalContactHaptics();
      return;
    }
    const completionSeconds =
      schedule.completionBeatOffset / schedule.gridFrequencyHertz;
    this.directionalContactLockProgress = Math.min(
      1,
      Math.max(0, elapsedSeconds) / completionSeconds,
    );

    const nextOffset =
      schedule.pulseBeatOffsets[this.directionalContactLockNextPulseIndex];
    const nextOffsetSeconds =
      nextOffset === undefined
        ? undefined
        : nextOffset / schedule.gridFrequencyHertz;
    if (
      nextOffset !== undefined &&
      nextOffsetSeconds !== undefined &&
      elapsedSeconds + 1e-7 >= nextOffsetSeconds
    ) {
      const previousOffset =
        schedule.pulseBeatOffsets[
          this.directionalContactLockNextPulseIndex - 1
        ] ?? 0;
      const intervalMilliseconds = Math.round(
        ((nextOffset - previousOffset) / schedule.gridFrequencyHertz) * 1_000,
      );
      const terminalBurst =
        this.directionalContactLockNextPulseIndex ===
        schedule.pulseBeatOffsets.length - 1;
      if (nowMilliseconds >= this.hapticExclusiveUntilMilliseconds) {
        const played = this.playDirectionalContactFragment(
          profile,
          terminalBurst
            ? DIRECTIONAL_CONTACT_TERMINAL_BURST_DURATION_MILLISECONDS
            : profile.durationMilliseconds,
          1,
          terminalBurst ? "SOURCE LOCK BBT" : "SOURCE LOCK",
          intervalMilliseconds,
        );
        this.directionalContactActive = this.directionalContactActive || played;
      }
      this.directionalContactLockNextPulseIndex += 1;
      this.directionalContactLockPulseCount += 1;
    }

    if (
      this.directionalContactLockNextPulseIndex >=
        schedule.pulseBeatOffsets.length &&
      elapsedSeconds + 1e-7 >= completionSeconds
    ) {
      this.directionalContactLockProgress = 1;
      this.directionalContactLockComplete = true;
    }
  }

  private playDirectionalContactFragment(
    profile: DirectionalContactHapticProfile,
    durationMilliseconds: number,
    magnitudeMultiplier: number,
    feedbackLabel: string,
    intervalMilliseconds = profile.intervalMilliseconds,
  ): boolean {
    const gamepadIndex = this.activeGamepadIndex;
    const gamepad =
      gamepadIndex === undefined ? undefined : gamepadAtIndex(gamepadIndex);
    if (gamepad === undefined) {
      this.hapticResultValue = "SOURCE FAINT · NO GAMEPAD";
      return false;
    }

    const sequenceId = ++this.hapticSequenceId;
    this.playImmediateHapticPulse(
      gamepad,
      {
        delayMilliseconds: 0,
        durationMilliseconds,
        strongMagnitude: clampUnit(
          profile.strongMagnitude * magnitudeMultiplier,
        ),
        weakMagnitude: clampUnit(profile.weakMagnitude * magnitudeMultiplier),
      },
      `${feedbackLabel} · ${String(intervalMilliseconds)}MS`,
      sequenceId,
    );
    return true;
  }

  private playDualRumblePattern(
    pattern: readonly TelegraphHapticPulse[],
    feedbackLabel: string,
  ): void {
    const gamepadIndex = this.activeGamepadIndex;
    if (gamepadIndex === undefined) {
      this.hapticResultValue = "NO GAMEPAD";
      return;
    }
    this.clearHapticTimeouts();
    const sequenceId = ++this.hapticSequenceId;
    this.hapticResultValue = `${feedbackLabel} QUEUED`;
    this.hapticExclusiveUntilMilliseconds =
      globalThis.performance.now() + hapticPatternDuration(pattern);
    const gamepad = gamepadAtIndex(gamepadIndex);
    if (gamepad === undefined) {
      this.hapticResultValue = "NO GAMEPAD";
      return;
    }
    for (const pulse of pattern) {
      if (pulse.delayMilliseconds === 0) {
        this.playImmediateHapticPulse(
          gamepad,
          pulse,
          feedbackLabel,
          sequenceId,
        );
        continue;
      }
      const timeout = globalThis.setTimeout(() => {
        this.hapticTimeouts.delete(timeout);
        const delayedGamepad = gamepadAtIndex(gamepadIndex);
        if (delayedGamepad !== undefined) {
          this.playImmediateHapticPulse(
            delayedGamepad,
            pulse,
            feedbackLabel,
            sequenceId,
          );
        }
      }, pulse.delayMilliseconds);
      this.hapticTimeouts.add(timeout);
    }
  }

  private playDepthCreak(
    pulse: DepthCreakHapticPulse,
    depthRateMetersPerSecond: number,
    depthMeters: number,
  ): void {
    const gamepadIndex = this.activeGamepadIndex;
    if (gamepadIndex === undefined) {
      this.hapticResultValue = "NO GAMEPAD";
      return;
    }
    const gamepad = gamepadAtIndex(gamepadIndex);
    if (gamepad === undefined) {
      this.hapticResultValue = "NO GAMEPAD";
      return;
    }
    const sequenceId = ++this.hapticSequenceId;
    const feedbackLabel = `${pulse.direction.toUpperCase()} CREAK ${Math.abs(depthRateMetersPerSecond).toFixed(1)}M/S · ${Math.round(depthMeters)}M`;
    const actuator = vibrationActuatorFor(gamepad);
    if (actuator !== undefined && supportsTriggerRumble(actuator)) {
      this.playTriggerHapticPulse(actuator, pulse, feedbackLabel, sequenceId);
      return;
    }
    this.playImmediateHapticPulse(gamepad, pulse, feedbackLabel, sequenceId);
  }

  private playImmediateHapticPulse(
    gamepad: Gamepad,
    pulse: TelegraphHapticPulse,
    feedbackLabel: string,
    sequenceId: number,
  ): void {
    const actuator = vibrationActuatorFor(gamepad);
    if (actuator !== undefined) {
      this.playModernHapticPulse(actuator, pulse, feedbackLabel, sequenceId);
      return;
    }

    const legacyActuator = legacyHapticActuatorFor(gamepad);
    if (legacyActuator === undefined) {
      this.hapticSupportValue = "RUMBLE UNAVAILABLE";
      this.hapticResultValue = `${feedbackLabel} NOT PLAYED`;
      return;
    }
    void legacyActuator
      .pulse(
        this.scaledHapticMagnitude(
          Math.max(pulse.strongMagnitude, pulse.weakMagnitude),
        ),
        pulse.durationMilliseconds,
      )
      .then(
        (played) => {
          if (sequenceId === this.hapticSequenceId) {
            this.hapticResultValue = `${feedbackLabel} ${played ? "COMPLETE" : "REJECTED"}`;
          }
        },
        (error: unknown) => {
          this.recordHapticError(feedbackLabel, error, sequenceId);
        },
      );
  }

  private playModernHapticPulse(
    actuator: RuntimeGamepadHapticActuator,
    pulse: TelegraphHapticPulse,
    feedbackLabel: string,
    sequenceId: number,
  ): void {
    void actuator
      .playEffect("dual-rumble", {
        duration: pulse.durationMilliseconds,
        strongMagnitude: this.scaledHapticMagnitude(pulse.strongMagnitude),
        weakMagnitude: this.scaledHapticMagnitude(pulse.weakMagnitude),
      })
      .then(
        (result) => {
          if (sequenceId === this.hapticSequenceId) {
            this.hapticResultValue = `${feedbackLabel} ${result.toUpperCase()}`;
          }
        },
        (error: unknown) => {
          this.recordHapticError(feedbackLabel, error, sequenceId);
        },
      );
  }

  private playTriggerHapticPulse(
    actuator: RuntimeGamepadHapticActuator,
    pulse: DepthCreakHapticPulse,
    feedbackLabel: string,
    sequenceId: number,
  ): void {
    void actuator
      .playEffect("trigger-rumble", {
        duration: pulse.durationMilliseconds,
        leftTrigger:
          pulse.direction === "descent"
            ? this.scaledHapticMagnitude(pulse.triggerMagnitude)
            : 0,
        rightTrigger:
          pulse.direction === "ascent"
            ? this.scaledHapticMagnitude(pulse.triggerMagnitude)
            : 0,
      })
      .then(
        (result) => {
          if (sequenceId === this.hapticSequenceId) {
            const triggerLabel = pulse.direction === "descent" ? "LT" : "RT";
            this.hapticResultValue = `${feedbackLabel} ${triggerLabel} ${result.toUpperCase()}`;
          }
        },
        (error: unknown) => {
          // A browser may advertise the effect while the connected controller
          // rejects it. Preserve the physical cue with the known dual-rumble
          // path instead of silently losing the click.
          if (sequenceId === this.hapticSequenceId) {
            this.playModernHapticPulse(
              actuator,
              pulse,
              `${feedbackLabel} PAD FALLBACK`,
              sequenceId,
            );
            console.warn(
              "AKULA depth haptic feedback fell back to pad rumble.",
              error,
            );
          }
        },
      );
  }

  private scaledHapticMagnitude(magnitude: number): number {
    return clampUnit(magnitude * this.hapticMagnitudeMultiplier);
  }

  private recordHapticError(
    feedbackLabel: string,
    error: unknown,
    sequenceId: number,
  ): void {
    if (sequenceId !== this.hapticSequenceId) {
      return;
    }
    const errorName = error instanceof DOMException ? error.name : "ERROR";
    this.hapticResultValue = `${feedbackLabel} ${errorName.toUpperCase()}`;
    console.warn("AKULA controller haptic feedback failed.", error);
  }
}

function gamepadAtIndex(index: number): Gamepad | undefined {
  if (navigator.getGamepads === undefined) {
    return undefined;
  }
  const gamepad = navigator.getGamepads()[index];
  return gamepad !== undefined && gamepad !== null && gamepad.connected
    ? gamepad
    : undefined;
}

function vibrationActuatorFor(
  gamepad: Gamepad,
): RuntimeGamepadHapticActuator | undefined {
  const actuator = (gamepad as unknown as RuntimeGamepadHaptics)
    .vibrationActuator;
  return actuator !== null &&
    actuator !== undefined &&
    typeof actuator.playEffect === "function"
    ? actuator
    : undefined;
}

function supportsTriggerRumble(
  actuator: RuntimeGamepadHapticActuator,
): boolean {
  return actuator.effects?.includes("trigger-rumble") ?? false;
}

function hapticPatternDuration(
  pattern: readonly TelegraphHapticPulse[],
): number {
  return pattern.reduce(
    (duration, pulse) =>
      Math.max(duration, pulse.delayMilliseconds + pulse.durationMilliseconds),
    0,
  );
}

function legacyHapticActuatorFor(
  gamepad: Gamepad,
): LegacyHapticActuator | undefined {
  return (gamepad as unknown as RuntimeGamepadHaptics).hapticActuators?.[0];
}

function describeHapticSupport(gamepad: Gamepad | undefined): string {
  if (gamepad === undefined) {
    return "NO GAMEPAD";
  }
  const actuator = vibrationActuatorFor(gamepad);
  if (actuator !== undefined) {
    return supportsTriggerRumble(actuator)
      ? "TRIGGER + DUAL READY"
      : "DUAL-RUMBLE READY";
  }
  if (legacyHapticActuatorFor(gamepad) !== undefined) {
    return "LEGACY RUMBLE READY";
  }
  return "RUMBLE UNAVAILABLE";
}

function finiteGamepadTimestamp(gamepad: Gamepad): number {
  return Number.isFinite(gamepad.timestamp) ? gamepad.timestamp : 0;
}

function gamepadHasExplicitIntent(gamepad: Gamepad): boolean {
  return (
    gamepad.buttons.some(
      (button) =>
        button.pressed || button.value > GAMEPAD_WAKE_BUTTON_THRESHOLD,
    ) ||
    gamepad.axes.some(
      (value) =>
        Number.isFinite(value) && Math.abs(value) > GAMEPAD_WAKE_AXIS_THRESHOLD,
    )
  );
}

function gamepadIsNeutral(gamepad: Gamepad): boolean {
  return (
    gamepad.buttons.every(
      (button) =>
        !button.pressed && button.value <= GAMEPAD_NEUTRAL_BUTTON_THRESHOLD,
    ) &&
    gamepad.axes.every(
      (value) =>
        !Number.isFinite(value) ||
        Math.abs(value) <= GAMEPAD_NEUTRAL_AXIS_THRESHOLD,
    )
  );
}

function firstStandardGamepad(): Gamepad | undefined {
  if (navigator.getGamepads === undefined) {
    return undefined;
  }
  return (
    Array.from(navigator.getGamepads()).find(
      (gamepad): gamepad is Gamepad =>
        gamepad !== null && gamepad.connected && gamepad.mapping === "standard",
    ) ?? undefined
  );
}

function keyboardAxis(
  keys: ReadonlySet<string>,
  negativeCode: string,
  positiveCode: string,
): number {
  return (keys.has(positiveCode) ? 1 : 0) - (keys.has(negativeCode) ? 1 : 0);
}

function strongest(left: number, right: number): number {
  return Math.abs(right) > Math.abs(left) ? right : left;
}

function applyDeadZone(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude <= DEAD_ZONE) {
    return 0;
  }
  return Math.sign(value) * ((magnitude - DEAD_ZONE) / (1 - DEAD_ZONE));
}

function clampTrigger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export function standardPilotAxes(
  axes: ReadonlyArray<number>,
  buttons: ReadonlyArray<number>,
): Readonly<{
  turn: number;
  dive: number;
  leftTrigger: number;
  rightTrigger: number;
}> {
  const leftTrigger = clampTrigger(buttons[6] ?? 0);
  const rightTrigger = clampTrigger(buttons[7] ?? 0);
  return {
    // Standard Gamepad axis 0 is negative left and positive right.
    turn: applyDeadZone(axes[0] ?? 0),
    // LT is dive; RT is rise.
    dive: leftTrigger - rightTrigger,
    leftTrigger,
    rightTrigger,
  };
}

export function standardTelegraphStep(
  leftBumperPressed: boolean,
  rightBumperPressed: boolean,
): number {
  return (rightBumperPressed ? 1 : 0) - (leftBumperPressed ? 1 : 0);
}

/** Standard button 11 is the right-stick click (R3). */
export function standardCameraMapToggle(rightStickPressed: boolean): boolean {
  return rightStickPressed;
}

/** Standard button 1 is B on Xbox-layout controllers. */
export function standardTorpedoPlanButton(buttonBPressed: boolean): boolean {
  return buttonBPressed;
}

function parseDigitCode(code: string): number | undefined {
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}
