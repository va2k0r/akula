export interface UnderwaterOpticsState {
  /** Smoothed 0..1 transition through the moving waterline. */
  readonly amount: number;
  /** Positive distance from the local wave surface to the camera. */
  readonly cameraDepthMeters: number;
  readonly surfaceHeight: number;
  /** Distance at which contrast is almost completely lost in the water. */
  readonly visibilityMeters: number;
}

const SHALLOW_VISIBILITY_METERS = 170;
const DEEP_VISIBILITY_METERS = 68;

export function underwaterTargetAmount(cameraDepthMeters: number): number {
  return smootherstep(-0.18, 0.72, cameraDepthMeters);
}

export function underwaterVisibilityMeters(cameraDepthMeters: number): number {
  const depthBlend = smootherstep(8, 140, Math.max(0, cameraDepthMeters));
  return lerp(SHALLOW_VISIBILITY_METERS, DEEP_VISIBILITY_METERS, depthBlend);
}

function smootherstep(edge0: number, edge1: number, value: number): number {
  const normalized = Math.min(
    1,
    Math.max(0, (value - edge0) / Math.max(edge1 - edge0, Number.EPSILON)),
  );
  return (
    normalized *
    normalized *
    normalized *
    (normalized * (normalized * 6 - 15) + 10)
  );
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}
