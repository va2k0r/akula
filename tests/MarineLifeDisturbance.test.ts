import { describe, expect, it } from "vitest";
import {
  didPropulsionRestart,
  propulsionStartleStrength,
} from "../src/game/MarineLifeDisturbance";

describe("marine-life propulsion disturbance", () => {
  it("fires only on the first stopped-to-running frame", () => {
    expect(didPropulsionRestart(undefined, false)).toBe(false);
    expect(didPropulsionRestart(false, false)).toBe(false);
    expect(didPropulsionRestart(false, true)).toBe(false);
    expect(didPropulsionRestart(true, true)).toBe(false);
    expect(didPropulsionRestart(true, false)).toBe(true);
  });

  it("gives nearby animals an immediate response even at SILENT", () => {
    const silentStart = propulsionStartleStrength(8, 80, 0.16);
    const flankStart = propulsionStartleStrength(8, 80, 1);

    expect(silentStart).toBeGreaterThan(0.75);
    expect(flankStart).toBeGreaterThan(silentStart);
    expect(propulsionStartleStrength(80, 80, 1)).toBe(0);
    expect(propulsionStartleStrength(120, 80, 1)).toBe(0);
  });
});
