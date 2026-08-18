import { MathUtils } from "three";

export interface MarineLifeVesselState {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly propulsionStopped: boolean;
  readonly propulsionIntensity: number;
}

export interface MarineLifeDisturbanceState extends MarineLifeVesselState {
  readonly propulsionRestarted: boolean;
}

export function didPropulsionRestart(
  previousPropulsionStopped: boolean | undefined,
  propulsionStopped: boolean,
): boolean {
  return previousPropulsionStopped === true && !propulsionStopped;
}

export function propulsionStartleStrength(
  distanceMeters: number,
  responseRadiusMeters: number,
  propulsionIntensity: number,
): number {
  if (responseRadiusMeters <= 0 || distanceMeters >= responseRadiusMeters) {
    return 0;
  }
  const proximity =
    1 -
    smoothstep(
      responseRadiusMeters * 0.28,
      responseRadiusMeters,
      Math.max(0, distanceMeters),
    );
  // Even SILENT starts a large shaft beside an animal. Higher telegraph
  // settings add urgency without making the first non-zero setting inert.
  const shaftImpulse = MathUtils.lerp(
    0.72,
    1,
    MathUtils.clamp(Math.abs(propulsionIntensity) / 0.52, 0, 1),
  );
  return proximity * shaftImpulse;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
}
