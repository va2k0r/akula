import { WATER_SURFACE_Y } from "./WorldGeometry";

const GRAVITY = 9.81;
const TAU = Math.PI * 2;

export const MAX_OCEAN_COMPONENTS = 72;

const FREQUENCY_CDF_SAMPLES = 512;
const DIRECTION_CDF_SAMPLES = 256;
const GOLDEN_RATIO_CONJUGATE = 0.618_033_988_749_894_9;

export type OceanBand = "wind-sea" | "swell";

export interface JonswapSpectrumSpec {
  readonly band: OceanBand;
  /** Significant wave height in metres. */
  readonly significantHeight: number;
  /** Spectral peak period in seconds. */
  readonly peakPeriod: number;
  /** JONSWAP peak-enhancement factor. */
  readonly gamma: number;
  /** Direction travelled toward, in world-space radians from +X. */
  readonly directionRadians: number;
  /** Half-width of the directional fan, in radians. */
  readonly directionalSpread: number;
  readonly directionalConcentration: number;
  /** Stratification counts; their product is the stochastic mode count. */
  readonly frequencyBins: number;
  readonly directionalBins: number;
  readonly minimumFrequencyRatio: number;
  readonly maximumFrequencyRatio: number;
  /** Target horizontal fold strength for the Gerstner evaluation. */
  readonly choppiness: number;
}

export interface OceanWaveComponent {
  readonly band: OceanBand;
  readonly directionX: number;
  readonly directionZ: number;
  readonly amplitude: number;
  readonly waveNumber: number;
  readonly angularFrequency: number;
  readonly phase: number;
  readonly horizontalAmplitude: number;
}

export interface OceanSurfaceSample {
  readonly height: number;
  readonly verticalVelocity: number;
  readonly horizontalX: number;
  readonly horizontalZ: number;
  readonly normalX: number;
  readonly normalY: number;
  readonly normalZ: number;
}

export interface BimodalSeaState {
  readonly windSea: JonswapSpectrumSpec;
  readonly swell: JonswapSpectrumSpec;
}

/**
 * Open northern North Sea gale: a steep, locally generated wind sea crossing
 * a lower Atlantic swell. The combined Hs is about 7.1 m (a "high" sea), but
 * neither band is an implausible tsunami-like wall on its own.
 */
export const NORTH_ATLANTIC_SEA_STATE: BimodalSeaState = Object.freeze({
  windSea: Object.freeze({
    band: "wind-sea",
    significantHeight: 6.3,
    peakPeriod: 8.2,
    gamma: 3.3,
    directionRadians: degrees(-48),
    directionalSpread: degrees(42),
    directionalConcentration: 0.85,
    frequencyBins: 12,
    directionalBins: 5,
    minimumFrequencyRatio: 0.55,
    maximumFrequencyRatio: 2.15,
    choppiness: 0.82,
  }),
  swell: Object.freeze({
    band: "swell",
    significantHeight: 3.2,
    peakPeriod: 12.8,
    gamma: 4.5,
    directionRadians: degrees(-92),
    directionalSpread: degrees(14),
    directionalConcentration: 2.4,
    frequencyBins: 4,
    directionalBins: 3,
    minimumFrequencyRatio: 0.72,
    maximumFrequencyRatio: 1.36,
    choppiness: 0.16,
  }),
});

export function createBimodalJonswapSea(
  state: BimodalSeaState = NORTH_ATLANTIC_SEA_STATE,
): readonly OceanWaveComponent[] {
  const windSea = createJonswapBand(state.windSea, 0x971);
  const swell = createJonswapBand(state.swell, 0x5a17);
  const combined = [...swell, ...windSea];
  if (combined.length > MAX_OCEAN_COMPONENTS) {
    throw new Error(
      `Ocean spectrum has ${combined.length} components; maximum is ${MAX_OCEAN_COMPONENTS}.`,
    );
  }
  return Object.freeze(combined);
}

export const NORTH_ATLANTIC_WAVES = createBimodalJonswapSea();

export function significantWaveHeight(
  components: readonly OceanWaveComponent[],
  band?: OceanBand,
): number {
  let variance = 0;
  for (const component of components) {
    if (band === undefined || component.band === band) {
      variance += (component.amplitude * component.amplitude) / 2;
    }
  }
  return 4 * Math.sqrt(variance);
}

export function sampleOceanSurface(
  components: readonly OceanWaveComponent[],
  x: number,
  z: number,
  time: number,
): OceanSurfaceSample {
  let restX = x;
  let restZ = z;
  let sample = evaluateRestSurface(components, restX, restZ, time);

  // Gerstner components displace points horizontally. Resolve the rest point
  // that actually appears above (x,z), so gameplay and rendered crests agree.
  for (let iteration = 0; iteration < 3; iteration += 1) {
    restX = x - sample.horizontalX;
    restZ = z - sample.horizontalZ;
    sample = evaluateRestSurface(components, restX, restZ, time);
  }
  return sample;
}

function createJonswapBand(
  spec: JonswapSpectrumSpec,
  seed: number,
): readonly OceanWaveComponent[] {
  validateSpectrum(spec);
  const peakOmega = TAU / spec.peakPeriod;
  const minimumOmega = peakOmega * spec.minimumFrequencyRatio;
  const maximumOmega = peakOmega * spec.maximumFrequencyRatio;
  const componentCount = spec.frequencyBins * spec.directionalBins;
  const frequencyCdf = createSampledCdf(
    minimumOmega,
    maximumOmega,
    FREQUENCY_CDF_SAMPLES,
    (omega) => jonswapShape(omega, peakOmega, spec.gamma),
  );
  const directionCdf = createSampledCdf(
    -spec.directionalSpread,
    spec.directionalSpread,
    DIRECTION_CDF_SAMPLES,
    (offset) => {
      const unit = offset / Math.max(spec.directionalSpread, Number.EPSILON);
      return Math.pow(
        Math.max(0, Math.cos((unit * Math.PI) / 2)),
        2 * spec.directionalConcentration,
      );
    },
  );
  const targetVariance = Math.pow(spec.significantHeight / 4, 2);
  const amplitude = Math.sqrt((2 * targetVariance) / componentCount);
  const provisional: Array<Omit<OceanWaveComponent, "horizontalAmplitude">> =
    [];

  // Equal-energy, low-discrepancy samples approximate the continuous
  // directional spectrum without the repeated frequency/direction lattice
  // that makes a small Gerstner set read as parallel rolling hills.
  for (let index = 0; index < componentCount; index += 1) {
    const frequencyQuantile = clamp01(
      (index + 0.5 + (hash01(seed + index * 1_013) - 0.5) * 0.68) /
        componentCount,
    );
    const directionQuantile = fractionalPart(
      hash01(seed ^ 0x6d2b_79f5) + (index + 0.5) * GOLDEN_RATIO_CONJUGATE,
    );
    const omega = sampleCdf(frequencyCdf, frequencyQuantile);
    const direction =
      spec.directionRadians + sampleCdf(directionCdf, directionQuantile);
    const waveNumber = (omega * omega) / GRAVITY;
    provisional.push({
      band: spec.band,
      directionX: Math.cos(direction),
      directionZ: Math.sin(direction),
      amplitude,
      waveNumber,
      angularFrequency: omega,
      phase: hash01(seed + index * 7_919 + 0x51ed) * TAU,
    });
  }

  let summedSteepness = 0;
  for (const component of provisional) {
    summedSteepness += component.waveNumber * component.amplitude;
  }
  // Non-linear crest sharpening: a strict 1:1 Gerstner orbit leaves long
  // swell looking sinusoidal at game scale. The target remains bounded by
  // each band's aggregate steepness, well below self-intersection.
  const horizontalRatio = Math.min(
    3.5,
    spec.choppiness / Math.max(summedSteepness, 0.001),
  );

  return Object.freeze(
    provisional.map((component) =>
      Object.freeze({
        ...component,
        horizontalAmplitude: component.amplitude * horizontalRatio,
      }),
    ),
  );
}

interface SampledCdf {
  readonly minimum: number;
  readonly step: number;
  readonly cumulative: readonly number[];
  readonly total: number;
}

function createSampledCdf(
  minimum: number,
  maximum: number,
  sampleCount: number,
  weightAt: (value: number) => number,
): SampledCdf {
  const step = (maximum - minimum) / sampleCount;
  const cumulative: number[] = [];
  let total = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const value = minimum + (index + 0.5) * step;
    total += Math.max(0, weightAt(value));
    cumulative.push(total);
  }
  if (total <= Number.EPSILON) {
    throw new Error("Ocean spectrum has no sampleable energy.");
  }
  return { minimum, step, cumulative: Object.freeze(cumulative), total };
}

function sampleCdf(cdf: SampledCdf, quantile: number): number {
  const target = clamp01(quantile) * cdf.total;
  let low = 0;
  let high = cdf.cumulative.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((cdf.cumulative[middle] ?? cdf.total) < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  const previous = low === 0 ? 0 : (cdf.cumulative[low - 1] ?? 0);
  const current = cdf.cumulative[low] ?? cdf.total;
  const withinBin =
    (target - previous) / Math.max(current - previous, Number.EPSILON);
  return cdf.minimum + (low + clamp01(withinBin)) * cdf.step;
}

function jonswapShape(omega: number, peakOmega: number, gamma: number): number {
  const sigma = omega <= peakOmega ? 0.07 : 0.09;
  const peakExponent = Math.exp(
    -Math.pow(omega - peakOmega, 2) /
      (2 * sigma * sigma * peakOmega * peakOmega),
  );
  return (
    GRAVITY *
    GRAVITY *
    Math.pow(omega, -5) *
    Math.exp(-1.25 * Math.pow(peakOmega / omega, 4)) *
    Math.pow(gamma, peakExponent)
  );
}

function evaluateRestSurface(
  components: readonly OceanWaveComponent[],
  x: number,
  z: number,
  time: number,
): OceanSurfaceSample {
  let height = WATER_SURFACE_Y;
  let verticalVelocity = 0;
  let horizontalX = 0;
  let horizontalZ = 0;

  let dPdxX = 1;
  let dPdxY = 0;
  let dPdxZ = 0;
  let dPdzX = 0;
  let dPdzY = 0;
  let dPdzZ = 1;

  for (const component of components) {
    const theta =
      component.waveNumber *
        (component.directionX * x + component.directionZ * z) -
      component.angularFrequency * time +
      component.phase;
    const sine = Math.sin(theta);
    const cosine = Math.cos(theta);
    const slope = component.amplitude * component.waveNumber * cosine;
    const horizontalDerivative =
      -component.horizontalAmplitude * component.waveNumber * sine;

    height += component.amplitude * sine;
    verticalVelocity -=
      component.amplitude * component.angularFrequency * cosine;
    horizontalX +=
      component.directionX * component.horizontalAmplitude * cosine;
    horizontalZ +=
      component.directionZ * component.horizontalAmplitude * cosine;

    dPdxX += horizontalDerivative * component.directionX * component.directionX;
    dPdxY += slope * component.directionX;
    dPdxZ += horizontalDerivative * component.directionX * component.directionZ;
    dPdzX += horizontalDerivative * component.directionZ * component.directionX;
    dPdzY += slope * component.directionZ;
    dPdzZ += horizontalDerivative * component.directionZ * component.directionZ;
  }

  // Cross(dP/dz, dP/dx) points upward for the undeformed XZ plane.
  const normalX = dPdzY * dPdxZ - dPdzZ * dPdxY;
  const normalY = dPdzZ * dPdxX - dPdzX * dPdxZ;
  const normalZ = dPdzX * dPdxY - dPdzY * dPdxX;
  const inverseNormalLength =
    1 / Math.max(Math.hypot(normalX, normalY, normalZ), Number.EPSILON);

  return Object.freeze({
    height,
    verticalVelocity,
    horizontalX,
    horizontalZ,
    normalX: normalX * inverseNormalLength,
    normalY: normalY * inverseNormalLength,
    normalZ: normalZ * inverseNormalLength,
  });
}

function validateSpectrum(spec: JonswapSpectrumSpec): void {
  if (
    spec.significantHeight <= 0 ||
    spec.peakPeriod <= 0 ||
    spec.gamma < 1 ||
    spec.frequencyBins < 1 ||
    spec.directionalBins < 1 ||
    spec.maximumFrequencyRatio <= spec.minimumFrequencyRatio
  ) {
    throw new Error(`Invalid ${spec.band} JONSWAP spectrum.`);
  }
}

function hash01(value: number): number {
  let state = value | 0;
  state = Math.imul(state ^ (state >>> 16), 0x21f0aaad);
  state = Math.imul(state ^ (state >>> 15), 0x735a2d97);
  state ^= state >>> 15;
  return (state >>> 0) / 4_294_967_296;
}

function clamp01(value: number): number {
  return Math.min(1 - Number.EPSILON, Math.max(Number.EPSILON, value));
}

function fractionalPart(value: number): number {
  return value - Math.floor(value);
}

function degrees(value: number): number {
  return (value * Math.PI) / 180;
}
