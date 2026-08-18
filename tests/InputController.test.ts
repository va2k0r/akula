import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InputController,
  depthCreakHapticPulse,
  standardCameraMapToggle,
  standardPilotAxes,
  standardTelegraphStep,
  standardTorpedoPlanButton,
  shouldPlayTelegraphClunkOnRelease,
  telegraphHapticFeedbackForTransition,
  telegraphHapticPattern,
} from "../src/game/InputController";

describe("standard gamepad pilot mapping", () => {
  it("maps left-stick right to starboard and left to port", () => {
    expect(standardPilotAxes([0.8], []).turn).toBeGreaterThan(0);
    expect(standardPilotAxes([-0.8], []).turn).toBeLessThan(0);
  });

  it("maps left trigger to dive and right trigger to rise", () => {
    const dive = standardPilotAxes([], [0, 0, 0, 0, 0, 0, 0.9, 0]);
    const rise = standardPilotAxes([], [0, 0, 0, 0, 0, 0, 0, 0.75]);

    expect(dive.dive).toBe(0.9);
    expect(dive.leftTrigger).toBe(0.9);
    expect(rise.dive).toBe(-0.75);
    expect(rise.rightTrigger).toBe(0.75);
  });

  it("uses vertical speed alone to set the creak cadence", () => {
    const slowDescent = depthCreakHapticPulse(0.5, 80);
    const fastDescent = depthCreakHapticPulse(2.8, 80);
    const fastAscent = depthCreakHapticPulse(-2.8, 80);

    expect(depthCreakHapticPulse(0.08, 280)).toBeUndefined();
    expect(fastDescent?.intervalMilliseconds).toBeLessThan(
      slowDescent?.intervalMilliseconds ?? 0,
    );
    expect(fastAscent?.intervalMilliseconds).toBe(
      fastDescent?.intervalMilliseconds,
    );
    expect(fastDescent?.strongMagnitude).toBe(slowDescent?.strongMagnitude);
    expect(fastDescent?.direction).toBe("descent");
    expect(fastAscent?.direction).toBe("ascent");
  });

  it("uses depth alone to set creak intensity", () => {
    const shallow = depthCreakHapticPulse(1.4, 20);
    const deep = depthCreakHapticPulse(1.4, 220);

    expect(deep?.intervalMilliseconds).toBe(shallow?.intervalMilliseconds);
    expect(deep?.triggerMagnitude).toBeGreaterThan(
      shallow?.triggerMagnitude ?? 1,
    );
    expect(deep?.strongMagnitude).toBeGreaterThan(
      shallow?.strongMagnitude ?? 1,
    );
    expect(deep?.weakMagnitude).toBeGreaterThan(shallow?.weakMagnitude ?? 1);
  });

  it("maps LB to brake and RB to the next faster telegraph", () => {
    expect(standardTelegraphStep(true, false)).toBe(-1);
    expect(standardTelegraphStep(false, true)).toBe(1);
    expect(standardTelegraphStep(false, false)).toBe(0);
  });

  it("maps R3 to the tactical camera toggle", () => {
    expect(standardCameraMapToggle(true)).toBe(true);
    expect(standardCameraMapToggle(false)).toBe(false);
  });

  it("maps B to torpedo run-to-enable placement", () => {
    expect(standardTorpedoPlanButton(true)).toBe(true);
    expect(standardTorpedoPlanButton(false)).toBe(false);
  });

  it("plays a sharp attack and heavy clunk on bumper release", () => {
    const pattern = telegraphHapticPattern("arrived");

    expect(pattern).toHaveLength(2);
    expect(pattern[0]?.delayMilliseconds).toBe(0);
    expect(pattern[0]?.weakMagnitude).toBe(1);
    expect(pattern[1]?.delayMilliseconds).toBe(
      pattern[0]?.durationMilliseconds,
    );
    expect(pattern[1]?.strongMagnitude).toBeGreaterThan(
      pattern[1]?.weakMagnitude ?? 1,
    );
  });

  it("only plays the arrival clunk for the matching bumper release", () => {
    expect(shouldPlayTelegraphClunkOnRelease(1, 1)).toBe(true);
    expect(shouldPlayTelegraphClunkOnRelease(-1, -1)).toBe(true);
    expect(shouldPlayTelegraphClunkOnRelease(1, -1)).toBe(false);
    expect(shouldPlayTelegraphClunkOnRelease(1, 0)).toBe(false);
  });

  it("uses a distinct double knock at the telegraph limits", () => {
    const pattern = telegraphHapticPattern("limit");

    expect(pattern).toHaveLength(2);
    expect(pattern[0]?.delayMilliseconds).toBe(0);
    expect(pattern[1]?.delayMilliseconds).toBeGreaterThan(
      pattern[0]?.durationMilliseconds ?? 0,
    );
  });

  it("distinguishes a reached detent from a blocked end stop", () => {
    expect(telegraphHapticFeedbackForTransition(1, 0.16, 0.52)).toBe("arrived");
    expect(telegraphHapticFeedbackForTransition(1, 1, 1)).toBe("limit");
    expect(telegraphHapticFeedbackForTransition(-1, -0.22, -0.22)).toBe(
      "limit",
    );
    expect(telegraphHapticFeedbackForTransition(0, 0.16, 0.52)).toBeUndefined();
  });
});

describe("gamepad focus wake lifecycle", () => {
  it("swallows the bumper that makes Safari expose the pad again", () => {
    const gamepad = mutableStandardGamepad();
    const harness = installGamepadHarness([gamepad]);
    const controller = new InputController();

    expect(controller.sample()).toMatchObject({
      gamepadConnected: true,
      gamepadWakePending: false,
    });

    harness.dispatch("blur");
    harness.dispatch("focus");
    harness.setGamepads([]);
    expect(controller.sample()).toMatchObject({
      gamepadConnected: true,
      gamepadWakePending: true,
      gamepadThrottleStep: 0,
    });

    gamepad.timestamp = 2;
    setButton(gamepad, 5, true);
    harness.setGamepads([gamepad]);
    expect(controller.sample()).toMatchObject({
      gamepadWakePending: true,
      throttleStep: 0,
      gamepadThrottleStep: 0,
    });

    gamepad.timestamp = 3;
    setButton(gamepad, 5, false);
    expect(controller.sample()).toMatchObject({
      gamepadWakePending: false,
      throttleStep: 0,
      gamepadThrottleReleaseStep: 0,
    });

    gamepad.timestamp = 4;
    setButton(gamepad, 5, true);
    expect(controller.sample()).toMatchObject({
      gamepadWakePending: false,
      throttleStep: 1,
      gamepadThrottleStep: 1,
    });

    controller.dispose();
  });

  it("accepts a deliberate stick wake without requiring a bumper", () => {
    const gamepad = mutableStandardGamepad();
    const harness = installGamepadHarness([gamepad]);
    const controller = new InputController();
    controller.sample();

    harness.dispatch("blur");
    harness.dispatch("focus");
    gamepad.timestamp = 2;
    gamepad.axes[0] = 0.82;

    expect(controller.sample()).toMatchObject({
      gamepadWakePending: true,
      turn: 0,
    });

    gamepad.timestamp = 3;
    gamepad.axes[0] = 0;
    expect(controller.sample()).toMatchObject({
      gamepadWakePending: false,
      turn: 0,
    });

    gamepad.timestamp = 4;
    gamepad.axes[0] = 0.82;
    expect(controller.sample().turn).toBeGreaterThan(0.7);

    controller.dispose();
  });

  it("does not execute the first held button when a pad appears", () => {
    const gamepad = mutableStandardGamepad();
    const harness = installGamepadHarness([]);
    const controller = new InputController();
    controller.sample();

    setButton(gamepad, 4, true);
    gamepad.timestamp = 2;
    harness.setGamepads([gamepad]);

    expect(controller.sample()).toMatchObject({
      gamepadConnected: true,
      gamepadWakePending: true,
      throttleStep: 0,
      gamepadThrottleStep: 0,
    });

    setButton(gamepad, 4, false);
    gamepad.timestamp = 3;
    expect(controller.sample()).toMatchObject({
      gamepadWakePending: false,
      gamepadThrottleReleaseStep: 0,
    });

    controller.dispose();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface MutableGamepadButton {
  pressed: boolean;
  touched: boolean;
  value: number;
}

interface MutableGamepad {
  readonly id: string;
  readonly index: number;
  readonly connected: boolean;
  readonly mapping: GamepadMappingType;
  timestamp: number;
  readonly axes: number[];
  readonly buttons: MutableGamepadButton[];
}

function mutableStandardGamepad(): MutableGamepad {
  return {
    id: "AKULA FOCUS QA PAD",
    index: 0,
    connected: true,
    mapping: "standard",
    timestamp: 1,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({
      pressed: false,
      touched: false,
      value: 0,
    })),
  };
}

function setButton(
  gamepad: MutableGamepad,
  index: number,
  pressed: boolean,
): void {
  const button = gamepad.buttons[index];
  if (button === undefined) {
    throw new Error(`Missing test gamepad button ${String(index)}`);
  }
  button.pressed = pressed;
  button.touched = pressed;
  button.value = pressed ? 1 : 0;
}

function installGamepadHarness(initialGamepads: MutableGamepad[]): Readonly<{
  dispatch: (type: string) => void;
  setGamepads: (gamepads: MutableGamepad[]) => void;
}> {
  const listeners = new Map<string, EventListener[]>();
  let gamepads = initialGamepads;
  vi.stubGlobal(
    "addEventListener",
    vi.fn(
      (type: string, listener: EventListenerOrEventListenerObject): void => {
        const callback: EventListener =
          typeof listener === "function"
            ? listener
            : (event) => listener.handleEvent(event);
        const registered = listeners.get(type) ?? [];
        registered.push(callback);
        listeners.set(type, registered);
      },
    ),
  );
  vi.stubGlobal("navigator", {
    getGamepads: () => gamepads as unknown as Gamepad[],
  });
  return {
    dispatch: (type) => {
      for (const listener of listeners.get(type) ?? []) {
        listener(new Event(type));
      }
    },
    setGamepads: (nextGamepads) => {
      gamepads = nextGamepads;
    },
  };
}
