import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  MathUtils,
  Mesh,
  Object3D,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  SpotLight,
} from "three";
import type { SubmarineState } from "./SubmarineDynamics";
import { isInsideMap, smoothstep, terrainHeightAt } from "./WorldGeometry";

const POINT_COUNT = 277;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const TERRAIN_OFFSET_METERS = 2.2;
const FULL_STRENGTH_CLEARANCE_METERS = 14;
export const SEABED_LIDAR_MAX_CLEARANCE_METERS = 82;
export const SEABED_LIDAR_SCAN_INTERVAL_SECONDS = 0.92;
export const SEABED_LIDAR_MIN_SCAN_INTERVAL_SECONDS = 0.11;
const MAX_FOOTPRINT_RADIUS_METERS = 58;
const TACTILE_PROPAGATION_SPEED_METERS_PER_SECOND =
  (SEABED_LIDAR_MAX_CLEARANCE_METERS * 2) / SEABED_LIDAR_SCAN_INTERVAL_SECONDS;

export interface SeabedLidarProfile {
  readonly amount: number;
  readonly radiusMeters: number;
  readonly returnIntervalSeconds: number;
}

export interface SeabedLidarSnapshot extends SeabedLidarProfile {
  readonly active: boolean;
  readonly scanAgeSeconds: number;
}

export interface SeabedLidarHapticPulse {
  readonly durationMilliseconds: number;
  readonly strongMagnitude: number;
  readonly weakMagnitude: number;
  readonly returnIntervalSeconds: number;
}

type LidarSubmarineState = Pick<
  SubmarineState,
  "x" | "y" | "z" | "heading" | "floorClearance"
>;

/**
 * Converts hull-to-floor proximity into a quiet maneuvering-aid footprint.
 * The generous easing near the cutoff avoids a binary lamp-like transition.
 */
export function seabedLidarProfile(
  floorClearanceMeters: number,
): SeabedLidarProfile {
  if (!Number.isFinite(floorClearanceMeters)) {
    return {
      amount: 0,
      radiusMeters: 0,
      returnIntervalSeconds: SEABED_LIDAR_SCAN_INTERVAL_SECONDS,
    };
  }

  const amount =
    1 -
    smoothstep(
      FULL_STRENGTH_CLEARANCE_METERS,
      SEABED_LIDAR_MAX_CLEARANCE_METERS,
      Math.max(0, floorClearanceMeters),
    );
  return {
    amount,
    radiusMeters: MAX_FOOTPRINT_RADIUS_METERS * Math.pow(amount, 0.68),
    returnIntervalSeconds: seabedLidarRoundTripSeconds(floorClearanceMeters),
  };
}

/**
 * A gameplay-readable time-of-flight clock. It preserves the exact 2d/v
 * relation, but uses a tactile propagation scale because optical travel time
 * is far below what a controller motor or a player can distinguish.
 */
export function seabedLidarRoundTripSeconds(
  floorClearanceMeters: number,
): number {
  if (!Number.isFinite(floorClearanceMeters)) {
    return SEABED_LIDAR_SCAN_INTERVAL_SECONDS;
  }
  const rawRoundTripSeconds =
    (Math.max(0, floorClearanceMeters) * 2) /
    TACTILE_PROPAGATION_SPEED_METERS_PER_SECOND;
  return Math.min(
    SEABED_LIDAR_SCAN_INTERVAL_SECONDS,
    Math.max(SEABED_LIDAR_MIN_SCAN_INTERVAL_SECONDS, rawRoundTripSeconds),
  );
}

export function seabedLidarHapticPulse(
  floorClearanceMeters: number,
): SeabedLidarHapticPulse | undefined {
  const profile = seabedLidarProfile(floorClearanceMeters);
  if (profile.amount <= 0.001) {
    return undefined;
  }
  return {
    durationMilliseconds: Math.round(44 + profile.amount * 26),
    strongMagnitude: 0.3 + profile.amount * 0.55,
    weakMagnitude: 0.56 + profile.amount * 0.4,
    returnIntervalSeconds: profile.returnIntervalSeconds,
  };
}

/** Periodic, terrain-conforming lidar returns used only for close piloting. */
export class SeabedLidar {
  private readonly root = new Group();
  private readonly positions = new Float32Array(POINT_COUNT * 3);
  private readonly returnStrengths = new Float32Array(POINT_COUNT);
  private readonly positionAttribute = new BufferAttribute(this.positions, 3);
  private readonly returnAttribute = new BufferAttribute(
    this.returnStrengths,
    1,
  );
  private readonly returnMaterial = createReturnMaterial();
  private readonly footprintMaterial = createFootprintMaterial();
  private readonly footprint: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly points: Points<BufferGeometry, ShaderMaterial>;
  private readonly light = new SpotLight(0x62d8cf, 0, 100, Math.PI / 5, 0.9, 0);
  private readonly lightTarget = new Object3D();
  private scanAgeSeconds = Number.POSITIVE_INFINITY;
  private smoothedAmount = 0;
  private sampledRadiusMeters = 0;
  private sampledReturnIntervalSeconds = SEABED_LIDAR_SCAN_INTERVAL_SECONDS;
  private hasScan = false;
  private rangeCycleActive = false;

  public constructor(parent: Object3D) {
    this.root.name = "SeabedManeuverLidar";
    this.root.visible = false;

    this.positionAttribute.setUsage(DynamicDrawUsage);
    this.returnAttribute.setUsage(DynamicDrawUsage);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", this.positionAttribute);
    geometry.setAttribute("aReturn", this.returnAttribute);
    geometry.setAttribute("aSize", new BufferAttribute(createPointSizes(), 1));

    const footprintGeometry = new PlaneGeometry(2, 2, 24, 24);
    footprintGeometry.rotateX(-Math.PI / 2);
    const footprintPositions = footprintGeometry.getAttribute("position");
    if (footprintPositions instanceof BufferAttribute) {
      footprintPositions.setUsage(DynamicDrawUsage);
    }
    this.footprint = new Mesh(footprintGeometry, this.footprintMaterial);
    this.footprint.name = "SeabedLidarFootprint";
    this.footprint.frustumCulled = false;
    this.footprint.renderOrder = 11;

    this.points = new Points(geometry, this.returnMaterial);
    this.points.name = "SeabedLidarReturns";
    this.points.frustumCulled = false;
    this.points.renderOrder = 12;

    this.light.name = "SeabedLidarSoftLight";
    this.light.castShadow = false;
    this.light.target = this.lightTarget;
    this.root.add(this.footprint, this.points, this.light, this.lightTarget);
    parent.add(this.root);
  }

  public update(
    state: LidarSubmarineState,
    deltaSeconds: number,
    viewSuppression: number,
  ): SeabedLidarHapticPulse | undefined {
    const profile = seabedLidarProfile(state.floorClearance);
    const visibleViewAmount = 1 - smoothstep(0.08, 0.52, viewSuppression);
    const targetAmount = profile.amount * visibleViewAmount;
    this.smoothedAmount = MathUtils.damp(
      this.smoothedAmount,
      targetAmount,
      targetAmount > this.smoothedAmount ? 5.8 : 4.2,
      Math.max(0, deltaSeconds),
    );
    if (Math.abs(this.smoothedAmount - targetAmount) < 0.0005) {
      this.smoothedAmount = targetAmount;
    }

    const rangeActive = profile.amount > 0.001 && visibleViewAmount > 0.1;
    if (rangeActive && !this.rangeCycleActive) {
      this.rangeCycleActive = true;
      this.hasScan = false;
      this.scanAgeSeconds = 0;
    } else if (!rangeActive) {
      this.rangeCycleActive = false;
    }

    this.scanAgeSeconds += Math.max(0, deltaSeconds);
    let hapticPulse: SeabedLidarHapticPulse | undefined;
    if (rangeActive && this.scanAgeSeconds >= profile.returnIntervalSeconds) {
      this.captureScan(state, profile);
      hapticPulse = seabedLidarHapticPulse(state.floorClearance);
    }

    const pulse = 0.62 + Math.exp(-this.scanAgeSeconds * 4.8) * 0.38;
    requireUniform(this.returnMaterial, "uOpacity").value =
      this.smoothedAmount * pulse * 0.82;
    requireUniform(this.footprintMaterial, "uOpacity").value =
      this.smoothedAmount;
    requireUniform(this.footprintMaterial, "uScanProgress").value =
      MathUtils.clamp(
        this.scanAgeSeconds / profile.returnIntervalSeconds,
        0,
        1,
      );
    this.light.intensity = this.smoothedAmount * pulse * 2.2;

    const active = this.hasScan && this.smoothedAmount > 0.002;
    this.root.visible = active;
    this.footprint.visible = active;
    this.points.visible = active;
    this.light.visible = active;
    return hapticPulse;
  }

  public get snapshot(): SeabedLidarSnapshot {
    return {
      active: this.root.visible,
      amount: this.smoothedAmount,
      radiusMeters: this.sampledRadiusMeters,
      returnIntervalSeconds: this.sampledReturnIntervalSeconds,
      scanAgeSeconds: Number.isFinite(this.scanAgeSeconds)
        ? this.scanAgeSeconds
        : 0,
    };
  }

  public dispose(): void {
    this.points.geometry.dispose();
    this.returnMaterial.dispose();
    this.footprint.geometry.dispose();
    this.footprintMaterial.dispose();
    this.root.removeFromParent();
  }

  private captureScan(
    state: LidarSubmarineState,
    profile: SeabedLidarProfile,
  ): void {
    const radius = profile.radiusMeters;
    const forwardX = Math.sin(state.heading);
    const forwardZ = -Math.cos(state.heading);
    const starboardX = Math.cos(state.heading);
    const starboardZ = Math.sin(state.heading);

    for (let index = 0; index < POINT_COUNT; index += 1) {
      const normalizedRadius = Math.sqrt((index + 0.5) / POINT_COUNT);
      const angle = index * GOLDEN_ANGLE;
      const across = Math.cos(angle) * normalizedRadius * radius * 0.9;
      const along = Math.sin(angle) * normalizedRadius * radius * 1.1;
      const x = state.x + starboardX * across + forwardX * along;
      const z = state.z + starboardZ * across + forwardZ * along;
      const offset = index * 3;

      if (!isInsideMap(x, z)) {
        this.positions[offset] = state.x;
        this.positions[offset + 1] = terrainHeightAt(state.x, state.z);
        this.positions[offset + 2] = state.z;
        this.returnStrengths[index] = 0;
        continue;
      }

      const height = terrainHeightAt(x, z);
      const slope = terrainSlopeAt(x, z);
      const variation = seededNoise(index * 17 + 31);
      this.positions[offset] = x;
      this.positions[offset + 1] = height + TERRAIN_OFFSET_METERS;
      this.positions[offset + 2] = z;
      this.returnStrengths[index] = MathUtils.clamp(
        0.48 + slope * 0.28 + variation * 0.32,
        0.45,
        1,
      );
    }

    this.positionAttribute.needsUpdate = true;
    this.returnAttribute.needsUpdate = true;
    this.updateFootprintGeometry(state, radius);
    this.sampledRadiusMeters = radius;
    this.sampledReturnIntervalSeconds = profile.returnIntervalSeconds;
    this.scanAgeSeconds = 0;
    this.hasScan = true;

    const floorY = terrainHeightAt(state.x, state.z) + TERRAIN_OFFSET_METERS;
    this.light.position.set(state.x, state.y + 1, state.z);
    this.lightTarget.position.set(state.x, floorY, state.z);
    this.light.distance = Math.max(18, state.floorClearance + 14);
    this.light.angle = MathUtils.clamp(
      Math.atan2(radius * 0.85, Math.max(8, state.floorClearance)),
      0.12,
      1.38,
    );
  }

  private updateFootprintGeometry(
    state: LidarSubmarineState,
    radius: number,
  ): void {
    const positions = this.footprint.geometry.getAttribute("position");
    const uvs = this.footprint.geometry.getAttribute("uv");
    const forwardX = Math.sin(state.heading);
    const forwardZ = -Math.cos(state.heading);
    const starboardX = Math.cos(state.heading);
    const starboardZ = Math.sin(state.heading);

    for (let index = 0; index < positions.count; index += 1) {
      const across = (uvs.getX(index) * 2 - 1) * radius * 0.9;
      const along = (uvs.getY(index) * 2 - 1) * radius * 1.1;
      const x = state.x + starboardX * across + forwardX * along;
      const z = state.z + starboardZ * across + forwardZ * along;
      positions.setXYZ(
        index,
        x,
        terrainHeightAt(x, z) + TERRAIN_OFFSET_METERS * 0.72,
        z,
      );
    }
    positions.needsUpdate = true;
  }
}

function createPointSizes(): Float32Array {
  const sizes = new Float32Array(POINT_COUNT);
  for (let index = 0; index < POINT_COUNT; index += 1) {
    sizes[index] = 2.8 + seededNoise(index * 23 + 7) * 1.45;
  }
  return sizes;
}

function terrainSlopeAt(x: number, z: number): number {
  const radius = 2.4;
  const xDifference =
    terrainHeightAt(x + radius, z) - terrainHeightAt(x - radius, z);
  const zDifference =
    terrainHeightAt(x, z + radius) - terrainHeightAt(x, z - radius);
  return Math.hypot(xDifference, zDifference) / (radius * 2);
}

function seededNoise(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43_758.5453;
  return value - Math.floor(value);
}

function createReturnMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: "AKULA seabed maneuver lidar returns",
    uniforms: {
      uColor: { value: new Color(0x76e6dd) },
      uOpacity: { value: 0 },
    },
    vertexShader: `
      attribute float aReturn;
      attribute float aSize;
      varying float vReturn;

      void main() {
        vReturn = aReturn;
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = clamp(
          aSize * 135.0 / max(-viewPosition.z, 12.0),
          1.0,
          6.2
        );
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vReturn;

      void main() {
        float radius = length(gl_PointCoord - 0.5) * 2.0;
        float softReturn = 1.0 - smoothstep(0.28, 1.0, radius);
        float core = 1.0 - smoothstep(0.0, 0.3, radius);
        float alpha = softReturn * mix(0.58, 1.0, core) * uOpacity * vReturn;
        if (alpha < 0.002) {
          discard;
        }
        gl_FragColor = vec4(uColor * mix(0.78, 1.05, vReturn), alpha);
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
}

function createFootprintMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: "AKULA seabed maneuver lidar footprint",
    uniforms: {
      uColor: { value: new Color(0x4fc6bd) },
      uOpacity: { value: 0 },
      uScanProgress: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uScanProgress;
      varying vec2 vUv;

      void main() {
        vec2 centered = (vUv - 0.5) * 2.0;
        float radius = length(centered);
        float edgeMask = 1.0 - smoothstep(0.76, 1.0, radius);
        if (edgeMask <= 0.001) {
          discard;
        }

        float scanDistance = (radius - uScanProgress) / 0.075;
        float scanBand = exp(-scanDistance * scanDistance);
        float returnTexture = mix(
          0.78,
          1.0,
          smoothstep(0.58, 0.96, fract((vUv.x + vUv.y) * 37.0))
        );
        float alpha = edgeMask * (0.11 + scanBand * 0.28) * uOpacity;
        gl_FragColor = vec4(uColor * returnTexture, alpha);
      }
    `,
    side: DoubleSide,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
}

function requireUniform(
  material: ShaderMaterial,
  name: string,
): { value: unknown } {
  const uniform = material.uniforms[name];
  if (uniform === undefined) {
    throw new Error(`Missing seabed lidar shader uniform: ${name}`);
  }
  return uniform;
}
