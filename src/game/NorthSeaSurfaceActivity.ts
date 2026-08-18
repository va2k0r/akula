import {
  AdditiveBlending,
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  Points,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Camera,
  type Material,
  type Object3D,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { NorthSeaEnvironmentState } from "./NorthSeaEnvironment";
import type { OceanSurfaceSample } from "./OceanSpectrum";
import { publicAssetPath } from "./PublicAssetPath";

export type NorthSeaTrafficKind =
  "tanker" | "bulk-carrier" | "trawler" | "supply-vessel" | "military-patrol";

export interface NorthSeaTrafficSpec {
  readonly id: string;
  readonly kind: NorthSeaTrafficKind;
  readonly modelPath?: string;
  readonly center: readonly [x: number, z: number];
  readonly radius: readonly [x: number, z: number];
  readonly phase: number;
  readonly speedRadiansPerSecond: number;
  readonly lengthMeters: number;
  readonly beamMeters: number;
  readonly sourceYaw: number;
}

export interface NorthSeaTrafficPose {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly speedMetersPerSecond: number;
}

interface WakeSample {
  x: number;
  z: number;
  age: number;
}

interface TrafficActor {
  readonly spec: NorthSeaTrafficSpec;
  readonly root: Group;
  readonly hull: Group;
  readonly lights: Group;
  readonly wake: Mesh<BufferGeometry, MeshBasicMaterial>;
  readonly wakePositions: BufferAttribute;
  readonly wakeSamples: WakeSample[];
  readonly spray: Points<BufferGeometry, ShaderMaterial>;
  wakeAccumulator: number;
}

interface RigActor {
  readonly root: Group;
  readonly mass: Group;
  readonly lights: Group;
  readonly crane: Group;
  readonly flare: Sprite;
  readonly flareLight: PointLight;
}

const RIG_POSITION = Object.freeze({ x: 1_460, z: -1_080 });
const WAKE_SAMPLE_COUNT = 48;
const WAKE_SAMPLE_INTERVAL_SECONDS = 0.42;
const SURFACE_MODEL_DIRECTORY = publicAssetPath("assets/models/north-sea");

export const NORTH_SEA_TRAFFIC_SPECS: readonly NorthSeaTrafficSpec[] =
  Object.freeze([
    {
      id: "commercial-lane-tanker",
      kind: "tanker",
      modelPath: `${SURFACE_MODEL_DIRECTORY}/tanker-metalrough.glb`,
      center: [-180, 60],
      radius: [3_180, 2_220],
      phase: 0.34,
      speedRadiansPerSecond: 0.00255,
      lengthMeters: 182,
      beamMeters: 28,
      sourceYaw: 0,
    },
    {
      id: "commercial-lane-bulk-carrier",
      kind: "bulk-carrier",
      modelPath: `${SURFACE_MODEL_DIRECTORY}/cargo-ship.glb`,
      center: [120, -110],
      radius: [2_840, 3_260],
      phase: 3.78,
      speedRadiansPerSecond: -0.00215,
      lengthMeters: 154,
      beamMeters: 24,
      sourceYaw: Math.PI,
    },
    {
      id: "fishing-bank-trawler",
      kind: "trawler",
      modelPath: `${SURFACE_MODEL_DIRECTORY}/fishing-trawler.glb`,
      center: [-1_080, 1_260],
      radius: [410, 285],
      phase: 1.18,
      speedRadiansPerSecond: 0.0088,
      lengthMeters: 24,
      beamMeters: 7.4,
      sourceYaw: 0,
    },
    {
      id: "brent-supply-run",
      kind: "supply-vessel",
      modelPath: `${SURFACE_MODEL_DIRECTORY}/supply-vessel.glb`,
      center: [2_160, -660],
      radius: [1_240, 690],
      phase: 2.85,
      speedRadiansPerSecond: -0.0054,
      lengthMeters: 68,
      beamMeters: 15,
      sourceYaw: Math.PI,
    },
    {
      id: "nato-offshore-patrol",
      kind: "military-patrol",
      center: [760, -1_140],
      radius: [1_760, 1_080],
      phase: 5.1,
      speedRadiansPerSecond: 0.0041,
      lengthMeters: 92,
      beamMeters: 12,
      sourceYaw: 0,
    },
  ]);

export function northSeaTrafficPoseAt(
  spec: NorthSeaTrafficSpec,
  elapsedSeconds: number,
): NorthSeaTrafficPose {
  const angle = spec.phase + elapsedSeconds * spec.speedRadiansPerSecond;
  const x = spec.center[0] + Math.cos(angle) * spec.radius[0];
  const z = spec.center[1] + Math.sin(angle) * spec.radius[1];
  const velocityX =
    -Math.sin(angle) * spec.radius[0] * spec.speedRadiansPerSecond;
  const velocityZ =
    Math.cos(angle) * spec.radius[1] * spec.speedRadiansPerSecond;
  return {
    x,
    z,
    heading: Math.atan2(velocityX, velocityZ),
    speedMetersPerSecond: Math.hypot(velocityX, velocityZ),
  };
}

/**
 * Sparse readable surface traffic. Every wake resamples the same ocean as the
 * hull so old foam ribbons flex with the moving spectrum instead of remaining
 * flat decals.
 */
export class NorthSeaSurfaceActivity {
  public readonly root = new Group();
  private readonly actors: TrafficActor[];
  private readonly rig: RigActor;
  private readonly rain = createRainField();
  private readonly gulls = createGulls();
  private readonly helicopter = createHelicopter();
  private readonly matrix = new Matrix4();
  private readonly quaternion = new Quaternion();
  private readonly position = new Vector3();
  private readonly scale = new Vector3(1, 1, 1);
  private tacticalAmount = 0;

  public constructor(
    private readonly sampleWater: (
      x: number,
      z: number,
      elapsedSeconds: number,
    ) => OceanSurfaceSample,
  ) {
    this.root.name = "living-north-sea-surface";
    this.actors = NORTH_SEA_TRAFFIC_SPECS.map((spec) =>
      createTrafficActor(spec),
    );
    this.rig = createOilRig();
    for (const actor of this.actors) {
      this.root.add(actor.root, actor.wake);
    }
    this.root.add(
      this.rig.root,
      this.rain,
      this.gulls.mesh,
      this.helicopter.root,
    );
  }

  public async initialize(): Promise<void> {
    const loader = new GLTFLoader();
    await Promise.all([
      ...this.actors.map(async (actor) => {
        if (actor.spec.modelPath === undefined) {
          return;
        }
        try {
          const gltf = await loader.loadAsync(actor.spec.modelPath);
          installNormalizedModel(
            actor.hull,
            gltf.scene,
            actor.spec.lengthMeters,
            actor.spec.sourceYaw,
          );
        } catch {
          // The procedural silhouette is intentionally kept as a runtime-safe
          // fallback if an optional source model cannot be decoded.
        }
      }),
      (async () => {
        try {
          const gltf = await loader.loadAsync(
            `${SURFACE_MODEL_DIRECTORY}/oil-rig.glb`,
          );
          installNormalizedModel(this.rig.mass, gltf.scene, 118, 0, false);
        } catch {
          // The authored support structure remains readable without the GLB.
        }
      })(),
    ]);
  }

  public update(
    elapsedSeconds: number,
    deltaSeconds: number,
    camera: Camera,
    environment: NorthSeaEnvironmentState,
    underwaterAmount: number,
  ): void {
    const surfaceAmount =
      (1 - MathUtils.smoothstep(underwaterAmount, 0.25, 0.92)) *
      (1 - MathUtils.smoothstep(this.tacticalAmount, 0.12, 0.8));
    this.root.visible = surfaceAmount > 0.008;
    if (!this.root.visible) {
      return;
    }

    for (const actor of this.actors) {
      this.updateTrafficActor(
        actor,
        elapsedSeconds,
        deltaSeconds,
        camera,
        environment,
        surfaceAmount,
      );
    }
    this.updateRig(elapsedSeconds, camera, environment, surfaceAmount);
    this.updateRain(elapsedSeconds, camera, environment, surfaceAmount);
    this.updateHelicopter(elapsedSeconds, camera, environment, surfaceAmount);
    this.updateGulls(elapsedSeconds, camera, environment, surfaceAmount);
  }

  public setTacticalView(amount: number): void {
    this.tacticalAmount = MathUtils.clamp(amount, 0, 1);
  }

  public dispose(): void {
    this.root.traverse((object) => {
      if (object instanceof Mesh || object instanceof Points) {
        object.geometry.dispose();
        disposeMaterial(object.material);
      }
    });
  }

  private updateTrafficActor(
    actor: TrafficActor,
    elapsedSeconds: number,
    deltaSeconds: number,
    camera: Camera,
    environment: NorthSeaEnvironmentState,
    surfaceAmount: number,
  ): void {
    const pose = northSeaTrafficPoseAt(actor.spec, elapsedSeconds);
    const forwardX = Math.sin(pose.heading);
    const forwardZ = Math.cos(pose.heading);
    const sideX = forwardZ;
    const sideZ = -forwardX;
    const halfLength = actor.spec.lengthMeters * 0.42;
    const halfBeam = actor.spec.beamMeters * 0.42;
    const center = this.sampleWater(pose.x, pose.z, elapsedSeconds);
    const bow = this.sampleWater(
      pose.x + forwardX * halfLength,
      pose.z + forwardZ * halfLength,
      elapsedSeconds,
    );
    const stern = this.sampleWater(
      pose.x - forwardX * halfLength,
      pose.z - forwardZ * halfLength,
      elapsedSeconds,
    );
    const port = this.sampleWater(
      pose.x - sideX * halfBeam,
      pose.z - sideZ * halfBeam,
      elapsedSeconds,
    );
    const starboard = this.sampleWater(
      pose.x + sideX * halfBeam,
      pose.z + sideZ * halfBeam,
      elapsedSeconds,
    );

    actor.root.position.set(
      pose.x,
      center.height - actor.spec.lengthMeters * 0.008,
      pose.z,
    );
    actor.root.rotation.set(
      Math.atan2(stern.height - bow.height, halfLength * 2),
      pose.heading,
      Math.atan2(port.height - starboard.height, halfBeam * 2),
      "YXZ",
    );

    const distance = camera.position.distanceTo(actor.root.position);
    actor.hull.visible =
      distance < environment.surfaceVisibilityMeters * 0.9 + 240;
    actor.lights.visible =
      distance < environment.surfaceVisibilityMeters * 1.85 + 780;
    const actorFade = surfaceAmount * (actor.hull.visible ? 1 : 0);
    actor.hull.traverse((object) => setObjectOpacity(object, actorFade));

    actor.wakeAccumulator += deltaSeconds;
    if (actor.wakeAccumulator >= WAKE_SAMPLE_INTERVAL_SECONDS) {
      actor.wakeAccumulator %= WAKE_SAMPLE_INTERVAL_SECONDS;
      actor.wakeSamples.unshift({ x: pose.x, z: pose.z, age: 0 });
      actor.wakeSamples.length = Math.min(
        WAKE_SAMPLE_COUNT,
        actor.wakeSamples.length,
      );
    }
    for (const sample of actor.wakeSamples) {
      sample.age += deltaSeconds;
    }
    updateWakeGeometry(actor, elapsedSeconds, this.sampleWater);
    actor.wake.material.opacity =
      surfaceAmount *
      MathUtils.clamp(
        0.12 +
          pose.speedMetersPerSecond * 0.035 +
          environment.windStrength * 0.14,
        0.12,
        0.62,
      );
    actor.wake.visible = actor.wakeSamples.length > 2;

    requireUniform(actor.spray.material, "uTime").value = elapsedSeconds;
    requireUniform(actor.spray.material, "uIntensity").value =
      surfaceAmount *
      MathUtils.clamp(
        (pose.speedMetersPerSecond - 2.4) / 8 + environment.windStrength * 0.35,
        0,
        1,
      );
  }

  private updateRig(
    elapsedSeconds: number,
    camera: Camera,
    environment: NorthSeaEnvironmentState,
    surfaceAmount: number,
  ): void {
    const water = this.sampleWater(
      RIG_POSITION.x,
      RIG_POSITION.z,
      elapsedSeconds,
    );
    this.rig.root.position.set(RIG_POSITION.x, water.height, RIG_POSITION.z);
    const distance = camera.position.distanceTo(this.rig.root.position);
    this.rig.mass.visible =
      distance < environment.surfaceVisibilityMeters * 0.82 + 320;
    this.rig.lights.visible =
      distance < environment.surfaceVisibilityMeters * 2.1 + 1_100;
    this.rig.crane.rotation.y = Math.sin(elapsedSeconds * 0.014) * 0.72;

    const flareWindow = MathUtils.smoothstep(
      Math.sin(elapsedSeconds * 0.047 + 1.7),
      0.18,
      0.86,
    );
    const flareFlicker = 0.74 + Math.sin(elapsedSeconds * 13.7) * 0.16;
    const flareAmount = flareWindow * flareFlicker * surfaceAmount;
    this.rig.flare.material.opacity = flareAmount;
    this.rig.flare.scale.setScalar(8 + flareAmount * 9);
    this.rig.flareLight.intensity = flareAmount * 24_000;
    this.rig.mass.traverse((object) =>
      setObjectOpacity(object, surfaceAmount * (this.rig.mass.visible ? 1 : 0)),
    );
  }

  private updateRain(
    elapsedSeconds: number,
    camera: Camera,
    environment: NorthSeaEnvironmentState,
    surfaceAmount: number,
  ): void {
    this.rain.position.set(camera.position.x, 0, camera.position.z);
    this.rain.rotation.y = elapsedSeconds * 0.002;
    const material = this.rain.material;
    material.opacity = environment.rain * surfaceAmount * 0.46;
    this.rain.visible = material.opacity > 0.012 && camera.position.y > -8;
  }

  private updateHelicopter(
    elapsedSeconds: number,
    camera: Camera,
    environment: NorthSeaEnvironmentState,
    surfaceAmount: number,
  ): void {
    const encounterTime = (((elapsedSeconds + 45) % 780) + 780) % 780;
    const active = encounterTime < 96;
    const angle = encounterTime * 0.024 - 1.3;
    const radius = 520 - encounterTime * 3.2;
    this.helicopter.root.position.set(
      RIG_POSITION.x + Math.cos(angle) * radius,
      78 + Math.sin(encounterTime * 0.07) * 7,
      RIG_POSITION.z + Math.sin(angle) * radius,
    );
    this.helicopter.root.rotation.y = -angle + Math.PI / 2;
    this.helicopter.rotor.rotation.y = elapsedSeconds * 34;
    const distance = camera.position.distanceTo(this.helicopter.root.position);
    this.helicopter.root.visible =
      active &&
      surfaceAmount > 0.02 &&
      environment.squall < 0.68 &&
      distance < environment.surfaceVisibilityMeters + 450;
  }

  private updateGulls(
    elapsedSeconds: number,
    camera: Camera,
    environment: NorthSeaEnvironmentState,
    surfaceAmount: number,
  ): void {
    const anchors = [
      [RIG_POSITION.x, RIG_POSITION.z, 8],
      [-1_080, 1_260, 7],
      [-3_420, 620, 5],
    ] as const;
    let gullIndex = 0;
    for (const [anchorX, anchorZ, count] of anchors) {
      for (let localIndex = 0; localIndex < count; localIndex += 1) {
        const phase = localIndex * 2.399 + gullIndex * 0.71;
        const angle = elapsedSeconds * (0.08 + localIndex * 0.002) + phase;
        const radius = 26 + (localIndex % 4) * 14;
        this.position.set(
          anchorX + Math.cos(angle) * radius,
          15 + Math.sin(angle * 1.7 + phase) * 5 + (gullIndex % 3) * 2,
          anchorZ + Math.sin(angle) * radius,
        );
        this.quaternion.setFromAxisAngle(
          new Vector3(0, 1, 0),
          -angle + Math.PI / 2,
        );
        const wingBeat = 0.72 + Math.sin(elapsedSeconds * 4.2 + phase) * 0.18;
        this.scale.set(wingBeat, 1, 1);
        this.matrix.compose(this.position, this.quaternion, this.scale);
        this.gulls.mesh.setMatrixAt(gullIndex, this.matrix);
        gullIndex += 1;
      }
    }
    this.gulls.mesh.instanceMatrix.needsUpdate = true;
    this.gulls.mesh.visible =
      surfaceAmount > 0.02 &&
      environment.squall < 0.76 &&
      camera.position.y > -15;
  }
}

function createTrafficActor(spec: NorthSeaTrafficSpec): TrafficActor {
  const root = new Group();
  root.name = spec.id;
  const hull = createProceduralShip(spec);
  const lights = createNavigationLights(spec);
  const spray = createBowSpray(spec.lengthMeters, spec.beamMeters);
  root.add(hull, lights, spray);
  const wake = createWakeMesh(spec.id);
  const wakePositions = wake.geometry.getAttribute("position");
  if (!(wakePositions instanceof BufferAttribute)) {
    throw new Error(`Missing wake position buffer for ${spec.id}`);
  }
  return {
    spec,
    root,
    hull,
    lights,
    wake,
    wakePositions,
    wakeSamples: [],
    spray,
    wakeAccumulator: WAKE_SAMPLE_INTERVAL_SECONDS,
  };
}

function createProceduralShip(spec: NorthSeaTrafficSpec): Group {
  const group = new Group();
  group.name = `${spec.id}-mass`;
  const naval = spec.kind === "military-patrol";
  const fishing = spec.kind === "trawler";
  const hull = new Mesh(
    new BoxGeometry(
      spec.beamMeters,
      spec.lengthMeters * 0.12,
      spec.lengthMeters,
    ),
    new MeshStandardMaterial({
      color: naval ? 0x59656a : fishing ? 0x38505a : 0x3f4b50,
      roughness: 0.63,
      metalness: 0.18,
    }),
  );
  hull.position.y = spec.lengthMeters * 0.025;
  const bow = new Mesh(
    new ConeGeometry(spec.beamMeters * 0.52, spec.lengthMeters * 0.22, 5),
    hull.material,
  );
  bow.rotation.x = Math.PI / 2;
  bow.position.set(0, spec.lengthMeters * 0.03, spec.lengthMeters * 0.58);
  const superstructure = new Mesh(
    new BoxGeometry(
      spec.beamMeters * 0.72,
      spec.lengthMeters * (fishing ? 0.22 : 0.16),
      spec.lengthMeters * (naval ? 0.22 : 0.18),
    ),
    new MeshStandardMaterial({
      color: naval ? 0x778386 : 0xc2c5c0,
      roughness: 0.78,
      metalness: 0.08,
    }),
  );
  superstructure.position.set(
    0,
    spec.lengthMeters * 0.12,
    -spec.lengthMeters * 0.18,
  );
  group.add(hull, bow, superstructure);
  if (naval) {
    const mast = new Mesh(
      new CylinderGeometry(0.45, 0.7, 18, 8),
      new MeshStandardMaterial({ color: 0x626f72, roughness: 0.7 }),
    );
    mast.position.set(0, 14, -6);
    group.add(mast);
  }
  return group;
}

function createNavigationLights(spec: NorthSeaTrafficSpec): Group {
  const group = new Group();
  group.name = `${spec.id}-navigation-lights`;
  const height = Math.max(3, spec.lengthMeters * 0.13);
  const locations = [
    [-spec.beamMeters * 0.42, height, 0, 0xff2b1d],
    [spec.beamMeters * 0.42, height, 0, 0x38ff92],
    [0, height * 1.35, -spec.lengthMeters * 0.15, 0xffe7b0],
  ] as const;
  for (const [x, y, z, color] of locations) {
    const sprite = new Sprite(
      new SpriteMaterial({
        color,
        transparent: true,
        opacity: 0.88,
        blending: AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        fog: false,
      }),
    );
    sprite.position.set(x, y, z);
    sprite.scale.setScalar(MathUtils.clamp(spec.lengthMeters * 0.045, 1.5, 5));
    group.add(sprite);
  }
  return group;
}

function createWakeMesh(name: string): Mesh<BufferGeometry, MeshBasicMaterial> {
  const geometry = new BufferGeometry();
  const positions = new Float32Array(WAKE_SAMPLE_COUNT * 2 * 3);
  const indices: number[] = [];
  for (let index = 0; index < WAKE_SAMPLE_COUNT - 1; index += 1) {
    const first = index * 2;
    indices.push(first, first + 2, first + 1, first + 2, first + 3, first + 1);
  }
  geometry.setAttribute(
    "position",
    new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage),
  );
  geometry.setIndex(indices);
  const material = new MeshBasicMaterial({
    color: 0xd5e3e1,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    side: DoubleSide,
    fog: true,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = `${name}-persistent-spectrum-wake`;
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  return mesh;
}

function updateWakeGeometry(
  actor: TrafficActor,
  elapsedSeconds: number,
  sampleWater: (
    x: number,
    z: number,
    elapsedSeconds: number,
  ) => OceanSurfaceSample,
): void {
  const samples = actor.wakeSamples;
  for (let index = 0; index < WAKE_SAMPLE_COUNT; index += 1) {
    const sample = samples[index] ?? samples[samples.length - 1];
    if (sample === undefined) {
      actor.wakePositions.setXYZ(index * 2, 0, -20, 0);
      actor.wakePositions.setXYZ(index * 2 + 1, 0, -20, 0);
      continue;
    }
    const previous = samples[Math.min(index + 1, samples.length - 1)] ?? sample;
    const next = samples[Math.max(0, index - 1)] ?? sample;
    const deltaX = next.x - previous.x;
    const deltaZ = next.z - previous.z;
    const inverseLength = 1 / Math.max(0.001, Math.hypot(deltaX, deltaZ));
    const sideX = deltaZ * inverseLength;
    const sideZ = -deltaX * inverseLength;
    const width = actor.spec.beamMeters * 0.36 + sample.age * 0.88;
    const water = sampleWater(sample.x, sample.z, elapsedSeconds);
    actor.wakePositions.setXYZ(
      index * 2,
      sample.x - sideX * width,
      water.height + 0.12,
      sample.z - sideZ * width,
    );
    actor.wakePositions.setXYZ(
      index * 2 + 1,
      sample.x + sideX * width,
      water.height + 0.12,
      sample.z + sideZ * width,
    );
  }
  actor.wakePositions.needsUpdate = true;
  actor.wake.geometry.computeBoundingSphere();
}

function createBowSpray(
  length: number,
  beam: number,
): Points<BufferGeometry, ShaderMaterial> {
  const count = MathUtils.clamp(Math.round(length / 3), 12, 54);
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const seed = seededNoise(index * 29 + Math.round(length));
    positions[index * 3] = (seed - 0.5) * beam * 0.72;
    positions[index * 3 + 1] = seededNoise(index * 31 + 4) * 4;
    positions[index * 3 + 2] = length * 0.49 + seededNoise(index * 37 + 7) * 5;
    seeds[index] = seed;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("aSeed", new BufferAttribute(seeds, 1));
  const material = new ShaderMaterial({
    name: "route-and-sea-state bow spray",
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 } },
    vertexShader: `
      uniform float uTime;
      uniform float uIntensity;
      attribute float aSeed;
      varying float vAlpha;
      void main() {
        float age = fract(uTime * (0.44 + aSeed * 0.42) + aSeed * 17.0);
        vec3 sprayed = position;
        sprayed.x *= 0.35 + age;
        sprayed.y += sin(age * 3.14159) * (2.5 + aSeed * 5.0);
        sprayed.z -= age * (4.0 + aSeed * 7.0);
        vec4 viewPosition = modelViewMatrix * vec4(sprayed, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = clamp((2.0 + aSeed * 3.0) * 90.0 / max(-viewPosition.z, 10.0), 0.8, 5.0);
        vAlpha = uIntensity * (1.0 - age);
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        float radius = length(gl_PointCoord - 0.5) * 2.0;
        float alpha = (1.0 - smoothstep(0.1, 1.0, radius)) * vAlpha;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(vec3(0.82, 0.91, 0.92), alpha);
      }
    `,
  });
  const spray = new Points(geometry, material);
  spray.frustumCulled = false;
  return spray;
}

function createOilRig(): RigActor {
  const root = new Group();
  root.name = "1980s-fixed-production-platform";
  const mass = new Group();
  const steel = new MeshStandardMaterial({
    color: 0x8d8f88,
    metalness: 0.52,
    roughness: 0.57,
  });
  const deck = new Mesh(new BoxGeometry(94, 8, 72), steel);
  deck.position.y = 34;
  const module = new Mesh(
    new BoxGeometry(54, 22, 42),
    new MeshStandardMaterial({ color: 0xb6b0a0, roughness: 0.74 }),
  );
  module.position.set(-8, 49, 2);
  mass.add(deck, module);
  for (const x of [-34, 34]) {
    for (const z of [-25, 25]) {
      const leg = new Mesh(new CylinderGeometry(2.6, 4.2, 150, 10), steel);
      leg.position.set(x, -37, z);
      mass.add(leg);
    }
  }

  const lights = new Group();
  lights.name = "industrial-lights-visible-through-fog";
  for (let index = 0; index < 18; index += 1) {
    const angle = (index / 18) * Math.PI * 2;
    const sprite = new Sprite(
      new SpriteMaterial({
        color: index % 5 === 0 ? 0xffa34e : 0xffe2a4,
        transparent: true,
        opacity: 0.82,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    sprite.position.set(
      Math.cos(angle) * 44,
      35 + (index % 3) * 12,
      Math.sin(angle) * 33,
    );
    sprite.scale.setScalar(index % 5 === 0 ? 5 : 3);
    lights.add(sprite);
  }

  const crane = new Group();
  crane.position.set(31, 53, -17);
  const craneTower = new Mesh(new BoxGeometry(3, 30, 3), steel);
  craneTower.position.y = 15;
  const boom = new Mesh(new BoxGeometry(3, 3, 49), steel);
  boom.position.set(0, 28, 21);
  boom.rotation.x = -0.2;
  crane.add(craneTower, boom);

  const flare = new Sprite(
    new SpriteMaterial({
      color: 0xff5b1f,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  flare.position.set(-38, 83, -24);
  const flareLight = new PointLight(0xff5a23, 0, 150, 2);
  flareLight.position.copy(flare.position);
  root.add(mass, lights, crane, flare, flareLight);
  return { root, mass, lights, crane, flare, flareLight };
}

function createRainField(): LineSegments<BufferGeometry, LineBasicMaterial> {
  const count = 620;
  const positions = new Float32Array(count * 6);
  for (let index = 0; index < count; index += 1) {
    const x = (seededNoise(index * 11 + 1) - 0.5) * 520;
    const y = 8 + seededNoise(index * 11 + 2) * 145;
    const z = (seededNoise(index * 11 + 3) - 0.5) * 520;
    const length = 4 + seededNoise(index * 11 + 4) * 11;
    positions.set(
      [x, y, z, x - length * 0.18, y - length, z + length * 0.09],
      index * 6,
    );
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  const rain = new LineSegments(
    geometry,
    new LineBasicMaterial({
      color: 0xb6cbd0,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: true,
    }),
  );
  rain.name = "moving-local-rain-front";
  rain.frustumCulled = false;
  return rain;
}

function createGulls(): { mesh: InstancedMesh } {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(
      new Float32Array([
        -1.4, 0, 0, 0, 0.24, 0, 1.4, 0, 0, -1.4, 0, 0, 0, -0.13, 0, 1.4, 0, 0,
      ]),
      3,
    ),
  );
  const mesh = new InstancedMesh(
    geometry,
    new MeshBasicMaterial({ color: 0xd7dbd4, side: DoubleSide, fog: true }),
    20,
  );
  mesh.name = "localized-rig-trawler-coast-gulls";
  mesh.frustumCulled = false;
  return { mesh };
}

function createHelicopter(): { root: Group; rotor: Mesh } {
  const root = new Group();
  root.name = "occasional-offshore-helicopter";
  const dark = new MeshStandardMaterial({ color: 0x25363a, roughness: 0.58 });
  const body = new Mesh(new SphereGeometry(4.2, 14, 8), dark);
  body.scale.set(1.5, 0.85, 1);
  const tail = new Mesh(new BoxGeometry(1.1, 1.2, 12), dark);
  tail.position.z = -8;
  const rotor = new Mesh(
    new BoxGeometry(25, 0.12, 0.42),
    new MeshBasicMaterial({ color: 0x151b1c }),
  );
  rotor.position.y = 4.2;
  root.add(body, tail, rotor);
  return { root, rotor };
}

function installNormalizedModel(
  target: Group,
  source: Object3D,
  desiredLongestSideMeters: number,
  sourceYaw: number,
  hideFallback = true,
): void {
  source.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(source, true);
  const size = bounds.getSize(new Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(longest) || longest <= Number.EPSILON) {
    return;
  }
  const center = bounds.getCenter(new Vector3());
  const scale = desiredLongestSideMeters / longest;
  source.position.set(-center.x, -bounds.min.y, -center.z);
  const modelRoot = new Group();
  modelRoot.name = "licensed-normalized-source-model";
  modelRoot.scale.setScalar(scale);
  modelRoot.rotation.y = sourceYaw;
  modelRoot.add(source);
  target.add(modelRoot);
  if (hideFallback) {
    for (const child of target.children) {
      if (child !== modelRoot) {
        child.visible = false;
      }
    }
  }
  modelRoot.traverse((object) => {
    if (object instanceof Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
}

function setObjectOpacity(object: Object3D, opacity: number): void {
  if (!(object instanceof Mesh)) {
    return;
  }
  const materials = Array.isArray(object.material)
    ? object.material
    : [object.material];
  for (const material of materials) {
    material.transparent = opacity < 0.999;
    material.opacity = opacity;
    material.depthWrite = opacity > 0.65;
  }
}

function disposeMaterial(material: Material | Material[]): void {
  if (Array.isArray(material)) {
    for (const item of material) {
      item.dispose();
    }
    return;
  }
  material.dispose();
}

function requireUniform(
  material: ShaderMaterial,
  name: string,
): { value: unknown } {
  const uniform = material.uniforms[name];
  if (uniform === undefined) {
    throw new Error(`Missing surface-activity shader uniform: ${name}`);
  }
  return uniform;
}

function seededNoise(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43_758.5453;
  return value - Math.floor(value);
}

export const NORTH_SEA_RIG_POSITION = RIG_POSITION;
