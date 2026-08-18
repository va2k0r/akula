import { MathUtils } from "three";

export type NorthSeaWeatherPhase =
  "cold-clearing" | "salt-haze" | "rain-band" | "squall";

export interface NorthSeaEnvironmentState {
  readonly phase: NorthSeaWeatherPhase;
  readonly rain: number;
  readonly squall: number;
  readonly saltHaze: number;
  readonly clearing: number;
  readonly cloudCover: number;
  readonly windStrength: number;
  readonly surfaceVisibilityMeters: number;
  readonly daylight: number;
  readonly sunElevationRadians: number;
  readonly phytoplanktonBloom: number;
  readonly surfaceSuspension: number;
}

/**
 * A late-winter North Sea day condensed into a twenty-minute playable cycle.
 * The weather is spatial: the same front reaches a rig, ship and player at
 * different times instead of globally cross-fading the whole map.
 */
export function northSeaEnvironmentAt(
  elapsedSeconds: number,
  x: number,
  z: number,
): NorthSeaEnvironmentState {
  const localTime = elapsedSeconds + x * 0.11 - z * 0.057;
  const weatherCycle = positiveModulo(localTime, 720) / 720;
  const squall = bell(weatherCycle, 0.48, 0.075);
  const rainBand = Math.max(
    bell(weatherCycle, 0.35, 0.12),
    bell(weatherCycle, 0.61, 0.13) * 0.72,
  );
  const saltHaze = Math.max(
    bell(weatherCycle, 0.15, 0.16),
    bell(weatherCycle, 0.82, 0.18),
  );
  const clearing = MathUtils.clamp(
    1 - Math.max(saltHaze * 0.78, rainBand * 0.88, squall),
    0,
    1,
  );
  const rain = MathUtils.clamp(rainBand * 0.66 + squall * 0.62, 0, 1);
  const cloudCover = MathUtils.clamp(
    0.46 + saltHaze * 0.14 + rain * 0.27 + squall * 0.22 - clearing * 0.16,
    0.18,
    1,
  );
  const windStrength = MathUtils.clamp(
    0.46 + rain * 0.18 + squall * 0.38,
    0,
    1,
  );

  // Dawn and dusk stay low for long periods at 60-62 degrees north.
  const solarCycle = positiveModulo(elapsedSeconds + 130, 1_200) / 1_200;
  const solarWave = Math.sin(solarCycle * Math.PI * 2 - Math.PI / 2);
  const daylight = MathUtils.smoothstep(solarWave, -0.22, 0.42);
  const sunElevationRadians = MathUtils.lerp(
    MathUtils.degToRad(-5),
    MathUtils.degToRad(18),
    MathUtils.clamp((solarWave + 0.22) / 1.22, 0, 1),
  );

  // Late-winter baseline with local weather-driven mixing. A spring/summer
  // season can raise this constant without changing consumers.
  const phytoplanktonBloom = MathUtils.clamp(
    0.22 + clearing * 0.08 + rain * 0.035,
    0,
    1,
  );
  const surfaceSuspension = MathUtils.clamp(
    0.18 + windStrength * 0.32 + rain * 0.2,
    0,
    1,
  );
  const surfaceVisibilityMeters = MathUtils.lerp(
    7_200,
    620,
    MathUtils.clamp(saltHaze * 0.52 + rain * 0.3 + squall * 0.5, 0, 1),
  );

  const candidates = [
    ["squall", squall],
    ["rain-band", rain],
    ["salt-haze", saltHaze],
    ["cold-clearing", clearing],
  ] as const;
  const phase = candidates.reduce((strongest, candidate) =>
    candidate[1] > strongest[1] ? candidate : strongest,
  )[0];

  return {
    phase,
    rain,
    squall,
    saltHaze,
    clearing,
    cloudCover,
    windStrength,
    surfaceVisibilityMeters,
    daylight,
    sunElevationRadians,
    phytoplanktonBloom,
    surfaceSuspension,
  };
}

export function northSeaUnderwaterVisibilityMeters(
  baseVisibilityMeters: number,
  environment: NorthSeaEnvironmentState,
  floorClearanceMeters: number,
  wreckSuspension: number,
): number {
  const bottomSuspension =
    1 - MathUtils.smoothstep(Math.max(0, floorClearanceMeters), 7, 46);
  const attenuation = MathUtils.clamp(
    environment.phytoplanktonBloom * 0.34 +
      environment.surfaceSuspension * 0.2 +
      environment.rain * 0.08 +
      bottomSuspension * 0.38 +
      wreckSuspension * 0.42,
    0,
    0.78,
  );
  return Math.max(24, baseVisibilityMeters * (1 - attenuation));
}

export function marineParticleDensity(
  environment: NorthSeaEnvironmentState,
  floorClearanceMeters: number,
  wreckSuspension: number,
): number {
  const bottomSuspension =
    1 - MathUtils.smoothstep(Math.max(0, floorClearanceMeters), 5, 58);
  return MathUtils.clamp(
    0.2 +
      environment.phytoplanktonBloom * 0.36 +
      environment.surfaceSuspension * 0.18 +
      bottomSuspension * 0.62 +
      wreckSuspension * 0.74,
    0.14,
    1.65,
  );
}

/**
 * Aerial perspective for the surface scene. The floor gives ships and rigs
 * distinct distance planes even in nominally clear weather; the cap keeps the
 * storm haze from turning into an opaque draw-distance wall.
 */
export function northSeaSurfaceFogDensity(
  surfaceVisibilityMeters: number,
  visibleRain: number,
): number {
  const visibility = MathUtils.clamp(surfaceVisibilityMeters, 620, 7_200);
  const distanceDensity = 1.2 / visibility;
  const perspectiveFloor =
    0.00052 + MathUtils.clamp(visibleRain, 0, 1) * 0.00028;
  return MathUtils.clamp(
    Math.max(distanceDensity, perspectiveFloor),
    0.00052,
    0.00135,
  );
}

function bell(value: number, center: number, halfWidth: number): number {
  const distance = Math.abs(value - center);
  if (distance >= halfWidth) {
    return 0;
  }
  const normalized = 1 - distance / halfWidth;
  return normalized * normalized * (3 - 2 * normalized);
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
