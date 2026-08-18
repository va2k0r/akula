import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  Quaternion,
  ShaderMaterial,
  TubeGeometry,
  Uniform,
  Vector3,
  type Camera,
  type Material,
} from "three";
import type { NorthSeaEnvironmentState } from "./NorthSeaEnvironment";
import { NORTH_SEA_RIG_POSITION } from "./NorthSeaSurfaceActivity";
import {
  MAP_HALF_LENGTH,
  MAP_HALF_WIDTH,
  terrainHeightAt,
} from "./WorldGeometry";

export interface NorthSeaWreckPlacement {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly lengthMeters: number;
  readonly kind: "freighter" | "trawler" | "patrol-craft";
}

export interface NorthSeaKelpPlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly height: number;
}

export const NORTH_SEA_WRECKS: readonly NorthSeaWreckPlacement[] =
  Object.freeze([
    {
      id: "wreck-nordhavet-freighter",
      x: -820,
      z: 1_680,
      yaw: 0.42,
      lengthMeters: 82,
      kind: "freighter",
    },
    {
      id: "wreck-fishing-bank-trawler",
      x: -2_720,
      z: 620,
      yaw: -0.88,
      lengthMeters: 31,
      kind: "trawler",
    },
    {
      id: "wreck-cold-war-patrol-craft",
      x: 1_020,
      z: -2_160,
      yaw: 1.12,
      lengthMeters: 48,
      kind: "patrol-craft",
    },
  ]);

export const NORTH_SEA_KELP_PLACEMENTS: readonly NorthSeaKelpPlacement[] =
  Object.freeze(createKelpPlacements());

export function northSeaWreckSuspensionAt(
  x: number,
  y: number,
  z: number,
): number {
  let suspension = 0;
  for (const wreck of NORTH_SEA_WRECKS) {
    const horizontal = Math.hypot(x - wreck.x, z - wreck.z);
    const vertical = Math.abs(y - terrainHeightAt(x, z));
    const horizontalAmount =
      1 - MathUtils.smoothstep(horizontal, wreck.lengthMeters * 0.5, 145);
    const verticalAmount = 1 - MathUtils.smoothstep(vertical, 4, 54);
    suspension = Math.max(suspension, horizontalAmount * verticalAmount);
  }
  return MathUtils.clamp(suspension, 0, 1);
}

/**
 * The benthic layer makes the seafloor navigable geography: wreck fields,
 * ghost gear and the rig export corridor all occupy real MAREANO heights.
 */
export class NorthSeaBenthicWorld {
  public readonly root = new Group();
  private readonly physicalRoot = new Group();
  private readonly chartRoot = new Group();
  private readonly kelp: InstancedMesh<BufferGeometry, MeshStandardMaterial>;
  private readonly kelpTime = new Uniform(0);
  private readonly sediment = createSedimentClouds();
  private readonly physicalMaterials = new Set<Material>();
  private readonly chartMaterial = new LineBasicMaterial({
    color: 0xa8b891,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
  });
  private tacticalAmount = 0;

  public constructor() {
    this.root.name = "north-sea-benthic-geography";
    this.physicalRoot.name = "wrecks-ghost-gear-pipelines-kelp";
    this.chartRoot.name = "charted-seabed-infrastructure";
    this.root.add(this.physicalRoot, this.chartRoot, this.sediment);
    this.createWrecks();
    this.createInfrastructure();
    this.kelp = this.createKelp();
    this.physicalRoot.add(this.kelp);
    this.createChartOverlay();
  }

  public update(
    elapsedSeconds: number,
    camera: Camera,
    environment: NorthSeaEnvironmentState,
    underwaterAmount: number,
  ): void {
    const physicalAmount =
      underwaterAmount *
      (1 - MathUtils.smoothstep(this.tacticalAmount, 0.08, 0.76));
    this.physicalRoot.visible = physicalAmount > 0.008;
    for (const material of this.physicalMaterials) {
      material.transparent = physicalAmount < 0.999;
      material.opacity = physicalAmount;
      material.depthWrite = physicalAmount > 0.25;
    }
    this.kelpTime.value = elapsedSeconds;

    const sedimentMaterial = this.sediment.material;
    requireUniform(sedimentMaterial, "uTime").value = elapsedSeconds;
    const cameraPosition = requireUniform(
      sedimentMaterial,
      "uCameraPosition",
    ).value;
    if (cameraPosition instanceof Vector3) {
      cameraPosition.copy(camera.position);
    }
    requireUniform(sedimentMaterial, "uOpacity").value =
      physicalAmount *
      (0.28 +
        environment.surfaceSuspension * 0.22 +
        northSeaWreckSuspensionAt(
          camera.position.x,
          camera.position.y,
          camera.position.z,
        ) *
          0.64);
    this.sediment.visible = physicalAmount > 0.015;

    const chartAmount = MathUtils.smoothstep(this.tacticalAmount, 0.26, 0.78);
    this.chartRoot.visible = chartAmount > 0.002;
    this.chartMaterial.opacity = chartAmount * 0.72;
  }

  public setTacticalView(amount: number): void {
    this.tacticalAmount = MathUtils.clamp(amount, 0, 1);
  }

  public dispose(): void {
    this.root.traverse((object) => {
      if (
        object instanceof Mesh ||
        object instanceof Points ||
        object instanceof LineSegments
      ) {
        object.geometry.dispose();
        disposeMaterial(object.material);
      }
    });
  }

  private createWrecks(): void {
    const rust = this.track(
      new MeshStandardMaterial({
        color: 0x51453b,
        roughness: 0.96,
        metalness: 0.28,
      }),
    );
    const growth = this.track(
      new MeshStandardMaterial({
        color: 0x556359,
        roughness: 0.92,
        metalness: 0.02,
      }),
    );

    for (const [wreckIndex, placement] of NORTH_SEA_WRECKS.entries()) {
      const wreck = new Group();
      wreck.name = placement.id;
      wreck.position.set(
        placement.x,
        terrainHeightAt(placement.x, placement.z) + 1.2,
        placement.z,
      );
      wreck.rotation.set(0.04, placement.yaw, 0.08 * (wreckIndex - 1));

      const hull = new Mesh(
        new BoxGeometry(
          placement.lengthMeters * 0.28,
          placement.lengthMeters * 0.13,
          placement.lengthMeters,
          2,
          2,
          8,
        ),
        rust,
      );
      hull.position.y = placement.lengthMeters * 0.04;
      hull.rotation.z = 0.06 * (wreckIndex - 1);
      wreck.add(hull);

      for (let rib = 0; rib < 8; rib += 1) {
        const beam = new Mesh(
          new BoxGeometry(
            placement.lengthMeters * 0.34,
            0.7,
            placement.lengthMeters * 0.018,
          ),
          rust,
        );
        beam.position.set(
          Math.sin(rib * 2.3) * placement.lengthMeters * 0.035,
          placement.lengthMeters * (0.1 + (rib % 3) * 0.025),
          (rib / 7 - 0.5) * placement.lengthMeters * 0.86,
        );
        beam.rotation.z = (seededNoise(rib + wreckIndex * 31) - 0.5) * 0.24;
        wreck.add(beam);
      }

      for (let colony = 0; colony < 18; colony += 1) {
        const coral = new Mesh(
          new ConeGeometry(
            0.25 + seededNoise(colony * 17 + 2) * 0.65,
            0.8 + seededNoise(colony * 17 + 3) * 2.4,
            5,
          ),
          growth,
        );
        coral.position.set(
          (seededNoise(colony * 17 + 4) - 0.5) * placement.lengthMeters * 0.28,
          placement.lengthMeters * 0.14,
          (seededNoise(colony * 17 + 5) - 0.5) * placement.lengthMeters * 0.82,
        );
        wreck.add(coral);
      }
      wreck.add(createGhostNet(placement.lengthMeters, this.physicalMaterials));
      this.physicalRoot.add(wreck);
    }
  }

  private createInfrastructure(): void {
    const pipeMaterial = this.track(
      new MeshStandardMaterial({
        color: 0x47514f,
        roughness: 0.88,
        metalness: 0.42,
      }),
    );
    const cableMaterial = this.track(
      new MeshStandardMaterial({
        color: 0x242c2b,
        roughness: 0.94,
        metalness: 0.12,
      }),
    );
    const pipelinePoints = [
      new Vector3(
        NORTH_SEA_RIG_POSITION.x,
        terrainHeightAt(NORTH_SEA_RIG_POSITION.x, NORTH_SEA_RIG_POSITION.z) +
          1.8,
        NORTH_SEA_RIG_POSITION.z,
      ),
      pointOnFloor(2_450, -1_450, 1.8),
      pointOnFloor(3_150, -900, 1.8),
      pointOnFloor(3_880, -240, 1.8),
    ];
    const pipeline = new Mesh(
      new TubeGeometry(
        new CatmullRomCurve3(pipelinePoints),
        128,
        1.7,
        8,
        false,
      ),
      pipeMaterial,
    );
    pipeline.name = "offshore-export-pipeline";
    this.physicalRoot.add(pipeline);

    const cableRoutes = [
      [
        pointOnFloor(-3_900, -2_250, 0.45),
        pointOnFloor(-1_600, -1_520, 0.45),
        pointOnFloor(420, -1_860, 0.45),
        pointOnFloor(3_850, -2_520, 0.45),
      ],
      [
        pointOnFloor(-3_850, 2_720, 0.45),
        pointOnFloor(-1_120, 1_940, 0.45),
        pointOnFloor(1_360, 2_440, 0.45),
        pointOnFloor(3_880, 1_760, 0.45),
      ],
    ] as const;
    for (const [index, points] of cableRoutes.entries()) {
      const cable = new Mesh(
        new TubeGeometry(
          new CatmullRomCurve3([...points]),
          112,
          0.34,
          6,
          false,
        ),
        cableMaterial,
      );
      cable.name = `seabed-communications-cable-${index + 1}`;
      this.physicalRoot.add(cable);
    }
  }

  private createKelp(): InstancedMesh<BufferGeometry, MeshStandardMaterial> {
    const geometry = new PlaneGeometry(1, 1, 1, 7);
    geometry.translate(0, 0.5, 0);
    const material = this.track(
      new MeshStandardMaterial({
        color: 0x354f39,
        roughness: 0.84,
        metalness: 0,
        side: DoubleSide,
      }),
    );
    const time = this.kelpTime;
    material.onBeforeCompile = (shader) => {
      shader.uniforms["uKelpTime"] = time;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>\nuniform float uKelpTime;`,
        )
        .replace(
          "#include <begin_vertex>",
          `vec3 transformed = vec3(position);
float kelpHeight = clamp(position.y, 0.0, 1.0);
transformed.x += sin(uKelpTime * 0.34 + position.y * 4.2 + instanceMatrix[3].x * 0.03)
  * kelpHeight * kelpHeight * 0.22;`,
        );
    };
    material.customProgramCacheKey = () => "akula-shallow-kelp-v1";
    const kelp = new InstancedMesh(
      geometry,
      material,
      NORTH_SEA_KELP_PLACEMENTS.length,
    );
    kelp.name = "shallow-shelf-only-kelp";
    const matrix = new Matrix4();
    const quaternion = new Quaternion();
    const position = new Vector3();
    const scale = new Vector3();
    const color = new Color();
    for (const [index, placement] of NORTH_SEA_KELP_PLACEMENTS.entries()) {
      position.set(placement.x, placement.y, placement.z);
      quaternion.setFromAxisAngle(new Vector3(0, 1, 0), placement.yaw);
      scale.set(1.4 + (index % 5) * 0.19, placement.height, 1);
      matrix.compose(position, quaternion, scale);
      kelp.setMatrixAt(index, matrix);
      kelp.setColorAt(
        index,
        color.setHSL(0.28 + (index % 7) * 0.006, 0.25, 0.22),
      );
    }
    kelp.instanceMatrix.needsUpdate = true;
    kelp.computeBoundingSphere();
    return kelp;
  }

  private createChartOverlay(): void {
    const vertices: number[] = [];
    appendChartPolyline(vertices, [
      [NORTH_SEA_RIG_POSITION.x, NORTH_SEA_RIG_POSITION.z],
      [2_450, -1_450],
      [3_150, -900],
      [3_880, -240],
    ]);
    appendChartPolyline(vertices, [
      [-3_900, -2_250],
      [-1_600, -1_520],
      [420, -1_860],
      [3_850, -2_520],
    ]);
    appendChartPolyline(vertices, [
      [-3_850, 2_720],
      [-1_120, 1_940],
      [1_360, 2_440],
      [3_880, 1_760],
    ]);
    for (const wreck of NORTH_SEA_WRECKS) {
      const radius = Math.max(18, wreck.lengthMeters * 0.36);
      for (let segment = 0; segment < 12; segment += 1) {
        const a = (segment / 12) * Math.PI * 2;
        const b = ((segment + 1) / 12) * Math.PI * 2;
        vertices.push(
          wreck.x + Math.cos(a) * radius,
          18,
          wreck.z + Math.sin(a) * radius,
          wreck.x + Math.cos(b) * radius,
          18,
          wreck.z + Math.sin(b) * radius,
        );
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(Float32Array.from(vertices), 3),
    );
    const overlay = new LineSegments(geometry, this.chartMaterial);
    overlay.name = "charted-pipelines-cables-and-wrecks";
    overlay.renderOrder = 20;
    this.chartRoot.add(overlay);
  }

  private track<T extends Material>(material: T): T {
    this.physicalMaterials.add(material);
    return material;
  }
}

function createKelpPlacements(): NorthSeaKelpPlacement[] {
  const placements: NorthSeaKelpPlacement[] = [];
  for (
    let candidate = 0;
    candidate < 2_400 && placements.length < 170;
    candidate += 1
  ) {
    const x = -MAP_HALF_WIDTH + 90 + seededNoise(candidate * 17 + 1) * 980;
    const z =
      -MAP_HALF_LENGTH +
      160 +
      seededNoise(candidate * 17 + 2) * (MAP_HALF_LENGTH * 2 - 320);
    const floor = terrainHeightAt(x, z);
    if (floor < -192 || seededNoise(candidate * 17 + 3) < 0.72) {
      continue;
    }
    placements.push({
      x,
      y: floor + 0.2,
      z,
      yaw: seededNoise(candidate * 17 + 4) * Math.PI * 2,
      height: 4.5 + seededNoise(candidate * 17 + 5) * 8.5,
    });
  }
  return placements;
}

function createGhostNet(
  lengthMeters: number,
  materials: Set<Material>,
): LineSegments<BufferGeometry, LineBasicMaterial> {
  const vertices: number[] = [];
  const width = lengthMeters * 0.42;
  const length = lengthMeters * 0.62;
  for (let row = 0; row <= 7; row += 1) {
    const z = (row / 7 - 0.5) * length;
    vertices.push(-width / 2, 0, z, width / 2, 1.5 + Math.sin(row) * 0.8, z);
  }
  for (let column = 0; column <= 8; column += 1) {
    const x = (column / 8 - 0.5) * width;
    vertices.push(
      x,
      0,
      -length / 2,
      x,
      1.2 + Math.cos(column) * 0.7,
      length / 2,
    );
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(Float32Array.from(vertices), 3),
  );
  const material = new LineBasicMaterial({
    color: 0x48564c,
    transparent: true,
    opacity: 0.68,
  });
  materials.add(material);
  const net = new LineSegments(geometry, material);
  net.name = "colonized-ghost-net";
  net.position.set(0, lengthMeters * 0.18, lengthMeters * 0.06);
  net.rotation.x = -0.18;
  return net;
}

function createSedimentClouds(): Points<BufferGeometry, ShaderMaterial> {
  const pointsPerWreck = 260;
  const positions = new Float32Array(
    NORTH_SEA_WRECKS.length * pointsPerWreck * 3,
  );
  const seeds = new Float32Array(NORTH_SEA_WRECKS.length * pointsPerWreck);
  let pointIndex = 0;
  for (const [wreckIndex, wreck] of NORTH_SEA_WRECKS.entries()) {
    for (let index = 0; index < pointsPerWreck; index += 1) {
      const seed = wreckIndex * 100_003 + index * 23;
      const angle = seededNoise(seed + 1) * Math.PI * 2;
      const radius = Math.sqrt(seededNoise(seed + 2)) * 105;
      const x = wreck.x + Math.cos(angle) * radius;
      const z = wreck.z + Math.sin(angle) * radius;
      positions[pointIndex * 3] = x;
      positions[pointIndex * 3 + 1] =
        terrainHeightAt(x, z) + 0.8 + Math.pow(seededNoise(seed + 3), 2) * 22;
      positions[pointIndex * 3 + 2] = z;
      seeds[pointIndex] = seededNoise(seed + 4);
      pointIndex += 1;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage),
  );
  geometry.setAttribute("aSeed", new BufferAttribute(seeds, 1));
  geometry.computeBoundingSphere();
  const material = new ShaderMaterial({
    name: "wreck-and-bottom-suspended-sediment",
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0.4 },
      uCameraPosition: { value: new Vector3() },
    },
    vertexShader: `
      uniform float uTime;
      uniform vec3 uCameraPosition;
      attribute float aSeed;
      varying float vAlpha;
      void main() {
        vec3 drifted = position;
        drifted.x += sin(uTime * 0.08 + aSeed * 41.0) * (0.8 + aSeed * 2.8);
        drifted.z += cos(uTime * 0.065 + aSeed * 57.0) * (0.6 + aSeed * 2.1);
        vec3 worldPosition = (modelMatrix * vec4(drifted, 1.0)).xyz;
        float distanceToCamera = distance(worldPosition, uCameraPosition);
        vAlpha = 1.0 - smoothstep(45.0, 245.0, distanceToCamera);
        vec4 viewPosition = viewMatrix * vec4(worldPosition, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = clamp((1.1 + aSeed * 2.8) * 92.0 / max(-viewPosition.z, 12.0), 0.65, 4.5);
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      varying float vAlpha;
      void main() {
        float radius = length(gl_PointCoord - 0.5) * 2.0;
        float alpha = (1.0 - smoothstep(0.16, 1.0, radius)) * vAlpha * uOpacity;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(vec3(0.39, 0.43, 0.37), alpha);
      }
    `,
  });
  const sediment = new Points(geometry, material);
  sediment.name = "localized-bottom-and-wreck-sediment";
  sediment.frustumCulled = false;
  return sediment;
}

function pointOnFloor(x: number, z: number, offset: number): Vector3 {
  return new Vector3(x, terrainHeightAt(x, z) + offset, z);
}

function appendChartPolyline(
  target: number[],
  points: readonly (readonly [number, number])[],
): void {
  for (let index = 0; index < points.length - 1; index += 1) {
    const first = points[index];
    const second = points[index + 1];
    if (first !== undefined && second !== undefined) {
      target.push(first[0], 18, first[1], second[0], 18, second[1]);
    }
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
    throw new Error(`Missing benthic shader uniform: ${name}`);
  }
  return uniform;
}

function seededNoise(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43_758.5453;
  return value - Math.floor(value);
}
