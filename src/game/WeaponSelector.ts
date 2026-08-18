export type WeaponCategoryId = "torpedo" | "missile" | "mine";

export interface WeaponCategory {
  readonly id: WeaponCategoryId;
  readonly russianName: string;
  readonly detail: string;
  readonly available: boolean;
}

export const WEAPON_CATEGORIES: readonly WeaponCategory[] = [
  {
    id: "torpedo",
    russianName: "ТОРПЕДЫ",
    detail: "533 ММ",
    available: true,
  },
  {
    id: "missile",
    russianName: "РАКЕТЫ",
    detail: "НЕ УСТАНОВЛЕНО",
    available: false,
  },
  {
    id: "mine",
    russianName: "МИНЫ",
    detail: "НЕ УСТАНОВЛЕНО",
    available: false,
  },
] as const;

export type WeaponDrumPosition = "previous" | "active" | "next";

export function cycleWeaponCategory(
  currentIndex: number,
  delta: number,
  count = WEAPON_CATEGORIES.length,
): number {
  if (count <= 0 || !Number.isFinite(currentIndex) || !Number.isFinite(delta)) {
    return 0;
  }
  const normalizedCurrent =
    ((Math.trunc(currentIndex) % count) + count) % count;
  const discreteDelta = Math.sign(delta);
  return (normalizedCurrent + discreteDelta + count) % count;
}

export function weaponDrumPosition(
  slotIndex: number,
  selectedIndex: number,
  count = WEAPON_CATEGORIES.length,
): WeaponDrumPosition {
  if (count <= 1 || slotIndex === selectedIndex) {
    return "active";
  }
  const forward = (((slotIndex - selectedIndex) % count) + count) % count;
  return forward <= count / 2 ? "next" : "previous";
}
