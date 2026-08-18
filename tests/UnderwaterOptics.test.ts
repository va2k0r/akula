import { describe, expect, it } from "vitest";
import {
  underwaterTargetAmount,
  underwaterVisibilityMeters,
} from "../src/game/UnderwaterOptics";

describe("underwater optical transition", () => {
  it("cross-fades through the moving waterline without a hard visual cut", () => {
    expect(underwaterTargetAmount(-0.18)).toBe(0);
    expect(underwaterTargetAmount(0.27)).toBeCloseTo(0.5);
    expect(underwaterTargetAmount(0.72)).toBe(1);
  });

  it("limits visibility progressively as the camera descends", () => {
    expect(underwaterVisibilityMeters(0)).toBe(170);
    expect(underwaterVisibilityMeters(74)).toBeCloseTo(119);
    expect(underwaterVisibilityMeters(140)).toBe(68);
    expect(underwaterVisibilityMeters(400)).toBe(68);
  });

  it("never treats a camera above the local wave as deep water", () => {
    expect(underwaterVisibilityMeters(-30)).toBe(170);
    expect(underwaterTargetAmount(-30)).toBe(0);
  });
});
