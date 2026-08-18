import {
  MAP_HALF_LENGTH,
  MAP_HALF_WIDTH,
  clamp,
  iceCeilingAt,
  terrainHeightAt,
} from "./WorldGeometry";
import { GAMEPLAY_MOVEMENT_SCALE } from "./NavalContactCatalog";

export interface PilotCommand {
  /** -1 port, +1 starboard. */
  readonly turn: number;
  /** -1 climb, +1 dive. */
  readonly dive: number;
  /** -1 blow/climb, +1 flood/dive. */
  readonly ballast: number;
  /** One discrete telegraph step: reverse, stop, silent, cruise, flank. */
  readonly throttleStep: number;
}

/**
 * Common physical-control boundary shared by the player adapter and autonomous
 * boats.  It deliberately contains no navigation intent or transform data.
 */
export interface SubmarineControlInput {
  /** -1 port, +1 starboard. */
  readonly rudder: number;
  /** -1 full astern, 0 stop, +1 full ahead. */
  readonly throttle: number;
  /** -1 climb, +1 dive. */
  readonly divePlanes: number;
}

/** Class/scenario limits applied by an autonomous control adapter. */
export interface SubmarineControlProfile {
  readonly maxAheadSpeedKt: number;
  readonly maxAsternSpeedKt: number;
  readonly accelerationKtPerSec: number;
  readonly decelerationKtPerSec: number;
  readonly maxTurnRateDegPerSec: number;
}

/** Collision/bathymetry adapter used by the shared dynamics core. */
export interface SubmarineDynamicsEnvironment {
  readonly halfWidthMeters: number;
  readonly halfLengthMeters: number;
  readonly marginMeters: number;
  readonly terrainHeightAt: (x: number, z: number) => number;
  readonly iceCeilingAt: (x: number, z: number) => number;
}

export interface WaterSurfaceForcing {
  readonly height: number;
  readonly verticalVelocity: number;
  readonly normalX: number;
  readonly normalY: number;
  readonly normalZ: number;
}

export const TELEGRAPH_SETTINGS = [
  { label: "REVERSE", throttle: -0.22 },
  { label: "STOP", throttle: 0 },
  { label: "SILENT", throttle: 0.16 },
  { label: "CRUISE", throttle: 0.52 },
  { label: "FLANK", throttle: 1 },
] as const;

export type CollisionKind = "none" | "ice" | "floor" | "boundary";

export interface SubmarineState {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heading: number;
  readonly speedMetersPerSecond: number;
  /** Actual shaft command after depth compensation; telegraph detent stays in throttle. */
  readonly propulsionThrottle: number;
  readonly throttle: number;
  readonly depthRate: number;
  readonly pitch: number;
  readonly roll: number;
  readonly rudder: number;
  readonly planes: number;
  readonly ballast: number;
  readonly floorClearance: number;
  readonly iceClearance: number;
  readonly collision: CollisionKind;
}

const MAX_AHEAD_SPEED = 15.8;
const MAX_ASTERN_SPEED = -3.2;
const DEPTH_SPEED_ADVANTAGE_START_METERS = 70;
const DEPTH_SPEED_ADVANTAGE_FULL_METERS = 170;
const DESCENT_PRESSURE_LOOKAHEAD_SECONDS = 16;
const MAX_DESCENT_PRESSURE_LOOKAHEAD_METERS = 50;
const DEEP_SILENT_THROTTLE = 0.3;
const DEEP_CRUISE_THROTTLE = 0.75;
// Deliberate gameplay fantasy: STOP leaves the boat coasting for roughly a
// minute per speed half-life instead of applying plausible hydrodynamic drag.
const STOP_DRIFT_RESPONSE = 0.012;
// With no prop wash the rudder should feel almost dead, even though the boat
// keeps sliding forward. The sharp contrast is intentional player feedback.
const STOP_TURN_AUTHORITY_SCALE = 0.08;
// A 110 m hull turning ahead pivots roughly 30% of its length back from the
// bow: about 22 m forward of midships. Astern motion mirrors the offset.
const MAX_YAW_PIVOT_OFFSET_METERS = 22;
const HULL_HALF_HEIGHT = 8.5;
const MAP_MARGIN = 42;

export const LOCAL_SUBMARINE_ENVIRONMENT: SubmarineDynamicsEnvironment =
  Object.freeze({
    halfWidthMeters: MAP_HALF_WIDTH,
    halfLengthMeters: MAP_HALF_LENGTH,
    marginMeters: MAP_MARGIN,
    terrainHeightAt,
    iceCeilingAt,
  });

export type SubmarineInitialState = Partial<
  Pick<
    SubmarineState,
    | "x"
    | "y"
    | "z"
    | "heading"
    | "speedMetersPerSecond"
    | "throttle"
    | "depthRate"
  >
>;

export class SubmarineDynamics {
  private stateValue: SubmarineState;

  public constructor(
    initial: SubmarineInitialState = {},
    private readonly environment: SubmarineDynamicsEnvironment = LOCAL_SUBMARINE_ENVIRONMENT,
  ) {
    const y = initial.y ?? -76;
    const throttle = nearestTelegraphThrottle(initial.throttle ?? 0.16);
    const depthRate = initial.depthRate ?? 0;
    this.stateValue = this.createState({
      x: initial.x ?? 0,
      y,
      z: initial.z ?? 0,
      heading: initial.heading ?? 0,
      speedMetersPerSecond: initial.speedMetersPerSecond ?? 2.5,
      propulsionThrottle: depthCompensatedThrottle(
        throttle,
        Math.max(0, -y),
        depthRate,
      ),
      throttle,
      depthRate,
      pitch: 0,
      roll: 0,
      rudder: 0,
      planes: 0,
      ballast: 0,
      collision: "none",
    });
  }

  public get state(): SubmarineState {
    return this.stateValue;
  }

  public reset(): void {
    this.stateValue = new SubmarineDynamics({}, this.environment).state;
  }

  public teleport(initial: SubmarineInitialState): void {
    this.stateValue = new SubmarineDynamics(initial, this.environment).state;
  }

  /**
   * Autonomous adapter. Continuous throttle is resolved through class limits,
   * then runs through the same rudder, planes, collision, and depth integrator
   * as the player adapter below.
   */
  public updateControl(
    input: SubmarineControlInput,
    elapsedSeconds: number,
    profile: SubmarineControlProfile,
    waterSurface?: WaterSurfaceForcing,
  ): SubmarineState {
    const throttle = clamp(input.throttle, -1, 1);
    const targetSpeed =
      throttle >= 0
        ? knotsToMetersPerSecond(throttle * profile.maxAheadSpeedKt)
        : knotsToMetersPerSecond(throttle * profile.maxAsternSpeedKt);
    return this.integrate(
      input,
      0,
      throttle,
      targetSpeed,
      elapsedSeconds,
      waterSurface,
      profile,
    );
  }

  public update(
    command: PilotCommand,
    elapsedSeconds: number,
    waterSurface?: WaterSurfaceForcing,
    simulationSpeedMultiplier = 1,
  ): SubmarineState {
    const resolvedSpeedMultiplier = Number.isFinite(simulationSpeedMultiplier)
      ? clamp(simulationSpeedMultiplier, 1, 10)
      : 1;
    const substepCount = Math.max(1, Math.ceil(resolvedSpeedMultiplier));
    const substepSeconds =
      (elapsedSeconds * resolvedSpeedMultiplier) / substepCount;
    let state = this.stateValue;
    for (let substep = 0; substep < substepCount; substep += 1) {
      state = this.updatePlayerStep(
        substep === 0 ? command : { ...command, throttleStep: 0 },
        substepSeconds,
        waterSurface,
      );
    }
    return state;
  }

  private updatePlayerStep(
    command: PilotCommand,
    elapsedSeconds: number,
    waterSurface?: WaterSurfaceForcing,
  ): SubmarineState {
    const previous = this.stateValue;
    const previousTelegraph = nearestTelegraphIndex(previous.throttle);
    const nextTelegraph = clamp(
      previousTelegraph + Math.sign(command.throttleStep),
      0,
      TELEGRAPH_SETTINGS.length - 1,
    );
    const throttle = TELEGRAPH_SETTINGS[nextTelegraph]?.throttle ?? 0;
    const propulsionThrottle = depthCompensatedThrottle(
      throttle,
      Math.max(0, -previous.y),
      previous.depthRate,
    );
    const targetSpeed =
      propulsionThrottle >= 0
        ? propulsionThrottle * MAX_AHEAD_SPEED
        : -propulsionThrottle * MAX_ASTERN_SPEED;
    const playerControl: SubmarineControlInput = {
      rudder: command.turn,
      throttle,
      divePlanes: command.dive,
    };
    return this.integrate(
      playerControl,
      command.ballast,
      throttle,
      targetSpeed,
      elapsedSeconds,
      waterSurface,
    );
  }

  private integrate(
    input: SubmarineControlInput,
    ballastInput: number,
    throttle: number,
    targetSpeed: number,
    elapsedSeconds: number,
    waterSurface?: WaterSurfaceForcing,
    profile?: SubmarineControlProfile,
  ): SubmarineState {
    const dt = clamp(elapsedSeconds, 0, 0.05);
    if (dt === 0) {
      return this.stateValue;
    }

    const previous = this.stateValue;
    const turn = clamp(input.rudder, -1, 1);
    const dive = clamp(input.divePlanes, -1, 1);
    const ballast = clamp(ballastInput, -1, 1);
    const speedResponse = isPropulsionStopped(throttle)
      ? STOP_DRIFT_RESPONSE
      : targetSpeed > previous.speedMetersPerSecond
        ? 0.42
        : 0.7;
    let speed =
      profile === undefined
        ? damp(previous.speedMetersPerSecond, targetSpeed, speedResponse, dt)
        : moveTowards(
            previous.speedMetersPerSecond,
            targetSpeed,
            knotsToMetersPerSecond(
              targetSpeed >= previous.speedMetersPerSecond
                ? profile.accelerationKtPerSec
                : profile.decelerationKtPerSec,
            ) * dt,
          );
    const maximumAheadSpeed =
      profile === undefined
        ? MAX_AHEAD_SPEED
        : knotsToMetersPerSecond(profile.maxAheadSpeedKt);
    const speedFraction = clamp(
      Math.abs(speed) / Math.max(0.1, maximumAheadSpeed),
      0,
      1,
    );
    const rudder = damp(previous.rudder, turn, 2.15, dt);
    const planes = damp(previous.planes, dive, 1.8, dt);
    const resolvedBallast = damp(previous.ballast, ballast, 1.25, dt);

    const turnAuthority =
      speedFraction *
      (isPropulsionStopped(throttle) ? STOP_TURN_AUTHORITY_SCALE : 1);
    const unrestrictedYawRate = radians(5.7) * rudder * turnAuthority;
    const yawRate =
      profile === undefined
        ? unrestrictedYawRate
        : clamp(
            unrestrictedYawRate,
            -radians(profile.maxTurnRateDegPerSec),
            radians(profile.maxTurnRateDegPerSec),
          );
    let heading = normalizeAngle(previous.heading + yawRate * dt);

    const planeAuthority = speedFraction;
    const targetDepthRate =
      planes * planeAuthority * 4.5 + resolvedBallast * 2.7;
    let depthRate = damp(previous.depthRate, targetDepthRate, 0.82, dt);
    let pitch = damp(
      previous.pitch,
      radians(-11.5) * planes * planeAuthority - depthRate * 0.012,
      1.45,
      dt,
    );
    let roll = damp(
      previous.roll,
      radians(-14.5) * rudder * turnAuthority,
      1.75,
      dt,
    );

    const previousForwardX = Math.sin(previous.heading);
    const previousForwardZ = -Math.cos(previous.heading);
    const forwardX = Math.sin(heading);
    const forwardZ = -Math.cos(heading);
    const yawPivotOffset = yawPivotOffsetMeters(speed);
    // Advance the longitudinal pivot, then recover the midships position.
    // This makes the stern sweep out while sonar/collision coordinates remain
    // attached to the physical centre of the hull.
    let x =
      previous.x +
      forwardX * speed * dt * GAMEPLAY_MOVEMENT_SCALE +
      (previousForwardX - forwardX) * yawPivotOffset;
    let z =
      previous.z +
      forwardZ * speed * dt * GAMEPLAY_MOVEMENT_SCALE +
      (previousForwardZ - forwardZ) * yawPivotOffset;
    let y = previous.y - depthRate * dt;
    let collision: CollisionKind = "none";

    const maximumX =
      this.environment.halfWidthMeters - this.environment.marginMeters;
    const maximumZ =
      this.environment.halfLengthMeters - this.environment.marginMeters;
    if (Math.abs(x) > maximumX || Math.abs(z) > maximumZ) {
      x = clamp(x, -maximumX, maximumX);
      z = clamp(z, -maximumZ, maximumZ);
      heading = normalizeAngle(
        heading + Math.PI * 0.12 * Math.sign(rudder || 1),
      );
      speed *= 0.58;
      collision = "boundary";
    }

    const floor = this.environment.terrainHeightAt(x, z);
    const minimumY = floor + HULL_HALF_HEIGHT;
    if (y < minimumY) {
      y = minimumY;
      depthRate = Math.min(-0.8, depthRate * -0.34);
      pitch = radians(4.5);
      speed *= 0.62;
      collision = "floor";
    }

    const ice = this.environment.iceCeilingAt(x, z);
    if (Number.isFinite(ice)) {
      const maximumY = ice - HULL_HALF_HEIGHT;
      if (y > maximumY) {
        y = maximumY;
        depthRate = Math.max(0.85, depthRate * -0.34);
        pitch = radians(-4.5);
        speed *= 0.65;
        collision = "ice";
      }
    } else if (waterSurface === undefined) {
      if (y > -5) {
        // Deterministic fallback retained for unit tests and non-rendering use.
        y = -5;
        depthRate = Math.max(0, depthRate);
        pitch = damp(pitch, 0, 2.4, dt);
      }
    } else {
      const surfaceTargetY = waterSurface.height - 5;
      const surfaceEngagement = clamp(
        (y - (waterSurface.height - 17)) / 12,
        0,
        1,
      );
      const divingAway = clamp(Math.max(planes, resolvedBallast), 0, 1);
      const follow = surfaceEngagement * (1 - divingAway * 0.94);
      if (follow > 0.001) {
        y = damp(y, surfaceTargetY, 1.05 * follow, dt);
        depthRate = damp(
          depthRate,
          -waterSurface.verticalVelocity * 0.84,
          1.25 * follow,
          dt,
        );

        const normalY = Math.max(0.25, waterSurface.normalY);
        const slopeX = -waterSurface.normalX / normalY;
        const slopeZ = -waterSurface.normalZ / normalY;
        const forwardX = Math.sin(heading);
        const forwardZ = -Math.cos(heading);
        const starboardX = Math.cos(heading);
        const starboardZ = Math.sin(heading);
        const surfacePitch = Math.atan(slopeX * forwardX + slopeZ * forwardZ);
        const surfaceRoll = Math.atan(
          slopeX * starboardX + slopeZ * starboardZ,
        );
        pitch = damp(pitch, surfacePitch * 0.58, 1.15 * follow, dt);
        roll = damp(roll, surfaceRoll * 0.52, 1.05 * follow, dt);
      }
      if (y > surfaceTargetY + 0.6) {
        y = surfaceTargetY + 0.6;
        depthRate = Math.max(depthRate, -waterSurface.verticalVelocity);
      }
    }

    this.stateValue = this.createState({
      x,
      y,
      z,
      heading,
      speedMetersPerSecond: speed,
      propulsionThrottle:
        profile === undefined
          ? depthCompensatedThrottle(throttle, Math.max(0, -y), depthRate)
          : throttle,
      throttle,
      depthRate,
      pitch,
      roll,
      rudder,
      planes,
      ballast: resolvedBallast,
      collision,
    });
    return this.stateValue;
  }

  private createState(
    state: Omit<SubmarineState, "floorClearance" | "iceClearance">,
  ): SubmarineState {
    return Object.freeze({
      ...state,
      floorClearance:
        state.y - this.environment.terrainHeightAt(state.x, state.z),
      iceClearance: Number.isFinite(
        this.environment.iceCeilingAt(state.x, state.z),
      )
        ? this.environment.iceCeilingAt(state.x, state.z) - state.y
        : Number.POSITIVE_INFINITY,
    });
  }
}

export function telegraphLabel(throttle: number): string {
  return TELEGRAPH_SETTINGS[nearestTelegraphIndex(throttle)]?.label ?? "STOP";
}

export function isPropulsionStopped(throttle: number): boolean {
  return nearestTelegraphIndex(throttle) === 1;
}

export function metersPerSecondToKnots(metersPerSecond: number): number {
  return metersPerSecond * 1.943_844;
}

function knotsToMetersPerSecond(knots: number): number {
  return knots / 1.943_844;
}

/**
 * Pressure buys the two low-noise telegraph settings a deliberately legible
 * speed increase. Positive depth rate leads the curve so the shaft starts
 * spooling during a descent instead of waiting for the boat to level out.
 */
export function depthCompensatedThrottle(
  telegraphThrottle: number,
  depthMeters: number,
  depthRateMetersPerSecond: number,
): number {
  const telegraphIndex = nearestTelegraphIndex(telegraphThrottle);
  const baseThrottle = TELEGRAPH_SETTINGS[telegraphIndex]?.throttle ?? 0;
  const deepThrottle =
    telegraphIndex === 2
      ? DEEP_SILENT_THROTTLE
      : telegraphIndex === 3
        ? DEEP_CRUISE_THROTTLE
        : baseThrottle;
  if (deepThrottle === baseThrottle) {
    return baseThrottle;
  }

  const descentLookAhead = clamp(
    Math.max(0, depthRateMetersPerSecond) * DESCENT_PRESSURE_LOOKAHEAD_SECONDS,
    0,
    MAX_DESCENT_PRESSURE_LOOKAHEAD_METERS,
  );
  const pressureDepth = Math.max(0, depthMeters) + descentLookAhead;
  const linearAdvantage = clamp(
    (pressureDepth - DEPTH_SPEED_ADVANTAGE_START_METERS) /
      (DEPTH_SPEED_ADVANTAGE_FULL_METERS - DEPTH_SPEED_ADVANTAGE_START_METERS),
    0,
    1,
  );
  const pressureAdvantage =
    linearAdvantage * linearAdvantage * (3 - 2 * linearAdvantage);
  return baseThrottle + (deepThrottle - baseThrottle) * pressureAdvantage;
}

export function yawPivotOffsetMeters(speedMetersPerSecond: number): number {
  const speedFraction = clamp(
    Math.abs(speedMetersPerSecond) / MAX_AHEAD_SPEED,
    0,
    1,
  );
  return (
    Math.sign(speedMetersPerSecond) *
    MAX_YAW_PIVOT_OFFSET_METERS *
    Math.sqrt(speedFraction)
  );
}

export function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function damp(
  current: number,
  target: number,
  lambda: number,
  elapsedSeconds: number,
): number {
  return target + (current - target) * Math.exp(-lambda * elapsedSeconds);
}

function moveTowards(
  current: number,
  target: number,
  maximumDelta: number,
): number {
  if (Math.abs(target - current) <= maximumDelta) {
    return target;
  }
  return current + Math.sign(target - current) * maximumDelta;
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function nearestTelegraphThrottle(value: number): number {
  return TELEGRAPH_SETTINGS[nearestTelegraphIndex(value)]?.throttle ?? 0;
}

function nearestTelegraphIndex(value: number): number {
  let nearest = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (const [index, setting] of TELEGRAPH_SETTINGS.entries()) {
    const nextDistance = Math.abs(value - setting.throttle);
    if (nextDistance < distance) {
      nearest = index;
      distance = nextDistance;
    }
  }
  return nearest;
}
