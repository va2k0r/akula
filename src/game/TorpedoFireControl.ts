import { knotsToWorldMetersPerSecond, type Vec2 } from "./NavalContactCatalog";

export type TorpedoPlanStatus = "placing" | "confirmed";

export interface TorpedoRunToEnablePlan {
  readonly enablePoint: Vec2;
  readonly status: TorpedoPlanStatus;
  readonly targetTrackId?: string;
}

export interface TorpedoTargetMotionEstimate {
  readonly trackId: string;
  readonly trackLabel: string;
  readonly currentPosition: Vec2;
  readonly courseRad: number;
  readonly speedMps: number;
}

export interface TorpedoTargetLead {
  readonly trackId: string;
  readonly trackLabel: string;
  readonly currentPosition: Vec2;
  readonly predictedPosition: Vec2;
  readonly travelTimeSeconds: number;
  readonly markerSeparationMeters: number;
}

export interface TorpedoTargetPrediction extends TorpedoTargetLead {
  readonly selectionMode: "automatic" | "manual";
  readonly candidateIndex: number;
  readonly candidateCount: number;
}

export interface TorpedoMarkerMove {
  readonly stickX: number;
  readonly stickY: number;
  readonly viewYawRad: number;
  readonly viewHalfSpanMeters: number;
  readonly deltaSeconds: number;
}

export function appendTorpedoRunToEnable(
  plans: readonly TorpedoRunToEnablePlan[],
  enablePoint: Vec2,
  targetTrackId?: string,
): readonly TorpedoRunToEnablePlan[] {
  return [
    ...plans,
    {
      status: "confirmed",
      enablePoint: { x: enablePoint.x, z: enablePoint.z },
      ...(targetTrackId === undefined ? {} : { targetTrackId }),
    },
  ];
}

const DEFAULT_ENABLE_RANGE_METERS = 4_000;
const VISIBLE_RADIUS_FRACTION = 0.88;
const MARKER_SPEED_PER_HALF_SPAN = 0.62;
/** Fire-control model speed; the later physical weapon must reuse this value. */
export const TORPEDO_FIRE_CONTROL_SPEED_KNOTS = 45;
export const TORPEDO_FIRE_CONTROL_SPEED_METERS_PER_SECOND =
  knotsToWorldMetersPerSecond(TORPEDO_FIRE_CONTROL_SPEED_KNOTS);

export function torpedoTravelTimeSeconds(
  ownship: Vec2,
  enablePoint: Vec2,
  torpedoSpeedMetersPerSecond = TORPEDO_FIRE_CONTROL_SPEED_METERS_PER_SECOND,
): number {
  const speed = Math.max(0.1, torpedoSpeedMetersPerSecond);
  return (
    Math.hypot(enablePoint.x - ownship.x, enablePoint.z - ownship.z) / speed
  );
}

/**
 * Projects only the supplied TMA motion estimate. It cannot access simulation
 * truth, so the endpoint is exact for the displayed constant-course solution.
 */
export function torpedoTargetLead(
  estimate: TorpedoTargetMotionEstimate,
  ownship: Vec2,
  enablePoint: Vec2,
  torpedoSpeedMetersPerSecond = TORPEDO_FIRE_CONTROL_SPEED_METERS_PER_SECOND,
): TorpedoTargetLead {
  const travelTimeSeconds = torpedoTravelTimeSeconds(
    ownship,
    enablePoint,
    torpedoSpeedMetersPerSecond,
  );
  const predictedPosition = {
    x:
      estimate.currentPosition.x +
      Math.sin(estimate.courseRad) * estimate.speedMps * travelTimeSeconds,
    z:
      estimate.currentPosition.z -
      Math.cos(estimate.courseRad) * estimate.speedMps * travelTimeSeconds,
  };
  return {
    trackId: estimate.trackId,
    trackLabel: estimate.trackLabel,
    currentPosition: {
      x: estimate.currentPosition.x,
      z: estimate.currentPosition.z,
    },
    predictedPosition,
    travelTimeSeconds,
    markerSeparationMeters: Math.hypot(
      predictedPosition.x - enablePoint.x,
      predictedPosition.z - enablePoint.z,
    ),
  };
}

export function closestTorpedoTargetLead(
  leads: readonly TorpedoTargetLead[],
): TorpedoTargetLead | undefined {
  return [...leads].sort(
    (left, right) =>
      left.markerSeparationMeters - right.markerSeparationMeters ||
      left.trackId.localeCompare(right.trackId),
  )[0];
}

export function cycleTorpedoTargetLead(
  leads: readonly TorpedoTargetLead[],
  currentTrackId: string | undefined,
  delta: number,
): TorpedoTargetLead | undefined {
  if (leads.length === 0) {
    return undefined;
  }
  const currentIndex = leads.findIndex(
    ({ trackId }) => trackId === currentTrackId,
  );
  const baseIndex = currentIndex < 0 ? 0 : currentIndex;
  const direction = Math.sign(delta);
  const nextIndex =
    direction === 0
      ? baseIndex
      : (baseIndex + direction + leads.length) % leads.length;
  return leads[nextIndex];
}

export function initialTorpedoEnablePoint(
  ownship: Vec2,
  ownshipHeadingRad: number,
  viewHalfSpanMeters: number,
  preferredPoint?: Vec2,
): Vec2 {
  const preferredIsUseful =
    preferredPoint !== undefined &&
    Number.isFinite(preferredPoint.x) &&
    Number.isFinite(preferredPoint.z) &&
    Math.hypot(preferredPoint.x - ownship.x, preferredPoint.z - ownship.z) >
      100;
  const defaultRange = Math.min(
    DEFAULT_ENABLE_RANGE_METERS,
    Math.max(800, viewHalfSpanMeters * 0.42),
  );
  const initial = preferredIsUseful
    ? preferredPoint
    : {
        x: ownship.x + Math.sin(ownshipHeadingRad) * defaultRange,
        z: ownship.z - Math.cos(ownshipHeadingRad) * defaultRange,
      };
  return clampTorpedoEnablePoint(initial, ownship, viewHalfSpanMeters);
}

/**
 * Moves in screen space, then resolves that motion through the live map yaw.
 * This keeps right-stick right visually right even on a course-up plot.
 */
export function moveTorpedoEnablePoint(
  point: Vec2,
  ownship: Vec2,
  move: TorpedoMarkerMove,
): Vec2 {
  const speedMetersPerSecond =
    Math.max(220, move.viewHalfSpanMeters) * MARKER_SPEED_PER_HALF_SPAN;
  const screenX = shapedAxis(move.stickX);
  const screenY = shapedAxis(move.stickY);
  const distance =
    speedMetersPerSecond * Math.max(0, Math.min(0.05, move.deltaSeconds));
  const cosine = Math.cos(move.viewYawRad);
  const sine = Math.sin(move.viewYawRad);
  const worldDeltaX = (screenX * cosine - screenY * sine) * distance;
  const worldDeltaZ = (screenX * sine + screenY * cosine) * distance;
  return clampTorpedoEnablePoint(
    {
      x: point.x + worldDeltaX,
      z: point.z + worldDeltaZ,
    },
    ownship,
    move.viewHalfSpanMeters,
  );
}

export function torpedoTrajectoryHeading(
  origin: Vec2,
  enablePoint: Vec2,
  fallbackHeadingRad = 0,
): number {
  const deltaX = enablePoint.x - origin.x;
  const deltaZ = enablePoint.z - origin.z;
  if (Math.hypot(deltaX, deltaZ) < 1e-6) {
    return fallbackHeadingRad;
  }
  return Math.atan2(deltaX, -deltaZ);
}

function clampTorpedoEnablePoint(
  point: Vec2,
  ownship: Vec2,
  viewHalfSpanMeters: number,
): Vec2 {
  const deltaX = point.x - ownship.x;
  const deltaZ = point.z - ownship.z;
  const range = Math.hypot(deltaX, deltaZ);
  const maximumRange =
    Math.max(220, viewHalfSpanMeters) * VISIBLE_RADIUS_FRACTION;
  if (range <= maximumRange || range < 1e-6) {
    return { x: point.x, z: point.z };
  }
  const scale = maximumRange / range;
  return {
    x: ownship.x + deltaX * scale,
    z: ownship.z + deltaZ * scale,
  };
}

function shapedAxis(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const normalized = Math.max(-1, Math.min(1, value));
  return Math.sign(normalized) * Math.abs(normalized) ** 1.35;
}
