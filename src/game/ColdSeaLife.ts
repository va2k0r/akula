import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  MathUtils,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Points,
  Quaternion,
  SRGBColorSpace,
  ShaderMaterial,
  TextureLoader,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type Camera,
  type Object3D,
} from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  propulsionStartleStrength,
  type MarineLifeDisturbanceState,
} from "./MarineLifeDisturbance";
import { channelWallAt, terrainHeightAt } from "./WorldGeometry";

interface FishSchoolSpec {
  readonly count: number;
  readonly species: 0 | 1 | 2 | 3;
  readonly minimumLength: number;
  readonly maximumLength: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly radiusZ: number;
  readonly pathX: number;
  readonly pathZ: number;
  readonly phase: number;
}

interface FishSeed {
  readonly schoolIndex: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly offsetZ: number;
  readonly phase: number;
  readonly scale: number;
  readonly species: 0 | 1 | 2 | 3;
  readonly brightness: number;
}

interface CoralPlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly height: number;
  readonly widthScale: number;
  readonly color: number;
}

const FISH_FORWARD = new Vector3(0, 0, 1);
const WORLD_UP = new Vector3(0, 1, 0);
const FISH_ATLAS_PATH = "/assets/textures/fauna/north-atlantic-fish-atlas.png";
const FISH_DETAIL_FADE_START_METERS = 10;
const FISH_DETAIL_FADE_END_METERS = 24;
const FISH_RESTART_STARTLE_RADIUS_METERS = 92;
const FISH_RUNNING_AVOIDANCE_RADIUS_METERS = 54;
const FISH_MAX_STARTLE_SPEED_METERS_PER_SECOND = 14;
const FISH_MAX_ESCAPE_SPEED_METERS_PER_SECOND = 16;
const FISH_ESCAPE_VELOCITY_DAMPING = 0.48;
const CORAL_MODEL_PATH = "/assets/models/lophelia/lophelia-20k.glb";
const DRACO_DECODER_PATH = "/assets/draco/";
const PLANKTON_PER_COLONY = 12;

/**
 * Sparse placements intentionally cross the usual chase-camera corridor.
 * They are not a camera-following particle effect: a school can be found,
 * left behind, and encountered again after circling the canyon.
 */
const FISH_SCHOOLS: readonly FishSchoolSpec[] = Object.freeze([
  {
    count: 760,
    species: 0,
    minimumLength: 0.32,
    maximumLength: 0.46,
    x: 8,
    y: -78,
    z: -90,
    radiusX: 30,
    radiusY: 10,
    radiusZ: 54,
    pathX: 62,
    pathZ: 88,
    phase: 0.2,
  },
  {
    count: 680,
    species: 1,
    minimumLength: 0.34,
    maximumLength: 0.52,
    x: -12,
    y: -136,
    z: 302,
    radiusX: 38,
    radiusY: 12,
    radiusZ: 68,
    pathX: 74,
    pathZ: 96,
    phase: 1.7,
  },
  {
    count: 420,
    species: 2,
    minimumLength: 0.52,
    maximumLength: 0.84,
    x: -520,
    y: -49,
    z: 390,
    radiusX: 64,
    radiusY: 13,
    radiusZ: 82,
    pathX: 94,
    pathZ: 116,
    phase: 3.1,
  },
  {
    count: 720,
    species: 1,
    minimumLength: 0.33,
    maximumLength: 0.5,
    x: 525,
    y: -66,
    z: 92,
    radiusX: 55,
    radiusY: 15,
    radiusZ: 88,
    pathX: 104,
    pathZ: 128,
    phase: 4.4,
  },
  {
    count: 240,
    species: 3,
    minimumLength: 0.48,
    maximumLength: 0.88,
    x: 44,
    y: -48,
    z: 1_030,
    radiusX: 82,
    radiusY: 18,
    radiusZ: 138,
    pathX: 132,
    pathZ: 164,
    phase: 5.6,
  },
]);

export const COLD_SEA_FISH_COUNT = FISH_SCHOOLS.reduce(
  (total, school) => total + school.count,
  0,
);

export function fishSpriteDetailAmountAtDistance(
  cameraDistanceMeters: number,
): number {
  return (
    1 -
    smoothstep(
      FISH_DETAIL_FADE_START_METERS,
      FISH_DETAIL_FADE_END_METERS,
      cameraDistanceMeters,
    )
  );
}

export function fishPropulsionStartleSpeed(
  distanceMeters: number,
  propulsionIntensity: number,
): number {
  return (
    FISH_MAX_STARTLE_SPEED_METERS_PER_SECOND *
    propulsionStartleStrength(
      distanceMeters,
      FISH_RESTART_STARTLE_RADIUS_METERS,
      propulsionIntensity,
    )
  );
}

/** Schools tighten during the strongest route turns, then breathe open again. */
export function fishSchoolCompressionAt(
  schoolIndex: number,
  elapsedSeconds: number,
): number {
  const school = FISH_SCHOOLS[schoolIndex];
  if (school === undefined) {
    return 0;
  }
  const pathTime = elapsedSeconds * (0.028 + schoolIndex * 0.0025);
  const pathAngle = pathTime + school.phase;
  const turnPressure = Math.abs(Math.sin(pathAngle * 0.7));
  const collectivePulse =
    0.5 + Math.sin(elapsedSeconds * 0.055 + school.phase * 2.1) * 0.5;
  return MathUtils.clamp(turnPressure * 0.72 + collectivePulse * 0.18, 0, 1);
}

export function demersalFishHeightAt(
  x: number,
  z: number,
  verticalOffset: number,
  swimPhase: number,
): number {
  return (
    terrainHeightAt(x, z) +
    2.8 +
    Math.abs(verticalOffset) * 0.24 +
    Math.sin(swimPhase) * 0.55
  );
}

const CORAL_PATCHES = Object.freeze([
  { z: 235, side: -1, count: 7, length: 190 },
  { z: 120, side: 1, count: 6, length: 160 },
  { z: -680, side: -1, count: 8, length: 260 },
  { z: 900, side: 1, count: 7, length: 220 },
] as const);

/**
 * A cold sea reads as alive through brief, localized encounters rather than a
 * uniform aquarium layer. Thousands of distance-graded fish sprites remain
 * one instanced draw call; the benthic colonies use a real CC0 cold-water
 * coral scan.
 */
export class ColdSeaLife {
  public readonly root = new Group();
  private readonly fishSeeds = createFishSeeds();
  private readonly plankton = createBioluminescentPlankton();
  private readonly fishGeometry = createRealisticFishSpriteGeometryFor(
    this.fishSeeds,
  );
  private readonly fishMaterial = createRealisticFishSpriteMaterial();
  private readonly fish = new Mesh(this.fishGeometry, this.fishMaterial);
  private readonly fishPositions = requireInstancedAttribute(
    this.fishGeometry,
    "aWorldPosition",
  );
  private readonly fishHeadings = requireInstancedAttribute(
    this.fishGeometry,
    "aHeading",
  );
  private readonly fishEscapeOffsets = new Float32Array(
    this.fishSeeds.length * 3,
  );
  private readonly fishEscapeVelocities = new Float32Array(
    this.fishSeeds.length * 3,
  );
  private fishAtlasReady = false;
  private coral:
    InstancedMesh<BufferGeometry, MeshStandardMaterial> | undefined;
  private coralMaterial: MeshStandardMaterial | undefined;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly futurePosition = new Vector3();
  private readonly direction = new Vector3();
  private readonly awayFromCamera = new Vector3();
  private readonly awayFromVessel = new Vector3();
  private readonly orientation = new Quaternion();
  private readonly scale = new Vector3();

  public constructor() {
    this.root.name = "cold-sea-life";
    this.fish.name = "cold-sea-fish-schools";
    this.fish.frustumCulled = false;
    this.root.add(this.fish, this.plankton);
  }

  public async initialize(): Promise<void> {
    await Promise.all([this.initializeFishAtlas(), this.initializeCoral()]);
  }

  private async initializeFishAtlas(): Promise<void> {
    const atlas = await new TextureLoader().loadAsync(FISH_ATLAS_PATH);
    atlas.name = "realistic North Atlantic fish sprite atlas";
    atlas.colorSpace = SRGBColorSpace;
    atlas.wrapS = ClampToEdgeWrapping;
    atlas.wrapT = ClampToEdgeWrapping;
    atlas.magFilter = LinearFilter;
    atlas.minFilter = LinearMipmapLinearFilter;
    atlas.generateMipmaps = true;
    atlas.anisotropy = 4;
    atlas.needsUpdate = true;
    requireUniform(this.fishMaterial, "uAtlas").value = atlas;
    this.fishAtlasReady = true;
  }

  private async initializeCoral(): Promise<void> {
    const draco = new DRACOLoader();
    draco.setDecoderPath(DRACO_DECODER_PATH);
    draco.preload();
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);

    try {
      const gltf = await loader.loadAsync(CORAL_MODEL_PATH);
      gltf.scene.updateMatrixWorld(true);
      const source = firstMeshIn(gltf.scene);
      if (source === undefined) {
        return;
      }

      const sourceMaterial = Array.isArray(source.material)
        ? source.material[0]
        : source.material;
      const geometry = source.geometry.clone();
      geometry.applyMatrix4(source.matrixWorld);
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox;
      if (bounds === null) {
        geometry.dispose();
        return;
      }
      const sourceHeight = bounds.max.y - bounds.min.y;
      if (sourceHeight <= 0) {
        geometry.dispose();
        return;
      }
      const centerX = (bounds.min.x + bounds.max.x) * 0.5;
      const centerZ = (bounds.min.z + bounds.max.z) * 0.5;
      geometry.translate(-centerX, -bounds.min.y, -centerZ);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();

      const material =
        sourceMaterial instanceof MeshStandardMaterial
          ? sourceMaterial.clone()
          : new MeshStandardMaterial();
      material.name = "Smithsonian Lophelia cold-water coral";
      material.color.set(0xe3dfcf);
      material.emissive.set(0x07110f);
      material.emissiveIntensity = 0.26;
      material.roughness = 0.84;
      material.metalness = 0;
      material.transparent = false;
      material.depthWrite = true;

      const placements = createCoralPlacements();
      const coral = new InstancedMesh(geometry, material, placements.length);
      coral.name = "lophelia-coral-patches";
      coral.castShadow = true;
      coral.receiveShadow = true;
      const color = new Color();
      for (const [index, placement] of placements.entries()) {
        this.position.set(placement.x, placement.y, placement.z);
        this.orientation.setFromAxisAngle(WORLD_UP, placement.yaw);
        const uniformScale = placement.height / sourceHeight;
        this.scale.set(
          uniformScale * placement.widthScale,
          uniformScale,
          uniformScale / placement.widthScale,
        );
        this.matrix.compose(this.position, this.orientation, this.scale);
        coral.setMatrixAt(index, this.matrix);
        coral.setColorAt(index, color.setHex(placement.color));
      }
      coral.instanceMatrix.needsUpdate = true;
      if (coral.instanceColor !== null) {
        coral.instanceColor.needsUpdate = true;
      }
      coral.computeBoundingSphere();
      this.coral = coral;
      this.coralMaterial = material;
      this.root.add(coral);
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
    this.updateFish(
      elapsedSeconds,
      deltaSeconds,
      camera,
      environmentAmount,
      disturbance,
    );
    this.updatePlankton(elapsedSeconds, camera, environmentAmount);

    const coral = this.coral;
    const material = this.coralMaterial;
    if (coral !== undefined && material !== undefined) {
      coral.visible = environmentAmount > 0.01;
      const opacity = smoothstep(0.03, 0.34, environmentAmount);
      const transparent = opacity < 0.999;
      if (material.transparent !== transparent) {
        material.transparent = transparent;
        material.needsUpdate = true;
      }
      material.opacity = opacity;
      material.depthWrite = opacity > 0.22;
    }
  }

  private updatePlankton(
    elapsedSeconds: number,
    camera: Camera,
    environmentAmount: number,
  ): void {
    this.plankton.visible = environmentAmount > 0.015;
    if (!this.plankton.visible) {
      return;
    }
    requireUniform(this.plankton.material, "uTime").value = elapsedSeconds;
    const cameraPosition = requireUniform(
      this.plankton.material,
      "uCameraPosition",
    ).value;
    if (cameraPosition instanceof Vector3) {
      cameraPosition.copy(camera.position);
    }
    requireUniform(this.plankton.material, "uEnvironment").value =
      environmentAmount;
  }

  private updateFish(
    elapsedSeconds: number,
    deltaSeconds: number,
    camera: Camera,
    environmentAmount: number,
    disturbance: MarineLifeDisturbanceState,
  ): void {
    this.fish.visible = this.fishAtlasReady && environmentAmount > 0.015;
    requireUniform(this.fishMaterial, "uTime").value = elapsedSeconds;
    requireUniform(this.fishMaterial, "uEnvironment").value = environmentAmount;

    for (const [index, seed] of this.fishSeeds.entries()) {
      fishPositionAt(seed, elapsedSeconds, this.position);
      fishPositionAt(seed, elapsedSeconds + 0.18, this.futurePosition);

      const offsetIndex = index * 3;
      const previousOffsetX = this.fishEscapeOffsets[offsetIndex] ?? 0;
      const previousOffsetY = this.fishEscapeOffsets[offsetIndex + 1] ?? 0;
      const previousOffsetZ = this.fishEscapeOffsets[offsetIndex + 2] ?? 0;
      let velocityX = this.fishEscapeVelocities[offsetIndex] ?? 0;
      let velocityY = this.fishEscapeVelocities[offsetIndex + 1] ?? 0;
      let velocityZ = this.fishEscapeVelocities[offsetIndex + 2] ?? 0;
      this.position.add(
        this.awayFromVessel.set(
          previousOffsetX,
          previousOffsetY,
          previousOffsetZ,
        ),
      );

      const vesselDeltaX = this.position.x - disturbance.x;
      const vesselDeltaY = this.position.y - disturbance.y;
      const vesselDeltaZ = this.position.z - disturbance.z;
      const vesselDistance = Math.hypot(
        vesselDeltaX,
        vesselDeltaY,
        vesselDeltaZ,
      );
      this.awayFromVessel.set(
        vesselDeltaX,
        vesselDeltaY * 0.36 + Math.sin(seed.phase * 1.91) * 1.4,
        vesselDeltaZ,
      );
      if (this.awayFromVessel.lengthSq() < 0.0001) {
        this.awayFromVessel.set(
          Math.cos(seed.phase),
          Math.sin(seed.phase * 1.7) * 0.12,
          Math.sin(seed.phase),
        );
      }
      this.awayFromVessel.normalize();

      if (disturbance.propulsionRestarted) {
        const startleSpeed = fishPropulsionStartleSpeed(
          vesselDistance,
          disturbance.propulsionIntensity,
        );
        velocityX += this.awayFromVessel.x * startleSpeed;
        velocityY += this.awayFromVessel.y * startleSpeed;
        velocityZ += this.awayFromVessel.z * startleSpeed;
      }
      if (!disturbance.propulsionStopped) {
        const runningAvoidance = propulsionStartleStrength(
          vesselDistance,
          FISH_RUNNING_AVOIDANCE_RADIUS_METERS,
          disturbance.propulsionIntensity,
        );
        const acceleration = runningAvoidance * 4.8 * deltaSeconds;
        velocityX += this.awayFromVessel.x * acceleration;
        velocityY += this.awayFromVessel.y * acceleration;
        velocityZ += this.awayFromVessel.z * acceleration;
      }

      const escapeSpeed = Math.hypot(velocityX, velocityY, velocityZ);
      if (escapeSpeed > FISH_MAX_ESCAPE_SPEED_METERS_PER_SECOND) {
        const limit = FISH_MAX_ESCAPE_SPEED_METERS_PER_SECOND / escapeSpeed;
        velocityX *= limit;
        velocityY *= limit;
        velocityZ *= limit;
      }
      const velocityDamping = Math.exp(
        -deltaSeconds * FISH_ESCAPE_VELOCITY_DAMPING,
      );
      velocityX *= velocityDamping;
      velocityY *= velocityDamping;
      velocityZ *= velocityDamping;
      const offsetRecovery = Math.exp(
        -deltaSeconds * (disturbance.propulsionStopped ? 0.075 : 0.012),
      );
      const offsetX =
        (previousOffsetX + velocityX * deltaSeconds) * offsetRecovery;
      const offsetY =
        (previousOffsetY + velocityY * deltaSeconds) * offsetRecovery;
      const offsetZ =
        (previousOffsetZ + velocityZ * deltaSeconds) * offsetRecovery;
      this.fishEscapeOffsets[offsetIndex] = offsetX;
      this.fishEscapeOffsets[offsetIndex + 1] = offsetY;
      this.fishEscapeOffsets[offsetIndex + 2] = offsetZ;
      this.fishEscapeVelocities[offsetIndex] = velocityX;
      this.fishEscapeVelocities[offsetIndex + 1] = velocityY;
      this.fishEscapeVelocities[offsetIndex + 2] = velocityZ;

      this.position.add(
        this.awayFromVessel.set(
          offsetX - previousOffsetX,
          offsetY - previousOffsetY,
          offsetZ - previousOffsetZ,
        ),
      );
      this.futurePosition.add(
        this.awayFromVessel.set(
          offsetX + velocityX * 0.18,
          offsetY + velocityY * 0.18,
          offsetZ + velocityZ * 0.18,
        ),
      );
      this.direction.subVectors(this.futurePosition, this.position);

      this.awayFromCamera.subVectors(this.position, camera.position);
      const cameraDistance = this.awayFromCamera.length();
      if (cameraDistance < 26 && cameraDistance > 0.001) {
        const avoidance = 1 - cameraDistance / 26;
        this.awayFromCamera.multiplyScalar(1 / cameraDistance);
        this.position.addScaledVector(this.awayFromCamera, avoidance * 18);
        this.direction.addScaledVector(
          this.awayFromCamera,
          avoidance * 2.2 * 0.18,
        );
      }

      if (this.direction.lengthSq() < 0.0001) {
        this.direction.copy(FISH_FORWARD);
      } else {
        this.direction.normalize();
      }
      this.fishPositions.setXYZ(
        index,
        this.position.x,
        this.position.y,
        this.position.z,
      );
      this.fishHeadings.setXYZ(
        index,
        this.direction.x,
        this.direction.y,
        this.direction.z,
      );
    }
    this.fishPositions.needsUpdate = true;
    this.fishHeadings.needsUpdate = true;
  }
}

/**
 * Rare blue flashes clustered around benthic habitat. They stand in for the
 * disturbed gelatinous plankton common in the deep pelagic zone, not for a
 * continuously glowing reef.
 */
export function createBioluminescentPlanktonGeometry(): BufferGeometry {
  const colonies = createCoralPlacements();
  const positions = new Float32Array(colonies.length * PLANKTON_PER_COLONY * 3);
  const seeds = new Float32Array(colonies.length * PLANKTON_PER_COLONY);
  let pointIndex = 0;
  for (const [colonyIndex, colony] of colonies.entries()) {
    for (
      let localIndex = 0;
      localIndex < PLANKTON_PER_COLONY;
      localIndex += 1
    ) {
      const seed = colonyIndex * 701 + localIndex * 43 + 11;
      const angle = seededNoise(seed) * Math.PI * 2;
      const radius = 1.2 + Math.sqrt(seededNoise(seed + 1)) * 8.8;
      positions[pointIndex * 3] = colony.x + Math.cos(angle) * radius;
      positions[pointIndex * 3 + 1] =
        colony.y + 2.2 + seededNoise(seed + 2) * 25;
      positions[pointIndex * 3 + 2] = colony.z + Math.sin(angle) * radius;
      seeds[pointIndex] = seededNoise(seed + 3);
      pointIndex += 1;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("aSeed", new BufferAttribute(seeds, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createBioluminescentPlankton(): Points<
  BufferGeometry,
  ShaderMaterial
> {
  const material = new ShaderMaterial({
    name: "localized disturbed cold-sea plankton",
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uTime: { value: 0 },
      uCameraPosition: { value: new Vector3() },
      uEnvironment: { value: 1 },
    },
    vertexShader: `
      uniform float uTime;
      uniform vec3 uCameraPosition;
      uniform float uEnvironment;
      attribute float aSeed;
      varying float vGlow;

      void main() {
        vec3 drifted = position;
        drifted.x += sin(uTime * 0.13 + aSeed * 51.0) * 0.8;
        drifted.y += sin(uTime * 0.09 + aSeed * 73.0) * 1.25;
        drifted.z += cos(uTime * 0.11 + aSeed * 39.0) * 0.8;
        vec3 worldPosition = (modelMatrix * vec4(drifted, 1.0)).xyz;
        float cameraDistance = distance(worldPosition, uCameraPosition);
        float encounter = 1.0 - smoothstep(18.0, 125.0, cameraDistance);
        float sporadic = pow(
          max(0.0, sin(uTime * (0.48 + aSeed * 0.9) + aSeed * 81.0)),
          10.0
        );
        vGlow = encounter * uEnvironment * (0.055 + sporadic * 1.3);
        vec4 viewPosition = viewMatrix * vec4(worldPosition, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = clamp(
          (2.4 + sporadic * 11.5) * 92.0 / max(-viewPosition.z, 11.0),
          1.2,
          12.0
        );
      }
    `,
    fragmentShader: `
      varying float vGlow;

      void main() {
        float radius = length(gl_PointCoord - 0.5) * 2.0;
        float core = 1.0 - smoothstep(0.08, 0.72, radius);
        float halo = 1.0 - smoothstep(0.0, 1.0, radius);
        float alpha = (core * 0.74 + halo * 0.22) * vGlow;
        if (alpha < 0.012) discard;
        vec3 color = mix(
          vec3(0.12, 0.62, 0.68),
          vec3(0.62, 0.94, 0.92),
          core
        );
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
  const points = new Points(createBioluminescentPlanktonGeometry(), material);
  points.name = "localized-bioluminescent-plankton";
  points.frustumCulled = false;
  return points;
}

/**
 * Twelve horizontal segments let the photographic sprite undulate from the
 * peduncle through the caudal fin without introducing one mesh or one draw
 * call per animal.
 */
export function createRealisticFishSpriteGeometry(): InstancedBufferGeometry {
  return createRealisticFishSpriteGeometryFor(createFishSeeds());
}

function createRealisticFishSpriteGeometryFor(
  seeds: readonly FishSeed[],
): InstancedBufferGeometry {
  const horizontalSegments = 12;
  const vertexCount = (horizontalSegments + 1) * 2;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint16Array(horizontalSegments * 6);

  for (let column = 0; column <= horizontalSegments; column += 1) {
    const x = column / horizontalSegments;
    for (let row = 0; row < 2; row += 1) {
      const vertexIndex = column * 2 + row;
      positions[vertexIndex * 3] = x - 0.5;
      positions[vertexIndex * 3 + 1] = row - 0.5;
      positions[vertexIndex * 3 + 2] = 0;
      uvs[vertexIndex * 2] = x;
      uvs[vertexIndex * 2 + 1] = row;
    }
  }
  for (let segment = 0; segment < horizontalSegments; segment += 1) {
    const lowerLeft = segment * 2;
    const upperLeft = lowerLeft + 1;
    const lowerRight = lowerLeft + 2;
    const upperRight = lowerLeft + 3;
    const indexOffset = segment * 6;
    indices[indexOffset] = lowerLeft;
    indices[indexOffset + 1] = lowerRight;
    indices[indexOffset + 2] = upperLeft;
    indices[indexOffset + 3] = lowerRight;
    indices[indexOffset + 4] = upperRight;
    indices[indexOffset + 5] = upperLeft;
  }

  const worldPositions = new Float32Array(seeds.length * 3);
  const headings = new Float32Array(seeds.length * 3);
  const scales = new Float32Array(seeds.length);
  const species = new Float32Array(seeds.length);
  const phases = new Float32Array(seeds.length);
  const brightness = new Float32Array(seeds.length);
  const position = new Vector3();
  const futurePosition = new Vector3();
  const heading = new Vector3();
  for (const [index, seed] of seeds.entries()) {
    fishPositionAt(seed, 0, position);
    fishPositionAt(seed, 0.18, futurePosition);
    heading.subVectors(futurePosition, position).normalize();
    if (heading.lengthSq() < 0.0001) {
      heading.copy(FISH_FORWARD);
    }
    worldPositions.set(position.toArray(), index * 3);
    headings.set(heading.toArray(), index * 3);
    scales[index] = seed.scale;
    species[index] = seed.species;
    phases[index] = seed.phase;
    brightness[index] = seed.brightness;
  }

  const geometry = new InstancedBufferGeometry();
  geometry.name = "realistic cold-water fish sprite geometry";
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setAttribute(
    "aWorldPosition",
    new InstancedBufferAttribute(worldPositions, 3).setUsage(DynamicDrawUsage),
  );
  geometry.setAttribute(
    "aHeading",
    new InstancedBufferAttribute(headings, 3).setUsage(DynamicDrawUsage),
  );
  geometry.setAttribute("aScale", new InstancedBufferAttribute(scales, 1));
  geometry.setAttribute("aSpecies", new InstancedBufferAttribute(species, 1));
  geometry.setAttribute("aPhase", new InstancedBufferAttribute(phases, 1));
  geometry.setAttribute(
    "aBrightness",
    new InstancedBufferAttribute(brightness, 1),
  );
  geometry.instanceCount = seeds.length;
  return geometry;
}

function createRealisticFishSpriteMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: "distance-graded North Atlantic fish sprites",
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        uAtlas: { value: null },
        uTime: { value: 0 },
        uEnvironment: { value: 1 },
      },
    ]),
    vertexShader: `
      #include <fog_pars_vertex>

      uniform float uTime;
      uniform float uEnvironment;
      attribute vec3 aWorldPosition;
      attribute vec3 aHeading;
      attribute float aScale;
      attribute float aSpecies;
      attribute float aPhase;
      attribute float aBrightness;
      varying vec2 vUv;
      varying float vSpecies;
      varying float vBrightness;
      varying float vSwimLight;
      varying float vCameraDistance;

      void main() {
        vec4 worldCenter = modelMatrix * vec4(aWorldPosition, 1.0);
        vec4 mvPosition = viewMatrix * worldCenter;
        vec3 viewHeading = normalize(mat3(modelViewMatrix) * aHeading);
        float projectedLength = length(viewHeading.xy);
        vec2 projectedHeading = projectedLength > 0.025
          ? viewHeading.xy / projectedLength
          : vec2(cos(aPhase), sin(aPhase));
        vec2 projectedUp = vec2(-projectedHeading.y, projectedHeading.x);

        float speciesRate = aSpecies < 0.5
          ? 6.8
          : aSpecies < 1.5
            ? 7.4
            : aSpecies < 2.5
              ? 5.3
              : 4.6;
        float rateVariation = fract(sin(aPhase * 12.9898) * 43758.5453);
        float swimRate = speciesRate * mix(0.86, 1.14, rateVariation);
        float bodyPosition = position.x + 0.5;
        float caudalWeight = pow(1.0 - bodyPosition, 1.62);
        float swimCycle = uTime * swimRate + aPhase;
        float primaryWave = sin(swimCycle - bodyPosition * 5.2);
        float secondaryWave = sin(
          swimCycle * 0.53 + aPhase * 1.7 - bodyPosition * 7.1
        );
        float bodyFlex = (primaryWave + secondaryWave * 0.18)
          * caudalWeight * 0.13;
        float bodySway = sin(swimCycle * 0.5 + aPhase)
          * caudalWeight * 0.018;
        float cameraDistance = length(mvPosition.xyz);
        float distanceScale = max(
          0.001,
          1.0 - smoothstep(105.0, 235.0, cameraDistance)
        );
        float visibleScale = aScale * uEnvironment * distanceScale;
        vec2 billboardOffset =
          projectedHeading * (position.x * visibleScale)
          + projectedUp * (
            position.y * visibleScale / 1.5
            + (bodyFlex + bodySway) * visibleScale
          );
        mvPosition.xy += billboardOffset;

        gl_Position = projectionMatrix * mvPosition;
        vUv = uv;
        vSpecies = aSpecies;
        vBrightness = aBrightness;
        vSwimLight = 0.97 + sin(uTime * 0.78 + aPhase * 1.31) * 0.03;
        vCameraDistance = cameraDistance;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      #include <fog_pars_fragment>

      uniform sampler2D uAtlas;
      varying vec2 vUv;
      varying float vSpecies;
      varying float vBrightness;
      varying float vSwimLight;
      varying float vCameraDistance;

      void main() {
        float species = floor(vSpecies + 0.5);
        float column = mod(species, 2.0);
        float atlasRow = 1.0 - floor(species * 0.5);
        vec2 atlasUv = vec2(
          (vUv.x + column) * 0.5,
          (vUv.y + atlasRow) * 0.5
        );
        vec4 fish = texture2D(uAtlas, atlasUv);
        if (fish.a < 0.12) discard;

        vec3 dorsalColor = vec3(0.25, 0.38, 0.4);
        vec3 ventralColor = vec3(0.53, 0.63, 0.63);
        if (species > 0.5 && species < 1.5) {
          dorsalColor = vec3(0.2, 0.36, 0.39);
          ventralColor = vec3(0.48, 0.6, 0.61);
        } else if (species > 1.5 && species < 2.5) {
          dorsalColor = vec3(0.2, 0.27, 0.28);
          ventralColor = vec3(0.42, 0.5, 0.5);
        } else if (species > 2.5) {
          dorsalColor = vec3(0.3, 0.3, 0.23);
          ventralColor = vec3(0.5, 0.5, 0.41);
        }
        float flankGradient = smoothstep(0.2, 0.78, vUv.y);
        vec3 silhouetteColor = mix(
          ventralColor,
          dorsalColor,
          flankGradient
        );
        float restrainedFlank = exp(-pow((vUv.y - 0.46) * 5.2, 2.0));
        silhouetteColor += vec3(0.035, 0.045, 0.045) * restrainedFlank;

        vec3 photographicColor = fish.rgb;
        float detailAmount = 1.0 - smoothstep(
          ${FISH_DETAIL_FADE_START_METERS.toFixed(1)},
          ${FISH_DETAIL_FADE_END_METERS.toFixed(1)},
          vCameraDistance
        );
        vec3 naturalColor = mix(
          silhouetteColor,
          photographicColor,
          detailAmount
        ) * vBrightness * vSwimLight;
        gl_FragColor = vec4(naturalColor, 1.0);
        #include <fog_fragment>
      }
    `,
    fog: true,
    transparent: false,
    depthTest: true,
    depthWrite: true,
  });
}

function createFishSeeds(): readonly FishSeed[] {
  const seeds: FishSeed[] = [];
  for (const [schoolIndex, school] of FISH_SCHOOLS.entries()) {
    for (let index = 0; index < school.count; index += 1) {
      const seed = schoolIndex * 100_003 + index * 37;
      const angle = seededNoise(seed + 1) * Math.PI * 2;
      const radius = Math.pow(seededNoise(seed + 2), 0.86);
      const centeredY =
        (seededNoise(seed + 3) +
          seededNoise(seed + 13) +
          seededNoise(seed + 23)) /
          3 -
        0.5;
      seeds.push({
        schoolIndex,
        offsetX: Math.cos(angle) * school.radiusX * radius,
        offsetY: centeredY * school.radiusY * 2.35,
        offsetZ: Math.sin(angle) * school.radiusZ * radius,
        phase: seededNoise(seed + 4) * Math.PI * 2,
        scale: MathUtils.lerp(
          school.minimumLength,
          school.maximumLength,
          seededNoise(seed + 5),
        ),
        species: school.species,
        brightness: 0.78 + seededNoise(seed + 6) * 0.24,
      });
    }
  }
  return seeds;
}

function fishPositionAt(
  seed: FishSeed,
  elapsedSeconds: number,
  target: Vector3,
): Vector3 {
  const school = FISH_SCHOOLS[seed.schoolIndex];
  if (school === undefined) {
    return target.set(0, -80, 0);
  }
  const pathTime = elapsedSeconds * (0.028 + seed.schoolIndex * 0.0025);
  const pathAngle = pathTime + school.phase;
  const centerX = school.x + Math.sin(pathAngle) * school.pathX;
  const centerZ = school.z + Math.cos(pathAngle * 0.83) * school.pathZ;
  const schoolTurn = pathAngle * 0.54 + Math.sin(pathAngle * 0.7) * 0.32;
  const cosine = Math.cos(schoolTurn);
  const sine = Math.sin(schoolTurn);
  const compression = fishSchoolCompressionAt(seed.schoolIndex, elapsedSeconds);
  const lateralCompression = MathUtils.lerp(1, 0.54, compression);
  const longitudinalCompression = MathUtils.lerp(1, 0.72, compression);
  const compressedX = seed.offsetX * lateralCompression;
  const compressedZ = seed.offsetZ * longitudinalCompression;
  const offsetX = compressedX * cosine - compressedZ * sine;
  const offsetZ = compressedX * sine + compressedZ * cosine;
  const individualSurge = Math.sin(elapsedSeconds * 0.37 + seed.phase) * 2.4;

  const x = centerX + offsetX + Math.sin(schoolTurn) * individualSurge;
  const z = centerZ + offsetZ - Math.cos(schoolTurn) * individualSurge;
  const pelagicY =
    school.y +
    seed.offsetY * MathUtils.lerp(1, 0.68, compression) +
    Math.sin(elapsedSeconds * 0.21 + seed.phase * 1.7) * 1.7;
  const demersalY = demersalFishHeightAt(
    x,
    z,
    seed.offsetY,
    elapsedSeconds * 0.16 + seed.phase,
  );

  return target.set(x, seed.species === 3 ? demersalY : pelagicY, z);
}

function createCoralPlacements(): readonly CoralPlacement[] {
  const placements: CoralPlacement[] = [];
  let index = 0;
  for (const patch of CORAL_PATCHES) {
    for (let localIndex = 0; localIndex < patch.count; localIndex += 1) {
      const seed = index * 53 + 17;
      const z = patch.z + (seededNoise(seed + 1) - 0.5) * patch.length;
      // Follow the steep survey-derived channel margin, then step inward so
      // the sparse photogrammetry outcrops cannot physically bury a colony.
      const wallX = channelWallAt(z, patch.side);
      const x = wallX - patch.side * (52 + seededNoise(seed + 2) * 74);
      placements.push({
        x,
        y: terrainHeightAt(x, z) - 0.35,
        z,
        yaw: seededNoise(seed + 3) * Math.PI * 2,
        height: 2.2 + seededNoise(seed + 4) * 4.8,
        widthScale: 0.74 + seededNoise(seed + 5) * 0.54,
        color: [0xc8c4b5, 0xd6b89b, 0xb4b7ac][index % 3] ?? 0xc8c4b5,
      });
      index += 1;
    }
  }
  return placements;
}

function firstMeshIn(root: Object3D): Mesh | undefined {
  let result: Mesh | undefined;
  root.traverse((object) => {
    if (result === undefined && object instanceof Mesh) {
      result = object;
    }
  });
  return result;
}

function seededNoise(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43_758.5453;
  return value - Math.floor(value);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) {
    return value < edge0 ? 0 : 1;
  }
  const normalized = MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function requireInstancedAttribute(
  geometry: InstancedBufferGeometry,
  name: string,
): InstancedBufferAttribute {
  const attribute = geometry.getAttribute(name);
  if (!(attribute instanceof InstancedBufferAttribute)) {
    throw new Error(`Missing cold-sea-life instanced attribute: ${name}`);
  }
  return attribute;
}

function requireUniform(
  material: ShaderMaterial,
  name: string,
): { value: unknown } {
  const uniform = material.uniforms[name];
  if (uniform === undefined) {
    throw new Error(`Missing cold-sea-life shader uniform: ${name}`);
  }
  return uniform;
}
