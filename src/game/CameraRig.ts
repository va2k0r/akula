import { MathUtils, Vector3 } from "three";
import type { PerspectiveCamera } from "three";
import type { SubmarineState } from "./SubmarineDynamics";
import {
  WATER_SURFACE_Y,
  clamp,
  iceCeilingAt,
  terrainHeightAt,
} from "./WorldGeometry";
import { NORTH_ATLANTIC_WAVES, sampleOceanSurface } from "./OceanSpectrum";

const CHASE_PITCH = -0.08;
const CHASE_ZENITH_PITCH = -1.5;
const CHASE_MIN_PITCH = CHASE_ZENITH_PITCH;
const CHASE_MAX_PITCH = 0.48;
const CHASE_PITCH_FORWARD_RATE = 1.85;
const CHASE_PITCH_RETURN_RATE = 1.38;
const CHASE_OVERHEAD_BLEND_START = 1.02;
const CHASE_OVERHEAD_BLEND_END = 1.44;
const MAP_GESTURE_PITCH = CHASE_ZENITH_PITCH + 0.015;
// Camera damping turns this into roughly 3-10 visibly zenithal frames.
const MAP_GESTURE_SECONDS = 0.17;
const MAP_EXIT_SECONDS = 0.16;
const MAP_ENTRY_ZOOM = 0.2;
const MAP_TOGGLE_ZOOM = 1;
const TACTICAL_ZOOM_RATE = 1.4;
const TACTICAL_BLEND_RESPONSE = 16;
const TACTICAL_DISTANCE_RESPONSE = 15;
const CAMERA_POSITION_RESPONSE = 13;
const CAMERA_UP_RESPONSE = 16;
const CAMERA_FOV_RESPONSE = 12;
const CAMERA_CLIP_RESPONSE = 16;
const TACTICAL_FIELD_OF_VIEW_DEGREES = 44;
const TACTICAL_INTERFACE_MINIMUM_ZOOM = 0.002;
const CHASE_CAMERA_NEAR = 0.5;
const CHASE_CAMERA_FAR = 10_000;

export const MIN_TACTICAL_DISTANCE = 260;
export const MAX_TACTICAL_DISTANCE = 125_000;

export type CameraViewMode = "chase" | "tactical";

export interface CameraViewSnapshot {
  readonly mode: CameraViewMode;
  readonly tacticalAmount: number;
  readonly tacticalZoom: number;
  readonly tacticalDistance: number;
  readonly cameraRangeToOwnship: number;
  readonly tacticalSpanMeters: number;
  readonly operationalAmount: number;
  readonly tacticalYaw: number;
}

export function tacticalDistanceForZoom(zoom: number): number {
  const normalized = clamp(zoom, 0, 1);
  return (
    MIN_TACTICAL_DISTANCE *
    Math.pow(MAX_TACTICAL_DISTANCE / MIN_TACTICAL_DISTANCE, normalized)
  );
}

/** Vertical world span visible from the fixed top-down tactical camera. */
export function tacticalSpanForDistance(distanceMeters: number): number {
  const halfFieldOfViewRadians =
    (TACTICAL_FIELD_OF_VIEW_DEGREES * Math.PI) / 360;
  return Math.max(0, distanceMeters) * Math.tan(halfFieldOfViewRadians) * 2;
}

export function tacticalZoomForSpan(spanMeters: number): number {
  const halfFieldOfViewRadians =
    (TACTICAL_FIELD_OF_VIEW_DEGREES * Math.PI) / 360;
  const distance =
    Math.max(0, spanMeters) / (Math.tan(halfFieldOfViewRadians) * 2);
  if (distance <= MIN_TACTICAL_DISTANCE) {
    return 0;
  }
  if (distance >= MAX_TACTICAL_DISTANCE) {
    return 1;
  }
  return (
    Math.log(distance / MIN_TACTICAL_DISTANCE) /
    Math.log(MAX_TACTICAL_DISTANCE / MIN_TACTICAL_DISTANCE)
  );
}

export class CameraRig {
  private orbitYaw = 0;
  private orbitPitch = CHASE_PITCH;
  private surfaceViewElevation = 0;
  private returnOrbitPitch = CHASE_PITCH;
  private tacticalYaw = 0;
  private tacticalZoom = 0;
  private tacticalDistance = MIN_TACTICAL_DISTANCE;
  private tacticalTarget = false;
  private tacticalBlend = 0;
  private overheadIntentAge = 0;
  private mapExitIntentAge = 0;
  private lastHeading = 0;
  private shake = 0;
  private initialized = false;
  private snapTransitionOnNextUpdate = false;
  private readonly chasePosition = new Vector3();
  private readonly mapPosition = new Vector3();
  private readonly desiredPosition = new Vector3();
  private readonly chaseTarget = new Vector3();
  private readonly mapTarget = new Vector3();
  private readonly lookTarget = new Vector3();
  private readonly mapUp = new Vector3();
  private readonly desiredUp = new Vector3();

  public constructor(public readonly camera: PerspectiveCamera) {}

  public center(): void {
    this.tacticalTarget = false;
    this.tacticalZoom = 0;
    this.overheadIntentAge = 0;
    this.mapExitIntentAge = 0;
    this.orbitYaw = 0;
    this.orbitPitch = CHASE_PITCH;
    this.surfaceViewElevation = 0;
  }

  public toggleTactical(): void {
    const shouldEnter = !this.tacticalTarget && this.tacticalBlend < 0.55;
    this.setTacticalTarget(shouldEnter, true);
  }

  public exitTactical(): void {
    this.setTacticalTarget(false, false);
  }

  public frameTacticalOverview(): void {
    this.setTacticalTarget(true, false);
    this.tacticalZoom = 1;
  }

  public frameTacticalSpan(spanMeters: number, immediate = false): void {
    this.setTacticalTarget(true, immediate);
    this.tacticalZoom = tacticalZoomForSpan(spanMeters);
  }

  public frameSurfaceView(): void {
    this.center();
    this.orbitYaw = -0.42;
    this.orbitPitch = -0.12;
    this.surfaceViewElevation = 1;
    this.initialized = false;
  }

  public update(
    state: SubmarineState,
    cameraYawInput: number,
    cameraPitchInput: number,
    centerCamera: boolean,
    toggleTactical: boolean,
    elapsedSeconds: number,
    deltaSeconds: number,
  ): CameraViewSnapshot {
    this.lastHeading = state.heading;
    if (centerCamera) {
      this.center();
    } else if (toggleTactical) {
      this.toggleTactical();
    }

    if (this.tacticalTarget) {
      this.updateTacticalInput(cameraYawInput, cameraPitchInput, deltaSeconds);
    } else {
      this.updateChaseInput(cameraYawInput, cameraPitchInput, deltaSeconds);
    }

    const snapTransition = this.snapTransitionOnNextUpdate;
    this.snapTransitionOnNextUpdate = false;
    if (snapTransition) {
      this.tacticalBlend = this.tacticalTarget ? 1 : 0;
    } else {
      this.tacticalBlend = MathUtils.damp(
        this.tacticalBlend,
        this.tacticalTarget ? 1 : 0,
        TACTICAL_BLEND_RESPONSE,
        deltaSeconds,
      );
    }
    if (Math.abs(this.tacticalBlend - (this.tacticalTarget ? 1 : 0)) < 0.001) {
      this.tacticalBlend = this.tacticalTarget ? 1 : 0;
    }
    const tacticalAmount = smoothBlend(this.tacticalBlend);

    const speedFraction = clamp(
      Math.abs(state.speedMetersPerSecond) / 15.8,
      0,
      1,
    );
    const chaseOverheadAmount = MathUtils.smoothstep(
      -this.orbitPitch,
      CHASE_OVERHEAD_BLEND_START,
      CHASE_OVERHEAD_BLEND_END,
    );
    this.updateChasePosition(
      state,
      speedFraction,
      elapsedSeconds,
      chaseOverheadAmount,
    );

    const requestedTacticalDistance = tacticalDistanceForZoom(
      this.tacticalZoom,
    );
    this.tacticalDistance = snapTransition
      ? requestedTacticalDistance
      : MathUtils.damp(
          this.tacticalDistance,
          requestedTacticalDistance,
          TACTICAL_DISTANCE_RESPONSE,
          deltaSeconds,
        );
    if (
      Math.abs(this.tacticalDistance - requestedTacticalDistance) <
      Math.max(0.1, requestedTacticalDistance * 0.0001)
    ) {
      this.tacticalDistance = requestedTacticalDistance;
    }
    const tacticalDistance = this.tacticalDistance;
    // Tactical range changes by three orders of magnitude, but ownship remains
    // the physical camera anchor throughout the pullback.
    const mapFocusX = state.x;
    const mapFocusZ = state.z;
    this.mapPosition.set(mapFocusX, state.y + tacticalDistance, mapFocusZ);
    this.desiredPosition.lerpVectors(
      this.chasePosition,
      this.mapPosition,
      tacticalAmount,
    );

    const forwardDistance = MathUtils.lerp(34, 0, chaseOverheadAmount);
    this.chaseTarget.set(
      state.x + Math.sin(state.heading) * forwardDistance,
      state.y + 2 - state.depthRate * 1.3,
      state.z - Math.cos(state.heading) * forwardDistance,
    );
    this.mapTarget.set(mapFocusX, state.y + 2, mapFocusZ);
    this.lookTarget.lerpVectors(
      this.chaseTarget,
      this.mapTarget,
      tacticalAmount,
    );

    if (!this.initialized || snapTransition) {
      this.camera.position.copy(this.desiredPosition);
      this.initialized = true;
    } else {
      this.camera.position.lerp(
        this.desiredPosition,
        1 - Math.exp(-deltaSeconds * CAMERA_POSITION_RESPONSE),
      );
    }

    if (this.shake > 0.001) {
      const frequency = elapsedSeconds * 43;
      const visibleShake = this.shake * (1 - tacticalAmount);
      this.camera.position.x += Math.sin(frequency * 1.7) * visibleShake;
      this.camera.position.y += Math.sin(frequency * 2.1) * visibleShake * 0.5;
      this.camera.position.z += Math.cos(frequency * 1.3) * visibleShake;
      this.shake = MathUtils.damp(this.shake, 0, 5.5, deltaSeconds);
    }

    this.mapUp.set(Math.sin(this.tacticalYaw), 0, -Math.cos(this.tacticalYaw));
    this.desiredUp.set(0, 1, 0).lerp(this.mapUp, tacticalAmount).normalize();
    if (snapTransition) {
      this.camera.up.copy(this.desiredUp);
    } else {
      this.camera.up.lerp(
        this.desiredUp,
        1 - Math.exp(-deltaSeconds * CAMERA_UP_RESPONSE),
      );
    }
    this.camera.lookAt(this.lookTarget);

    const chaseFov = 49 + speedFraction * 8;
    const targetFov = MathUtils.lerp(
      chaseFov,
      TACTICAL_FIELD_OF_VIEW_DEGREES,
      tacticalAmount,
    );
    this.camera.fov = snapTransition
      ? targetFov
      : MathUtils.damp(
          this.camera.fov,
          targetFov,
          CAMERA_FOV_RESPONSE,
          deltaSeconds,
        );
    const tacticalNear = Math.max(CHASE_CAMERA_NEAR, tacticalDistance / 1_250);
    const tacticalFar = Math.max(CHASE_CAMERA_FAR, tacticalDistance * 2.2);
    const targetNear = MathUtils.lerp(
      CHASE_CAMERA_NEAR,
      tacticalNear,
      tacticalAmount,
    );
    const targetFar = MathUtils.lerp(
      CHASE_CAMERA_FAR,
      tacticalFar,
      tacticalAmount,
    );
    this.camera.near = snapTransition
      ? targetNear
      : MathUtils.damp(
          this.camera.near,
          targetNear,
          CAMERA_CLIP_RESPONSE,
          deltaSeconds,
        );
    this.camera.far = snapTransition
      ? targetFar
      : MathUtils.damp(
          this.camera.far,
          targetFar,
          CAMERA_CLIP_RESPONSE,
          deltaSeconds,
        );
    this.camera.updateProjectionMatrix();
    const cameraRangeToOwnship = this.camera.position.distanceTo(
      this.mapTarget,
    );
    // Chart scale follows the camera that actually reached the frame, not the
    // requested altitude still being damped toward. This keeps the 3D world,
    // range label, grid, and ownship datum on one continuous visual scale.
    const tacticalSpanMeters = tacticalSpanForDistance(cameraRangeToOwnship);
    // The TMA is an operational layer, not a distant-zoom reward. Once the
    // tactical chart is active it stays fully opaque throughout close and
    // medium zooms, including the first frame of a stick-driven pullback.
    const operationalAmount =
      this.tacticalTarget && this.tacticalZoom > TACTICAL_INTERFACE_MINIMUM_ZOOM
        ? 1
        : 0;

    return {
      mode:
        this.tacticalTarget || this.tacticalBlend >= 0.5 ? "tactical" : "chase",
      tacticalAmount,
      tacticalZoom: this.tacticalZoom,
      tacticalDistance,
      cameraRangeToOwnship,
      tacticalSpanMeters,
      operationalAmount,
      tacticalYaw: this.tacticalYaw,
    };
  }

  public addShake(strength: number): void {
    this.shake = Math.max(this.shake, strength);
  }

  private updateChaseInput(
    cameraYawInput: number,
    cameraPitchInput: number,
    deltaSeconds: number,
  ): void {
    this.orbitYaw = normalizeAngle(
      this.orbitYaw + cameraYawInput * deltaSeconds * 1.35,
    );
    this.orbitPitch = clamp(
      this.orbitPitch +
        cameraPitchInput *
          deltaSeconds *
          (cameraPitchInput < 0
            ? CHASE_PITCH_FORWARD_RATE
            : CHASE_PITCH_RETURN_RATE),
      CHASE_MIN_PITCH,
      CHASE_MAX_PITCH,
    );

    if (this.orbitPitch <= MAP_GESTURE_PITCH && cameraPitchInput < -0.62) {
      this.overheadIntentAge += deltaSeconds;
      if (this.overheadIntentAge >= MAP_GESTURE_SECONDS) {
        this.setTacticalTarget(true, false);
      }
    } else {
      this.overheadIntentAge = Math.max(
        0,
        this.overheadIntentAge - deltaSeconds * 2.5,
      );
    }
  }

  private updateTacticalInput(
    cameraYawInput: number,
    cameraPitchInput: number,
    deltaSeconds: number,
  ): void {
    this.tacticalYaw = normalizeAngle(
      this.tacticalYaw + cameraYawInput * deltaSeconds * 0.9,
    );
    this.tacticalZoom = clamp(
      this.tacticalZoom - cameraPitchInput * deltaSeconds * TACTICAL_ZOOM_RATE,
      0,
      1,
    );

    if (this.tacticalZoom <= 0.002 && cameraPitchInput > 0.58) {
      this.mapExitIntentAge += deltaSeconds;
      if (this.mapExitIntentAge >= MAP_EXIT_SECONDS) {
        this.setTacticalTarget(false, false);
      }
    } else {
      this.mapExitIntentAge = 0;
    }
  }

  private setTacticalTarget(enabled: boolean, immediate: boolean): void {
    const entering = enabled && !this.tacticalTarget;
    const exiting = !enabled && this.tacticalTarget;
    this.tacticalTarget = enabled;
    this.overheadIntentAge = 0;
    this.mapExitIntentAge = 0;
    if (enabled) {
      if (entering) {
        this.returnOrbitPitch = this.orbitPitch;
        // Preserve the world-space azimuth already established by the chase
        // camera. A heading-aligned chase therefore becomes a course-up map,
        // while an orbited chase keeps that same screen orientation.
        this.tacticalYaw = normalizeAngle(this.lastHeading + this.orbitYaw);
      }
      this.tacticalZoom = Math.max(
        this.tacticalZoom,
        immediate ? MAP_TOGGLE_ZOOM : MAP_ENTRY_ZOOM,
      );
      if (immediate) {
        this.tacticalBlend = 1;
        this.snapTransitionOnNextUpdate = true;
      }
      return;
    }
    if (immediate) {
      this.tacticalZoom = 0;
      this.tacticalBlend = 0;
      this.snapTransitionOnNextUpdate = true;
    }
    if (exiting) {
      // Carry any strategic-map rotation back into the chase camera instead
      // of snapping to north or to the submarine's stern.
      this.orbitYaw = normalizeAngle(this.tacticalYaw - this.lastHeading);
      this.orbitPitch = this.returnOrbitPitch;
    }
  }

  private updateChasePosition(
    state: SubmarineState,
    speedFraction: number,
    elapsedSeconds: number,
    overheadAmount: number,
  ): void {
    const surfaceProximity = clamp((state.y + 18) / 13, 0, 1);
    // Deep water is optically short-range. Keeping the old 108-130 m chase
    // distance outside that visibility bubble hid the whole environment behind
    // the hull. Surface framing remains wide enough to read the long swell.
    const underwaterDistance = 86 + speedFraction * 30;
    const surfaceDistance = 140 + speedFraction * 22;
    const distance =
      MathUtils.lerp(underwaterDistance, surfaceDistance, surfaceProximity) +
      this.surfaceViewElevation * 280;
    const cameraHeight = 24 - surfaceProximity * 17;
    const effectiveOrbitPitch =
      this.orbitPitch +
      surfaceProximity *
        (1 - overheadAmount) *
        MathUtils.clamp(-this.orbitPitch, 0, 0.075);
    const orbitHeading = state.heading + this.orbitYaw;
    const horizontalDistance = Math.cos(effectiveOrbitPitch) * distance;
    this.chasePosition.set(
      state.x - Math.sin(orbitHeading) * horizontalDistance,
      state.y + cameraHeight - Math.sin(effectiveOrbitPitch) * distance,
      state.z + Math.cos(orbitHeading) * horizontalDistance,
    );

    const surfaceCameraAmount = surfaceProximity * (1 - overheadAmount);
    if (surfaceCameraAmount > 0) {
      const cameraWater = sampleOceanSurface(
        NORTH_ATLANTIC_WAVES,
        this.chasePosition.x,
        this.chasePosition.z,
        elapsedSeconds,
      );
      const waveFollowingHeight = cameraWater.height + 1.8;
      const stormOverviewHeight = Math.max(
        WATER_SURFACE_Y + 16,
        cameraWater.height + 5,
      );
      this.chasePosition.y = MathUtils.lerp(
        this.chasePosition.y,
        MathUtils.lerp(
          waveFollowingHeight,
          stormOverviewHeight,
          this.surfaceViewElevation,
        ),
        surfaceCameraAmount,
      );
    }

    const floor = terrainHeightAt(this.chasePosition.x, this.chasePosition.z);
    const ceiling = iceCeilingAt(this.chasePosition.x, this.chasePosition.z);
    const cameraCeiling =
      this.surfaceViewElevation > 0.5
        ? WATER_SURFACE_Y + 24 + this.surfaceViewElevation * 35
        : Number.isFinite(ceiling)
          ? ceiling - 2.5
          : state.y > -11
            ? WATER_SURFACE_Y + 24
            : WATER_SURFACE_Y - 2.5;
    this.chasePosition.y = clamp(
      this.chasePosition.y,
      floor + 4,
      cameraCeiling,
    );
  }
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function smoothBlend(value: number): number {
  const normalized = clamp(value, 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}
