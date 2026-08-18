import {
  AnimationMixer,
  Box3,
  Group,
  MathUtils,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type AnimationClip,
  type Camera,
  type Material,
  type Object3D,
} from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  propulsionStartleStrength,
  type MarineLifeDisturbanceState,
} from "./MarineLifeDisturbance";

export type NorthSeaMegafaunaSpecies =
  "orca" | "baleen-whale" | "seal" | "jellyfish" | "harbour-porpoise";

export interface NorthSeaMegafaunaSpec {
  readonly id: string;
  readonly species: NorthSeaMegafaunaSpecies;
  readonly modelPath: string;
  readonly animation: "embedded" | "procedural";
  readonly preferredClip?: string;
  readonly desiredLengthMeters: number;
  readonly center: readonly [x: number, y: number, z: number];
  readonly orbit: readonly [radiusX: number, radiusY: number, radiusZ: number];
  readonly phase: number;
  readonly angularSpeed: number;
  readonly alignmentYaw: number;
  readonly bankRadians: number;
  readonly upright: boolean;
  readonly encounterPeriodSeconds: number;
  readonly encounterDurationSeconds: number;
  readonly encounterOffsetSeconds: number;
}

interface AnimatedMaterial {
  readonly material: Material;
  readonly baseOpacity: number;
  readonly baseTransparent: boolean;
  readonly baseDepthWrite: boolean;
}

interface MotionUniform {
  value: number;
}

interface MegafaunaActor {
  readonly spec: NorthSeaMegafaunaSpec;
  readonly root: Group;
  readonly pulseRoot: Group;
  readonly mixers: readonly AnimationMixer[];
  readonly materials: readonly AnimatedMaterial[];
  readonly motionUniforms: readonly MotionUniform[];
  readonly escapeOffset: Vector3;
  readonly escapeVelocity: Vector3;
  motionTime: number;
}

interface StartleProfile {
  readonly restartRadiusMeters: number;
  readonly runningRadiusMeters: number;
  readonly maximumImpulseMetersPerSecond: number;
  readonly runningAccelerationMetersPerSecondSquared: number;
}

const DRACO_DECODER_PATH = "/assets/draco/";
const MODEL_DIRECTORY = "/assets/models/marine-life";
const FORWARD = new Vector3(0, 0, 1);
const MAX_RENDER_DISTANCE_METERS = 240;
const FUTURE_PATH_SAMPLE_SECONDS = 0.35;
const MAX_ESCAPE_OFFSET_METERS = 55;
const STARTLE_PROFILES: Readonly<
  Record<NorthSeaMegafaunaSpecies, StartleProfile>
> = Object.freeze({
  orca: {
    restartRadiusMeters: 115,
    runningRadiusMeters: 72,
    maximumImpulseMetersPerSecond: 9,
    runningAccelerationMetersPerSecondSquared: 3.2,
  },
  "baleen-whale": {
    restartRadiusMeters: 130,
    runningRadiusMeters: 82,
    maximumImpulseMetersPerSecond: 6,
    runningAccelerationMetersPerSecondSquared: 1.8,
  },
  seal: {
    restartRadiusMeters: 88,
    runningRadiusMeters: 58,
    maximumImpulseMetersPerSecond: 13,
    runningAccelerationMetersPerSecondSquared: 4.8,
  },
  jellyfish: {
    restartRadiusMeters: 56,
    runningRadiusMeters: 38,
    maximumImpulseMetersPerSecond: 0,
    runningAccelerationMetersPerSecondSquared: 0,
  },
  "harbour-porpoise": {
    restartRadiusMeters: 105,
    runningRadiusMeters: 68,
    maximumImpulseMetersPerSecond: 15,
    runningAccelerationMetersPerSecondSquared: 5.2,
  },
});

/**
 * Fixed habitat paths distributed across the operational area. Mammals are
 * encounter windows, not permanent ornaments; a player can traverse a habitat
 * several times before seeing one.
 */
export const NORTH_SEA_MARINE_LIFE_SPECS: readonly NorthSeaMegafaunaSpec[] =
  Object.freeze([
    {
      id: "rare-orca-shelf-crossing",
      species: "orca",
      modelPath: `${MODEL_DIRECTORY}/orca.glb`,
      animation: "procedural",
      desiredLengthMeters: 8.2,
      center: [1_180, -68, -420],
      orbit: [92, 12, 160],
      phase: 0.35,
      angularSpeed: 0.055,
      alignmentYaw: 0,
      bankRadians: 0.12,
      upright: false,
      encounterPeriodSeconds: 1_500,
      encounterDurationSeconds: 78,
      encounterOffsetSeconds: 820,
    },
    {
      id: "rare-baleen-whale-migration",
      species: "baleen-whale",
      modelPath: `${MODEL_DIRECTORY}/baleen-whale.glb`,
      animation: "embedded",
      preferredClip: "Play",
      desiredLengthMeters: 24,
      center: [-1_520, -86, 920],
      orbit: [130, 16, 220],
      phase: 2.45,
      angularSpeed: 0.018,
      alignmentYaw: 0,
      bankRadians: 0.055,
      upright: false,
      encounterPeriodSeconds: 1_800,
      encounterDurationSeconds: 108,
      encounterOffsetSeconds: 1_240,
    },
    {
      id: "rare-grey-seal-foraging-dive",
      species: "seal",
      modelPath: `${MODEL_DIRECTORY}/seal.glb`,
      animation: "embedded",
      preferredClip: "Swim",
      desiredLengthMeters: 2.15,
      center: [-2_860, -42, 690],
      orbit: [48, 18, 86],
      phase: 4.1,
      angularSpeed: 0.11,
      alignmentYaw: 0,
      bankRadians: 0.18,
      upright: false,
      encounterPeriodSeconds: 960,
      encounterDurationSeconds: 58,
      encounterOffsetSeconds: 310,
    },
    {
      id: "jellyfish-shelf-drift-west",
      species: "jellyfish",
      modelPath: `${MODEL_DIRECTORY}/jellyfish.glb`,
      animation: "procedural",
      desiredLengthMeters: 3.6,
      center: [-610, -72, 740],
      orbit: [42, 14, 58],
      phase: 1.25,
      angularSpeed: 0.035,
      alignmentYaw: 0,
      bankRadians: 0,
      upright: true,
      encounterPeriodSeconds: 840,
      encounterDurationSeconds: 310,
      encounterOffsetSeconds: 30,
    },
    {
      id: "jellyfish-shelf-drift-east",
      species: "jellyfish",
      modelPath: `${MODEL_DIRECTORY}/jellyfish.glb`,
      animation: "procedural",
      desiredLengthMeters: 2.7,
      center: [780, -92, -1_340],
      orbit: [38, 12, 54],
      phase: 3.7,
      angularSpeed: 0.041,
      alignmentYaw: 0,
      bankRadians: 0,
      upright: true,
      encounterPeriodSeconds: 920,
      encounterDurationSeconds: 280,
      encounterOffsetSeconds: 470,
    },
    {
      id: "rare-harbour-porpoise-lead",
      species: "harbour-porpoise",
      modelPath: `${MODEL_DIRECTORY}/dolphin.glb`,
      animation: "procedural",
      desiredLengthMeters: 1.78,
      center: [260, -48, 1_860],
      orbit: [72, 15, 125],
      phase: 0.7,
      angularSpeed: 0.095,
      alignmentYaw: Math.PI / 2,
      bankRadians: 0.2,
      upright: false,
      encounterPeriodSeconds: 720,
      encounterDurationSeconds: 72,
      encounterOffsetSeconds: 180,
    },
    {
      id: "rare-harbour-porpoise-wing",
      species: "harbour-porpoise",
      modelPath: `${MODEL_DIRECTORY}/dolphin.glb`,
      animation: "procedural",
      desiredLengthMeters: 1.62,
      center: [274, -51, 1_846],
      orbit: [66, 13, 112],
      phase: 2.85,
      angularSpeed: 0.087,
      alignmentYaw: Math.PI / 2,
      bankRadians: 0.18,
      upright: false,
      encounterPeriodSeconds: 720,
      encounterDurationSeconds: 72,
      encounterOffsetSeconds: 180,
    },
    {
      id: "rare-harbour-porpoise-trail",
      species: "harbour-porpoise",
      modelPath: `${MODEL_DIRECTORY}/dolphin.glb`,
      animation: "procedural",
      desiredLengthMeters: 1.55,
      center: [246, -54, 1_838],
      orbit: [58, 12, 102],
      phase: 5.15,
      angularSpeed: 0.082,
      alignmentYaw: Math.PI / 2,
      bankRadians: 0.16,
      upright: false,
      encounterPeriodSeconds: 720,
      encounterDurationSeconds: 72,
      encounterOffsetSeconds: 180,
    },
  ]);

export const NORTH_SEA_MARINE_LIFE_COUNTS = Object.freeze(
  NORTH_SEA_MARINE_LIFE_SPECS.reduce<Record<NorthSeaMegafaunaSpecies, number>>(
    (counts, spec) => {
      counts[spec.species] += 1;
      return counts;
    },
    {
      orca: 0,
      "baleen-whale": 0,
      seal: 0,
      jellyfish: 0,
      "harbour-porpoise": 0,
    },
  ),
);

export function northSeaMegafaunaPositionAt(
  spec: NorthSeaMegafaunaSpec,
  elapsedSeconds: number,
  result = new Vector3(),
): Vector3 {
  const angle = spec.phase + elapsedSeconds * spec.angularSpeed;
  result.set(
    spec.center[0] + Math.cos(angle) * spec.orbit[0],
    spec.center[1] + Math.sin(angle * 1.7 + spec.phase * 0.43) * spec.orbit[1],
    spec.center[2] + Math.sin(angle) * spec.orbit[2],
  );
  return result;
}

export function northSeaMegafaunaEncounterActiveAt(
  spec: NorthSeaMegafaunaSpec,
  elapsedSeconds: number,
): boolean {
  const localTime =
    (((elapsedSeconds + spec.encounterOffsetSeconds) %
      spec.encounterPeriodSeconds) +
      spec.encounterPeriodSeconds) %
    spec.encounterPeriodSeconds;
  return localTime < spec.encounterDurationSeconds;
}

export function northSeaMegafaunaStartleSpeed(
  species: NorthSeaMegafaunaSpecies,
  distanceMeters: number,
  propulsionIntensity: number,
): number {
  const profile = STARTLE_PROFILES[species];
  return (
    propulsionStartleStrength(
      distanceMeters,
      profile.restartRadiusMeters,
      propulsionIntensity,
    ) * profile.maximumImpulseMetersPerSecond
  );
}

/**
 * Spatially fixed and temporally sparse: mammals surface as memorable events,
 * while two jellyfish drifts persist longer without following the camera.
 */
export class NorthSeaMegafauna {
  public readonly root = new Group();
  private readonly actors: MegafaunaActor[] = [];
  private readonly position = new Vector3();
  private readonly futurePosition = new Vector3();
  private readonly direction = new Vector3();
  private readonly awayFromVessel = new Vector3();
  private readonly bank = new Quaternion();

  public constructor() {
    this.root.name = "rare-north-sea-megafauna-encounters";
  }

  public async initialize(): Promise<void> {
    const draco = new DRACOLoader();
    draco.setDecoderPath(DRACO_DECODER_PATH);
    draco.preload();
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);

    try {
      const models = new Map<
        string,
        Awaited<ReturnType<GLTFLoader["loadAsync"]>>
      >();
      const uniquePaths = [
        ...new Set(NORTH_SEA_MARINE_LIFE_SPECS.map((spec) => spec.modelPath)),
      ];
      await Promise.all(
        uniquePaths.map(async (path) => {
          models.set(path, await loader.loadAsync(path));
        }),
      );

      for (const spec of NORTH_SEA_MARINE_LIFE_SPECS) {
        const model = models.get(spec.modelPath);
        if (model === undefined) {
          throw new Error(
            `Missing loaded marine-life model: ${spec.modelPath}`,
          );
        }
        const actor = createActor(spec, model.scene, model.animations);
        this.actors.push(actor);
        this.root.add(actor.root);
      }
    } finally {
      draco.dispose();
    }
  }

  public update(
    elapsedSeconds: number,
    deltaSeconds: number,
    camera: Camera,
    tacticalAmount: number,
    underwaterAmount: number,
    disturbance: MarineLifeDisturbanceState,
  ): void {
    const environmentAmount =
      underwaterAmount * (1 - smoothstep(0.08, 0.78, tacticalAmount));
    const maximumDistanceSquared =
      MAX_RENDER_DISTANCE_METERS * MAX_RENDER_DISTANCE_METERS;

    for (const actor of this.actors) {
      northSeaMegafaunaPositionAt(actor.spec, elapsedSeconds, this.position);
      this.updateEscapeResponse(actor, disturbance, deltaSeconds);
      const escapeMotion = MathUtils.clamp(
        actor.escapeVelocity.length() /
          Math.max(
            1,
            STARTLE_PROFILES[actor.spec.species].maximumImpulseMetersPerSecond,
          ),
        0,
        1,
      );
      actor.motionTime += deltaSeconds * (1 + escapeMotion * 1.25);
      this.position.add(actor.escapeOffset);
      actor.root.position.copy(this.position);
      const withinRange =
        camera.position.distanceToSquared(this.position) <
        maximumDistanceSquared;
      actor.root.visible =
        environmentAmount > 0.01 &&
        withinRange &&
        northSeaMegafaunaEncounterActiveAt(actor.spec, elapsedSeconds);

      if (!actor.root.visible) {
        continue;
      }

      if (actor.spec.upright) {
        actor.root.rotation.set(
          0,
          elapsedSeconds * 0.045 + actor.spec.phase,
          0,
        );
      } else {
        northSeaMegafaunaPositionAt(
          actor.spec,
          elapsedSeconds + FUTURE_PATH_SAMPLE_SECONDS,
          this.futurePosition,
        );
        this.futurePosition
          .add(actor.escapeOffset)
          .addScaledVector(actor.escapeVelocity, FUTURE_PATH_SAMPLE_SECONDS);
        this.direction
          .subVectors(this.futurePosition, this.position)
          .normalize();
        actor.root.quaternion.setFromUnitVectors(FORWARD, this.direction);
        this.bank.setFromAxisAngle(
          FORWARD,
          Math.sin(
            elapsedSeconds * actor.spec.angularSpeed * 2.7 + actor.spec.phase,
          ) * actor.spec.bankRadians,
        );
        actor.root.quaternion.multiply(this.bank);
      }

      const pulse = Math.sin(elapsedSeconds * 1.34 + actor.spec.phase);
      if (actor.spec.species === "jellyfish") {
        actor.pulseRoot.scale.set(
          1 + pulse * 0.075,
          1 - pulse * 0.045,
          1 + pulse * 0.075,
        );
      } else {
        actor.pulseRoot.scale.setScalar(1);
      }

      for (const mixer of actor.mixers) {
        mixer.timeScale = 1 + escapeMotion * 0.8;
        mixer.update(deltaSeconds);
      }
      for (const uniform of actor.motionUniforms) {
        uniform.value = actor.motionTime + actor.spec.phase * 0.71;
      }
      updateMaterialVisibility(actor.materials, environmentAmount);
    }
  }

  private updateEscapeResponse(
    actor: MegafaunaActor,
    disturbance: MarineLifeDisturbanceState,
    deltaSeconds: number,
  ): void {
    const profile = STARTLE_PROFILES[actor.spec.species];
    this.awayFromVessel.set(
      this.position.x - disturbance.x,
      (this.position.y - disturbance.y) * 0.32,
      this.position.z - disturbance.z,
    );
    const distanceMeters = this.awayFromVessel.length();
    if (distanceMeters < 0.001) {
      this.awayFromVessel.set(
        Math.cos(actor.spec.phase),
        0.08,
        Math.sin(actor.spec.phase),
      );
    }
    this.awayFromVessel.normalize();

    if (disturbance.propulsionRestarted) {
      const impulse = northSeaMegafaunaStartleSpeed(
        actor.spec.species,
        distanceMeters,
        disturbance.propulsionIntensity,
      );
      actor.escapeVelocity.addScaledVector(this.awayFromVessel, impulse);
    }
    if (!disturbance.propulsionStopped) {
      const runningAvoidance = propulsionStartleStrength(
        distanceMeters,
        profile.runningRadiusMeters,
        disturbance.propulsionIntensity,
      );
      actor.escapeVelocity.addScaledVector(
        this.awayFromVessel,
        runningAvoidance *
          profile.runningAccelerationMetersPerSecondSquared *
          deltaSeconds,
      );
    }

    actor.escapeVelocity.clampLength(0, profile.maximumImpulseMetersPerSecond);
    actor.escapeVelocity.multiplyScalar(Math.exp(-deltaSeconds * 0.52));
    actor.escapeOffset.addScaledVector(actor.escapeVelocity, deltaSeconds);
    actor.escapeOffset.multiplyScalar(
      Math.exp(-deltaSeconds * (disturbance.propulsionStopped ? 0.09 : 0.014)),
    );
    actor.escapeOffset.clampLength(0, MAX_ESCAPE_OFFSET_METERS);
  }
}

function createActor(
  spec: NorthSeaMegafaunaSpec,
  source: Object3D,
  animations: readonly AnimationClip[],
): MegafaunaActor {
  const root = new Group();
  root.name = spec.id;
  root.rotation.order = "YXZ";
  const pulseRoot = new Group();
  const sourceAxis = new Group();
  const modelScale = new Group();
  const model = cloneSkeleton(source);

  hideSourcePresentationGeometry(spec, model);
  model.updateMatrixWorld(true);
  const bounds = visibleMeshBounds(model);
  if (bounds.isEmpty()) {
    throw new Error(`Marine-life model has no visible geometry: ${spec.id}`);
  }
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  const longestSide = Math.max(size.x, size.y, size.z);
  if (longestSide <= Number.EPSILON) {
    throw new Error(`Marine-life model has zero size: ${spec.id}`);
  }
  model.position.sub(center);
  modelScale.scale.setScalar(spec.desiredLengthMeters / longestSide);
  sourceAxis.rotation.y = spec.alignmentYaw;
  modelScale.add(model);
  sourceAxis.add(modelScale);
  pulseRoot.add(sourceAxis);
  root.add(pulseRoot);

  const motionUniforms: MotionUniform[] = [];
  const materials = cloneAndPrepareMaterials(spec, model, motionUniforms);
  const mixers: AnimationMixer[] = [];
  if (spec.animation === "embedded") {
    const clip = preferredAnimationClip(animations, spec.preferredClip);
    if (clip === undefined) {
      throw new Error(`Expected an animation clip for ${spec.id}.`);
    }
    const mixer = new AnimationMixer(model);
    const action = mixer.clipAction(clip);
    action.timeScale = spec.species === "baleen-whale" ? 0.72 : 0.82;
    action.play();
    mixers.push(mixer);
  }

  northSeaMegafaunaPositionAt(spec, 0, root.position);
  return {
    spec,
    root,
    pulseRoot,
    mixers,
    materials,
    motionUniforms,
    escapeOffset: new Vector3(),
    escapeVelocity: new Vector3(),
    motionTime: 0,
  };
}

function hideSourcePresentationGeometry(
  spec: NorthSeaMegafaunaSpec,
  root: Object3D,
): void {
  if (spec.species !== "baleen-whale") {
    return;
  }
  root.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return;
    }
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    if (materials.some((material) => material.name === "material_5")) {
      // The Sketchfab source contains a 128 m presentation sphere. It is not
      // part of the whale and would otherwise dominate normalization/fog.
      object.visible = false;
    }
  });
}

function visibleMeshBounds(root: Object3D): Box3 {
  const bounds = new Box3();
  const meshBounds = new Box3();
  bounds.makeEmpty();
  root.traverse((object) => {
    if (object.visible && object instanceof Mesh) {
      meshBounds.setFromObject(object, true);
      bounds.union(meshBounds);
    }
  });
  return bounds;
}

function cloneAndPrepareMaterials(
  spec: NorthSeaMegafaunaSpec,
  root: Object3D,
  motionUniforms: MotionUniform[],
): AnimatedMaterial[] {
  const materials: AnimatedMaterial[] = [];
  root.traverse((object) => {
    if (!object.visible || !(object instanceof Mesh)) {
      return;
    }
    object.castShadow = false;
    object.receiveShadow = true;
    const sources = Array.isArray(object.material)
      ? object.material
      : [object.material];
    const clones = sources.map((source) => {
      const material = source.clone();
      tuneMarineMaterial(spec.species, material);
      if (spec.animation === "procedural") {
        addProceduralVertexMotion(spec.species, material, motionUniforms);
      }
      materials.push({
        material,
        baseOpacity: material.opacity,
        baseTransparent: material.transparent,
        baseDepthWrite: material.depthWrite,
      });
      return material;
    });
    const firstClone = clones[0];
    if (firstClone === undefined) {
      throw new Error(`Marine-life mesh has no material: ${spec.id}`);
    }
    object.material = Array.isArray(object.material) ? clones : firstClone;
  });
  return materials;
}

function tuneMarineMaterial(
  species: NorthSeaMegafaunaSpecies,
  material: Material,
): void {
  if (
    material instanceof MeshStandardMaterial ||
    material instanceof MeshPhysicalMaterial
  ) {
    material.metalness = Math.min(material.metalness, 0.06);
    material.roughness = MathUtils.clamp(material.roughness, 0.38, 0.82);
    material.envMapIntensity = 0.52;
    if (species === "jellyfish") {
      material.transparent = true;
      material.depthWrite = false;
      material.emissive.set(0x3a1338);
      material.emissiveIntensity = 0.42;
    } else if (species === "seal") {
      material.color.set(0x665f58);
      material.roughness = 0.76;
    }
  }
}

function addProceduralVertexMotion(
  species: NorthSeaMegafaunaSpecies,
  material: Material,
  motionUniforms: MotionUniform[],
): void {
  const time: MotionUniform = { value: 0 };
  motionUniforms.push(time);
  material.onBeforeCompile = (shader) => {
    shader.uniforms["marineMotionTime"] = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float marineMotionTime;`,
      )
      .replace("#include <begin_vertex>", proceduralBeginVertex(species));
  };
  material.customProgramCacheKey = () =>
    `akula-north-sea-${species}-procedural-v1`;
  material.needsUpdate = true;
}

function proceduralBeginVertex(species: NorthSeaMegafaunaSpecies): string {
  if (species === "orca") {
    return `vec3 transformed = vec3(position);
float marineTailMask = smoothstep(0.15, 2.65, -position.z);
transformed.x += sin(marineMotionTime * 2.25 - position.z * 0.9)
  * marineTailMask * 0.105;`;
  }
  if (species === "harbour-porpoise") {
    return `vec3 transformed = vec3(position);
float marineTailMask = smoothstep(0.0, 1.0, (-position.y + 6.0) / 48.0);
transformed.x += sin(marineMotionTime * 2.8 - position.y * 0.055)
  * marineTailMask * 1.15;`;
  }
  if (species === "jellyfish") {
    return `vec3 transformed = vec3(position);
float marinePulse = sin(marineMotionTime * 1.34);
float marineBellMask = smoothstep(-0.35, 0.62, position.z);
float marineTentacleMask = smoothstep(0.0, 4.4, -position.z);
transformed.xy *= 1.0 + marinePulse * (0.025 + marineBellMask * 0.07);
transformed.x += sin(marineMotionTime * 0.92 + position.z * 1.9)
  * marineTentacleMask * 0.025;`;
  }
  return "#include <begin_vertex>";
}

function preferredAnimationClip(
  animations: readonly AnimationClip[],
  preferredName: string | undefined,
): AnimationClip | undefined {
  if (preferredName !== undefined) {
    const preferred = animations.find(
      (clip) => clip.name.toLowerCase() === preferredName.toLowerCase(),
    );
    if (preferred !== undefined) {
      return preferred;
    }
  }
  return animations[0];
}

function updateMaterialVisibility(
  materials: readonly AnimatedMaterial[],
  environmentAmount: number,
): void {
  const fade = smoothstep(0.03, 0.34, environmentAmount);
  for (const entry of materials) {
    const transparent = entry.baseTransparent || fade < 0.999;
    if (entry.material.transparent !== transparent) {
      entry.material.transparent = transparent;
      entry.material.needsUpdate = true;
    }
    entry.material.opacity = entry.baseOpacity * fade;
    entry.material.depthWrite =
      entry.baseDepthWrite && fade > 0.22 && !entry.baseTransparent;
  }
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
}
