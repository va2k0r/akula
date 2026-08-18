import { describe, expect, it } from "vitest";
import {
  WEAPON_CATEGORIES,
  cycleWeaponCategory,
  weaponDrumPosition,
} from "../src/game/WeaponSelector";

describe("strategic weapon selector", () => {
  it("cycles through torpedoes, missiles, and mines in both directions", () => {
    expect(cycleWeaponCategory(0, 1)).toBe(1);
    expect(cycleWeaponCategory(1, 1)).toBe(2);
    expect(cycleWeaponCategory(2, 1)).toBe(0);
    expect(cycleWeaponCategory(0, -1)).toBe(2);
  });

  it("keeps only torpedoes active in this increment", () => {
    expect(WEAPON_CATEGORIES.map(({ id }) => id)).toEqual([
      "torpedo",
      "missile",
      "mine",
    ]);
    expect(WEAPON_CATEGORIES.filter(({ available }) => available)).toEqual([
      expect.objectContaining({ id: "torpedo", russianName: "ТОРПЕДЫ" }),
    ]);
  });

  it("places the neighboring chambers above and below the active chamber", () => {
    expect(weaponDrumPosition(0, 0)).toBe("active");
    expect(weaponDrumPosition(1, 0)).toBe("next");
    expect(weaponDrumPosition(2, 0)).toBe("previous");
  });
});
