import {
  mareanoChannelCenterAt,
  mareanoGameHeightAt,
} from "./MareanoBathymetry";

export interface IceKeel {
  readonly x: number;
  readonly z: number;
  readonly radiusX: number;
  readonly radiusZ: number;
  readonly keelDepth: number;
  readonly crownHeight: number;
  readonly rotation: number;
}

export interface SeafloorPockmark {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly depth: number;
}

export const MAP_HALF_WIDTH = 4_000;
export const MAP_HALF_LENGTH = 4_000;
export const WATER_SURFACE_Y = 0;
export const PLAYABLE_SEAFLOOR_DEPTH_RANGE_METERS = Object.freeze([
  -180, -22,
] as const);

/**
 * Four sparse shelf fields. Individual dimensions follow the common Barents
 * pockmarks documented by MAREANO: roughly 20-30 m across and 2-4 m deep.
 */
export const SEAFLOOR_POCKMARKS: readonly SeafloorPockmark[] = Object.freeze(
  createPockmarkFields(),
);

export const ICE_KEELS: readonly IceKeel[] = Object.freeze([
  {
    x: -545,
    z: 390,
    radiusX: 255,
    radiusZ: 165,
    keelDepth: 78,
    crownHeight: 25,
    rotation: 0.34,
  },
  {
    x: 555,
    z: 90,
    radiusX: 220,
    radiusZ: 145,
    keelDepth: 64,
    crownHeight: 29,
    rotation: -0.46,
  },
  {
    x: -650,
    z: -555,
    radiusX: 245,
    radiusZ: 170,
    keelDepth: 92,
    crownHeight: 34,
    rotation: 0.58,
  },
  {
    x: 505,
    z: -875,
    radiusX: 205,
    radiusZ: 138,
    keelDepth: 71,
    crownHeight: 26,
    rotation: -0.22,
  },
]);

/**
 * The chart's macro relief is the selected MAREANO multibeam patch. Only the
 * close-range pockmark bowls remain a gameplay-resolution enhancement because
 * a 20-30 m depression falls between runtime terrain vertices.
 */
export function terrainHeightAt(x: number, z: number): number {
  const surveyHeight = mareanoGameHeightAt(x, z);
  const surveyAmount = smootherstep(-310, -145, surveyHeight);
  const compressedDatum = lerp(-180, -68, surveyAmount);

  // The western edge is the playable near-coastal shelf. It is a deliberate
  // local vertical-datum transition over the unchanged survey morphology, not
  // a second unrelated height field.
  const coastalAmount = smootherstep(-2_950, -3_900, x);
  const coastalTarget =
    -34 + Math.sin(z * 0.0031) * 7 + Math.sin(z * 0.0097 + 1.4) * 3.5;
  const shelfHeight = lerp(
    compressedDatum,
    Math.max(compressedDatum, coastalTarget),
    coastalAmount,
  );

  return shelfHeight + sedimentaryReliefAt(x, z) + pockmarkReliefAt(x, z);
}

/** Meter-scale sand waves and scour that break up the 25 m render grid. */
export function sedimentaryReliefAt(x: number, z: number): number {
  const broadSandWave = Math.sin(x * 0.012 + z * 0.0064) * 2.4;
  const crossingBedform = Math.sin(x * 0.0047 - z * 0.0091 + 1.8) * 1.55;
  const localScour =
    Math.sin(x * 0.0205 + z * 0.0163) * Math.sin(x * 0.0038 - z * 0.0041) * 0.9;
  return broadSandWave + crossingBedform + localScour;
}

/** Small gas/fluid escape depressions shared by rendering and collision. */
export function pockmarkReliefAt(x: number, z: number): number {
  let relief = 0;
  for (const pockmark of SEAFLOOR_POCKMARKS) {
    const normalizedDistance =
      Math.hypot(x - pockmark.x, z - pockmark.z) / pockmark.radius;
    if (normalizedDistance >= 1.18) {
      continue;
    }
    const bowl =
      -pockmark.depth *
      (1 - smootherstep(0.08, 1, Math.min(1, normalizedDistance)));
    const rimDistance = (normalizedDistance - 0.91) / 0.12;
    const rim = pockmark.depth * 0.12 * Math.exp(-rimDistance * rimDistance);
    relief += bowl + rim;
  }
  return relief;
}

/**
 * Legacy public name retained for existing systems. The value is now a broad
 * trough guide extracted from the survey instead of a procedural sine curve.
 */
export function riftCenterAt(z: number): number {
  return mareanoChannelCenterAt(z);
}

/** Locate the strongest survey-derived wall on either side of the trough. */
export function channelWallAt(z: number, side: -1 | 1): number {
  const center = riftCenterAt(z);
  let bestX = clamp(center + side * 650, -MAP_HALF_WIDTH, MAP_HALF_WIDTH);
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let distance = 220; distance <= 1_600; distance += 55) {
    const x = center + side * distance;
    if (Math.abs(x) >= MAP_HALF_WIDTH - 90) {
      continue;
    }
    const inward = terrainHeightAt(x - side * 70, z);
    const outward = terrainHeightAt(x + side * 70, z);
    const crossWallRelief = Math.abs(outward - inward);
    const distanceBias = Math.abs(distance - 760) * 0.002;
    const score = crossWallRelief - distanceBias;
    if (score > bestScore) {
      bestScore = score;
      bestX = x;
    }
  }

  return bestX;
}

/** The lowest solid ice surface above the submarine at this map coordinate. */
export function iceCeilingAt(x: number, z: number): number {
  let ceiling = Number.POSITIVE_INFINITY;
  for (const keel of ICE_KEELS) {
    const cosine = Math.cos(-keel.rotation);
    const sine = Math.sin(-keel.rotation);
    const localX = (x - keel.x) * cosine - (z - keel.z) * sine;
    const localZ = (x - keel.x) * sine + (z - keel.z) * cosine;
    const normalized = Math.hypot(localX / keel.radiusX, localZ / keel.radiusZ);
    if (normalized >= 1) {
      continue;
    }

    const profile = Math.pow(1 - normalized, 0.62);
    const keelSurface = -3.5 - (keel.keelDepth - 3.5) * profile;
    ceiling = Math.min(ceiling, keelSurface);
  }
  return ceiling;
}

export function isInsideMap(x: number, z: number): boolean {
  return Math.abs(x) <= MAP_HALF_WIDTH && Math.abs(z) <= MAP_HALF_LENGTH;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function smoothstep(
  edge0: number,
  edge1: number,
  value: number,
): number {
  if (edge0 === edge1) {
    return value < edge0 ? 0 : 1;
  }
  const normalized = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function smootherstep(edge0: number, edge1: number, value: number): number {
  const normalized = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return (
    normalized *
    normalized *
    normalized *
    (normalized * (normalized * 6 - 15) + 10)
  );
}

function createPockmarkFields(): SeafloorPockmark[] {
  const fields = [
    { x: -860, z: 780, spreadX: 120, spreadZ: 150, count: 9 },
    { x: 880, z: -710, spreadX: 145, spreadZ: 120, count: 9 },
    { x: -1_720, z: -1_460, spreadX: 170, spreadZ: 180, count: 8 },
    { x: 1_780, z: 1_520, spreadX: 185, spreadZ: 150, count: 8 },
  ] as const;
  const pockmarks: SeafloorPockmark[] = [];
  let index = 0;
  for (const field of fields) {
    for (let localIndex = 0; localIndex < field.count; localIndex += 1) {
      const seed = index * 71 + 13;
      pockmarks.push({
        x: field.x + (seededNoise(seed + 1) - 0.5) * field.spreadX * 2,
        z: field.z + (seededNoise(seed + 2) - 0.5) * field.spreadZ * 2,
        radius: 10 + seededNoise(seed + 3) * 6,
        depth: 2 + seededNoise(seed + 4) * 2,
      });
      index += 1;
    }
  }
  return pockmarks;
}

function seededNoise(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43_758.5453;
  return value - Math.floor(value);
}
