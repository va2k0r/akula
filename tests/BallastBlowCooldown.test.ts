import { describe, expect, it } from "vitest";
import {
  BALLAST_BLOW_COOLDOWN_SECONDS,
  BallastBlowCooldown,
} from "../src/game/BallastBlowCooldown";

describe("main-ballast blow cooldown", () => {
  it("accepts one blow and blocks new presses for nine seconds", () => {
    const cooldown = new BallastBlowCooldown();

    expect(cooldown.update(false, 0).triggered).toBe(false);
    const first = cooldown.update(true, 0);
    expect(first.triggered).toBe(true);
    expect(first.accepted).toBe(true);
    expect(first.remainingSeconds).toBe(BALLAST_BLOW_COOLDOWN_SECONDS);

    cooldown.update(false, 2);
    const blocked = cooldown.update(true, 0);
    expect(blocked.triggered).toBe(false);
    expect(blocked.accepted).toBe(false);
    expect(blocked.remainingSeconds).toBe(7);

    cooldown.update(false, 7);
    const second = cooldown.update(true, 0);
    expect(second.triggered).toBe(true);
    expect(second.accepted).toBe(true);
    expect(second.remainingSeconds).toBe(BALLAST_BLOW_COOLDOWN_SECONDS);
  });

  it("never repeats while the blow control remains held", () => {
    const cooldown = new BallastBlowCooldown();

    expect(cooldown.update(true, 0)).toMatchObject({
      triggered: true,
      accepted: true,
    });
    expect(cooldown.update(true, 12)).toMatchObject({
      triggered: false,
      accepted: true,
    });
    expect(cooldown.remainingSeconds).toBe(0);
    expect(cooldown.update(false, 0).triggered).toBe(false);
    expect(cooldown.update(true, 0).triggered).toBe(true);
  });
});
