import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  ExtrudeGeometry,
  FogExp2,
  FrontSide,
  Group,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Points,
  RepeatWrapping,
  SRGBColorSpace,
  ShaderMaterial,
  Shape,
  SphereGeometry,
  TextureLoader,
  Quaternion,
  Vector3,
  type Material,
} from "three";
import type { Camera, Object3D, Scene, WebGLRenderer } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ColdSeaLife } from "./ColdSeaLife";
import { createIcebergGeometry } from "./IcebergGeometry";
import {
  didPropulsionRestart,
  type MarineLifeDisturbanceState,
  type MarineLifeVesselState,
} from "./MarineLifeDisturbance";
import { NorthSeaMegafauna } from "./NorthSeaMegafauna";
import {
  marineParticleDensity,
  northSeaEnvironmentAt,
  northSeaSurfaceFogDensity,
  northSeaUnderwaterVisibilityMeters,
  type NorthSeaEnvironmentState,
} from "./NorthSeaEnvironment";
import {
  NorthSeaBenthicWorld,
  northSeaWreckSuspensionAt,
} from "./NorthSeaBenthicWorld";
import { NorthSeaSurfaceActivity } from "./NorthSeaSurfaceActivity";
import { OceanSurface } from "./OceanSurface";
import type { OceanSurfaceSample } from "./OceanSpectrum";
import {
  underwaterTargetAmount,
  underwaterVisibilityMeters,
  type UnderwaterOpticsState,
} from "./UnderwaterOptics";
import {
  ICE_KEELS,
  MAP_HALF_LENGTH,
  MAP_HALF_WIDTH,
  SEAFLOOR_POCKMARKS,
  channelWallAt,
  riftCenterAt,
  terrainHeightAt,
} from "./WorldGeometry";

interface SonarPulse {
  readonly mesh: Mesh;
  age: number;
}

const FLOE_PLACEMENTS = [
  [-1_050, 690, 320, 190, 0.18],
  [-830, -90, 255, 145, -0.22],
  [-1_020, -850, 300, 180, 0.34],
  [1_020, 720, 315, 175, -0.27],
  [870, -390, 245, 150, 0.22],
  [1_030, -1_020, 290, 165, -0.18],
  [80, -1_170, 230, 105, 0.08],
] as const;

const ICEBERG_ASSET_PATHS = [
  "/assets/models/icebergs/boulder_01_ice.glb",
  "/assets/models/icebergs/namaqualand_boulder_03_ice.glb",
  "/assets/models/icebergs/namaqualand_boulder_04_ice.glb",
  "/assets/models/icebergs/namaqualand_boulder_06_ice.glb",
] as const;

const NORMAL_FOG_COLOR = new Color(0x061d27);
const NORMAL_BACKGROUND_COLOR = new Color(0x03141e);
const TACTICAL_BACKGROUND_COLOR = new Color(0x121a16);
const SHALLOW_UNDERWATER_FOG_COLOR = new Color(0x083743);
const DEEP_UNDERWATER_FOG_COLOR = new Color(0x02141f);
const TACTICAL_FOG_COLOR = new Color(0x07100e);
const NORMAL_TERRAIN_COLOR = new Color(0x819093);
const TACTICAL_TERRAIN_COLOR = new Color(0x687467);

export class ArcticWorld {
  public readonly root = new Group();
  public readonly contactRoot = new Group();
  private readonly ocean = new OceanSurface();
  private readonly surfaceActivity = new NorthSeaSurfaceActivity((x, z, time) =>
    this.ocean.sample(x, z, time),
  );
  private readonly benthicWorld = new NorthSeaBenthicWorld();
  private readonly coldSeaLife = new ColdSeaLife();
  private readonly northSeaMegafauna = new NorthSeaMegafauna();
  private readonly underwaterCameraFill = new PointLight(0x76aeb4, 0, 190, 2);
  private readonly skyLight = new HemisphereLight(0x9dd9ee, 0x031018, 2.55);
  private readonly sunLight = new DirectionalLight(0xd5efff, 4.2);
  private readonly sunDisc = new Mesh(
    new SphereGeometry(42, 24, 16),
    new MeshBasicMaterial({
      color: 0xd9f6ff,
      transparent: true,
      opacity: 0.78,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  private readonly backgroundColor = new Color(NORMAL_BACKGROUND_COLOR);
  private readonly particles: Points<BufferGeometry, ShaderMaterial>;
  private readonly underwaterFogColor = new Color();
  private readonly terrainMaterial = createTerrainMaterial();
  private readonly tacticalTerrainMaterial = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  private readonly gridMaterial = new LineBasicMaterial({
    color: 0x84927d,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
  });
  private readonly contourMaterial = new LineBasicMaterial({
    color: 0xb8c59a,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
  });
  private readonly hazardMaterial = new LineBasicMaterial({
    color: 0xc8a66a,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
  });
  private readonly chartRoot = new Group();
  private readonly detailMaterials = new Set<MeshStandardMaterial>();
  private readonly snowMaterial = new MeshStandardMaterial({
    color: 0xe7f2ef,
    roughness: 0.83,
    metalness: 0,
  });
  private readonly icebergMaterials: MeshStandardMaterial[] = [];
  private readonly contactMaterial = new MeshStandardMaterial({
    color: 0x10191c,
    metalness: 0.42,
    roughness: 0.72,
    transparent: true,
    opacity: 0,
  });
  private readonly sonarPulses: SonarPulse[] = [];
  private contactVisibility = 0;
  private tmaDebugContactVisible = false;
  private tacticalAmount = 0;
  private underwaterAmount = 1;
  private waterEffectsEnabled = true;
  private previousPropulsionStopped: boolean | undefined;
  private currentEnvironment: NorthSeaEnvironmentState = northSeaEnvironmentAt(
    0,
    0,
    0,
  );

  public constructor(private readonly scene: Scene) {
    scene.background = this.backgroundColor;
    scene.fog = new FogExp2(NORMAL_FOG_COLOR, 0.00155);
    scene.add(this.root);
    this.createLights();
    this.underwaterCameraFill.name = "underwater-camera-exposure-fill";
    this.root.add(this.underwaterCameraFill);
    this.createTerrain();
    this.root.add(this.ocean.sky, this.ocean.mesh, this.ocean.rain);
    this.createIce();
    this.root.add(
      this.surfaceActivity.root,
      this.benthicWorld.root,
      this.coldSeaLife.root,
      this.northSeaMegafauna.root,
    );
    this.particles = this.createMarineSnow();
    this.createContact();
    this.contactRoot.visible = false;
    this.root.add(this.chartRoot);
  }

  public async initialize(): Promise<void> {
    await Promise.all([
      this.loadSurfaceTextures(),
      this.loadBoulderField(),
      this.loadIcebergs(),
      this.surfaceActivity.initialize(),
      this.coldSeaLife.initialize(),
      this.northSeaMegafauna.initialize(),
    ]);
  }

  public update(
    elapsedSeconds: number,
    deltaSeconds: number,
    camera: Camera,
    vessel: MarineLifeVesselState,
  ): UnderwaterOpticsState {
    const disturbance: MarineLifeDisturbanceState = {
      ...vessel,
      propulsionRestarted: didPropulsionRestart(
        this.previousPropulsionStopped,
        vessel.propulsionStopped,
      ),
    };
    this.previousPropulsionStopped = vessel.propulsionStopped;
    const environment = northSeaEnvironmentAt(
      elapsedSeconds,
      camera.position.x,
      camera.position.z,
    );
    this.currentEnvironment = environment;
    this.ocean.setEnvironment(environment);
    this.ocean.update(elapsedSeconds, camera);
    const water = this.ocean.sample(
      camera.position.x,
      camera.position.z,
      elapsedSeconds,
    );
    const cameraDepthMeters = water.height - camera.position.y;
    const targetAmount = underwaterTargetAmount(cameraDepthMeters);
    this.underwaterAmount = MathUtils.damp(
      this.underwaterAmount,
      targetAmount,
      targetAmount > this.underwaterAmount ? 8.5 : 5.2,
      deltaSeconds,
    );
    if (Math.abs(this.underwaterAmount - targetAmount) < 0.001) {
      this.underwaterAmount = targetAmount;
    }
    const floorClearanceMeters =
      camera.position.y - terrainHeightAt(camera.position.x, camera.position.z);
    const wreckSuspension = northSeaWreckSuspensionAt(
      camera.position.x,
      camera.position.y,
      camera.position.z,
    );
    const optics: UnderwaterOpticsState = {
      amount: this.underwaterAmount,
      cameraDepthMeters: Math.max(0, cameraDepthMeters),
      surfaceHeight: water.height,
      visibilityMeters: northSeaUnderwaterVisibilityMeters(
        underwaterVisibilityMeters(cameraDepthMeters),
        environment,
        floorClearanceMeters,
        wreckSuspension,
      ),
    };
    this.underwaterCameraFill.position.copy(camera.position);
    this.underwaterCameraFill.intensity = MathUtils.damp(
      this.underwaterCameraFill.intensity,
      this.waterEffectsEnabled
        ? 18_000 * optics.amount * (1 - this.tacticalAmount)
        : 0,
      5.5,
      deltaSeconds,
    );
    this.coldSeaLife.update(
      elapsedSeconds,
      deltaSeconds,
      camera,
      this.tacticalAmount,
      optics.amount,
      disturbance,
    );
    this.northSeaMegafauna.update(
      elapsedSeconds,
      deltaSeconds,
      camera,
      this.tacticalAmount,
      optics.amount,
      disturbance,
    );
    this.benthicWorld.update(
      elapsedSeconds,
      camera,
      environment,
      optics.amount,
    );
    this.surfaceActivity.update(
      elapsedSeconds,
      deltaSeconds,
      camera,
      environment,
      optics.amount,
    );
    this.updateFog(optics, environment);
    this.updateWeatherLighting(environment);

    this.particles.position.copy(camera.position);
    this.particles.rotation.y = elapsedSeconds * 0.003;
    requireShaderUniform(this.particles.material, "uTime").value =
      elapsedSeconds;
    requireShaderUniform(this.particles.material, "uOpacity").value =
      0.54 *
      marineParticleDensity(
        environment,
        floorClearanceMeters,
        wreckSuspension,
      ) *
      optics.amount *
      (1 - this.tacticalAmount);
    this.particles.visible =
      this.waterEffectsEnabled &&
      optics.amount > 0.008 &&
      this.tacticalAmount < 0.98;

    this.contactMaterial.opacity = MathUtils.damp(
      this.contactMaterial.opacity,
      this.tmaDebugContactVisible
        ? (0.03 + this.contactVisibility * 0.72) * (1 - this.tacticalAmount)
        : 0,
      4,
      deltaSeconds,
    );
    this.contactVisibility = Math.max(
      0,
      this.contactVisibility - deltaSeconds * 0.22,
    );

    for (let index = this.sonarPulses.length - 1; index >= 0; index -= 1) {
      const pulse = this.sonarPulses[index];
      if (pulse === undefined) {
        continue;
      }
      pulse.age += deltaSeconds;
      const scale = 1 + pulse.age * 132;
      pulse.mesh.scale.setScalar(scale);
      const material = pulse.mesh.material;
      if (material instanceof MeshBasicMaterial) {
        material.opacity = Math.max(0, 0.28 * (1 - pulse.age / 4.2));
      }
      if (pulse.age > 4.2) {
        this.root.remove(pulse.mesh);
        pulse.mesh.geometry.dispose();
        disposeMaterial(pulse.mesh.material);
        this.sonarPulses.splice(index, 1);
      }
    }

    return optics;
  }

  public setContact(position: Vector3, heading: number): void {
    this.contactRoot.position.copy(position);
    this.contactRoot.rotation.y = heading;
  }

  public revealContact(strength = 1): void {
    if (!this.tmaDebugContactVisible) {
      return;
    }
    this.contactVisibility = Math.max(this.contactVisibility, strength);
  }

  public setTmaDebugContactVisible(visible: boolean): void {
    this.tmaDebugContactVisible = visible;
    this.contactRoot.visible = visible && this.tacticalAmount < 0.995;
    if (!visible) {
      this.contactVisibility = 0;
      this.contactMaterial.opacity = 0;
    }
  }

  public setWaterEffectsEnabled(enabled: boolean): void {
    this.waterEffectsEnabled = enabled;
    this.ocean.setWaterEffectsEnabled(enabled);
    if (!enabled) {
      this.particles.visible = false;
      this.underwaterCameraFill.intensity = 0;
    }
  }

  public emitSonarPulse(position: Vector3): void {
    const material = new MeshBasicMaterial({
      color: 0x9ff6ff,
      wireframe: true,
      transparent: true,
      opacity: 0.28,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new Mesh(new SphereGeometry(1, 24, 14), material);
    mesh.position.copy(position);
    this.root.add(mesh);
    this.sonarPulses.push({ mesh, age: 0 });
  }

  public sampleWater(x: number, z: number, time: number): OceanSurfaceSample {
    return this.ocean.sample(x, z, time);
  }

  public get environmentSnapshot(): NorthSeaEnvironmentState {
    return this.currentEnvironment;
  }

  public get visibleRainIntensity(): number {
    return this.ocean.visibleRainIntensity;
  }

  public setTacticalView(amount: number): void {
    this.tacticalAmount = MathUtils.clamp(amount, 0, 1);
    this.ocean.setTacticalView(this.tacticalAmount);
    this.surfaceActivity.setTacticalView(this.tacticalAmount);
    this.benthicWorld.setTacticalView(this.tacticalAmount);
    this.backgroundColor.lerpColors(
      NORMAL_BACKGROUND_COLOR,
      TACTICAL_BACKGROUND_COLOR,
      this.tacticalAmount,
    );

    this.terrainMaterial.color.lerpColors(
      NORMAL_TERRAIN_COLOR,
      TACTICAL_TERRAIN_COLOR,
      this.tacticalAmount,
    );
    this.terrainMaterial.emissive.setRGB(
      0.018 * this.tacticalAmount,
      0.025 * this.tacticalAmount,
      0.016 * this.tacticalAmount,
    );
    this.terrainMaterial.emissiveIntensity = this.tacticalAmount;

    const chartAmount = smoothChartReveal(this.tacticalAmount);
    this.chartRoot.visible = chartAmount > 0.002;
    this.tacticalTerrainMaterial.opacity = chartAmount * 0.96;
    this.contourMaterial.opacity = chartAmount * 0.62;
    this.hazardMaterial.opacity = chartAmount * 0.82;
    this.gridMaterial.opacity = chartAmount * 0.14;
    setFadingMaterialOpacity(this.terrainMaterial, 1 - chartAmount * 0.92);
    for (const material of this.detailMaterials) {
      setFadingMaterialOpacity(material, 1 - chartAmount);
    }
    this.contactRoot.visible =
      this.tmaDebugContactVisible && chartAmount < 0.995;

    const iceOpacity = 1 - smoothTacticalFade(this.tacticalAmount);
    setFadingMaterialOpacity(this.snowMaterial, iceOpacity);
    for (const material of this.icebergMaterials) {
      setFadingMaterialOpacity(material, iceOpacity);
    }
  }

  public renderWaterRefraction(renderer: WebGLRenderer, camera: Camera): void {
    if (!this.waterEffectsEnabled) {
      return;
    }
    const particlesVisible = this.particles.visible;
    this.particles.visible = false;
    this.ocean.renderRefraction(renderer, this.scene, camera);
    this.particles.visible = particlesVisible;
  }

  public dispose(): void {
    for (const pulse of this.sonarPulses) {
      pulse.mesh.geometry.dispose();
      disposeMaterial(pulse.mesh.material);
    }
    this.sonarPulses.length = 0;
    this.root.traverse((object) => {
      if (
        object === this.ocean.mesh ||
        object === this.ocean.sky ||
        object === this.ocean.rain
      ) {
        return;
      }
      if (
        object instanceof Mesh ||
        object instanceof Points ||
        object instanceof LineSegments
      ) {
        object.geometry.dispose();
        disposeMaterial(object.material);
      }
    });
    this.ocean.dispose();
    this.scene.remove(this.root);
  }

  private createLights(): void {
    this.sunLight.position.set(-620, 280, -920);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2_048, 2_048);
    this.sunLight.shadow.camera.left = -850;
    this.sunLight.shadow.camera.right = 850;
    this.sunLight.shadow.camera.top = 850;
    this.sunLight.shadow.camera.bottom = -850;
    this.sunLight.shadow.camera.near = 20;
    this.sunLight.shadow.camera.far = 2_500;
    this.sunLight.shadow.bias = -0.00035;
    this.sunDisc.position.set(-1_050, 90, -1_650);
    this.root.add(this.skyLight, this.sunLight, this.sunDisc);
  }

  private createTerrain(): void {
    const geometry = new PlaneGeometry(
      MAP_HALF_WIDTH * 2,
      MAP_HALF_LENGTH * 2,
      320,
      320,
    );
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.getAttribute("position");
    const colors = new Float32Array(positions.count * 3);
    const lowColor = new Color(0x25383b);
    const midColor = new Color(0x56635f);
    const highColor = new Color(0x747b61);
    const workingColor = new Color();
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const z = positions.getZ(index);
      const y = terrainHeightAt(x, z);
      positions.setY(index, y);
      const heightFactor = MathUtils.clamp((y + 180) / 158, 0, 1);
      if (heightFactor < 0.58) {
        workingColor.lerpColors(lowColor, midColor, heightFactor / 0.58);
      } else {
        workingColor.lerpColors(
          midColor,
          highColor,
          (heightFactor - 0.58) / 0.42,
        );
      }
      const noise =
        Math.sin(x * 0.052 + z * 0.031) * 0.021 +
        Math.sin(x * 0.013 - z * 0.018) * 0.016;
      colors[index * 3] = workingColor.r + noise;
      colors[index * 3 + 1] = workingColor.g + noise;
      colors[index * 3 + 2] = workingColor.b + noise;
    }
    positions.needsUpdate = true;
    geometry.setAttribute("color", new BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const terrain = new Mesh(geometry, this.terrainMaterial);
    terrain.receiveShadow = true;
    this.root.add(terrain);

    const pockmarkGeometry = createPockmarkBowlGeometry();
    const pockmarks = new InstancedMesh(
      pockmarkGeometry,
      this.terrainMaterial,
      SEAFLOOR_POCKMARKS.length,
    );
    pockmarks.name = "mareano-pockmark-close-range-enhancement";
    pockmarks.receiveShadow = true;
    const pockmarkMatrix = new Matrix4();
    for (const [index, pockmark] of SEAFLOOR_POCKMARKS.entries()) {
      pockmarkMatrix.makeScale(
        pockmark.radius,
        pockmark.depth,
        pockmark.radius,
      );
      pockmarkMatrix.setPosition(
        pockmark.x,
        terrainHeightAt(pockmark.x, pockmark.z) + 0.12,
        pockmark.z,
      );
      pockmarks.setMatrixAt(index, pockmarkMatrix);
    }
    pockmarks.instanceMatrix.needsUpdate = true;
    pockmarks.computeBoundingSphere();
    this.root.add(pockmarks);

    const chartGeometry = geometry.clone();
    const chartPositions = chartGeometry.getAttribute("position");
    const chartColors = new Float32Array(chartPositions.count * 3);
    const deepChartColor = new Color(0x17221f);
    const shallowChartColor = new Color(0x77816d);
    const chartColor = new Color();
    for (let index = 0; index < chartPositions.count; index += 1) {
      const height = chartPositions.getY(index);
      chartPositions.setY(index, height + 1.25);
      const normalized = MathUtils.clamp((height + 370) / 300, 0, 1);
      const depthBand = Math.round(normalized * 8) / 8;
      chartColor.lerpColors(deepChartColor, shallowChartColor, depthBand);
      chartColors[index * 3] = chartColor.r;
      chartColors[index * 3 + 1] = chartColor.g;
      chartColors[index * 3 + 2] = chartColor.b;
    }
    chartPositions.needsUpdate = true;
    chartGeometry.setAttribute("color", new BufferAttribute(chartColors, 3));
    const chartTerrain = new Mesh(chartGeometry, this.tacticalTerrainMaterial);
    chartTerrain.renderOrder = 20;
    this.chartRoot.add(chartTerrain);

    const contours = new LineSegments(
      createBathymetricContourGeometry(),
      this.contourMaterial,
    );
    contours.renderOrder = 30;
    this.chartRoot.add(contours);

    const grid = new LineSegments(createChartGridGeometry(), this.gridMaterial);
    grid.renderOrder = 29;
    this.chartRoot.add(grid);

    const hazards = new LineSegments(
      createIceHazardGeometry(),
      this.hazardMaterial,
    );
    hazards.renderOrder = 31;
    this.chartRoot.add(hazards);
    this.chartRoot.visible = false;
  }

  private createIce(): void {
    for (const [
      floeIndex,
      [x, z, radiusX, radiusZ, rotation],
    ] of FLOE_PLACEMENTS.entries()) {
      const shape = new Shape();
      const pointCount = 18;
      for (let point = 0; point < pointCount; point += 1) {
        const angle = (point / pointCount) * Math.PI * 2;
        const broadFracture = Math.sin(angle * 3 + floeIndex) * 0.09;
        const jitter =
          0.76 + seededNoise(point + Math.round(x)) * 0.27 + broadFracture;
        const px = Math.cos(angle) * radiusX * jitter;
        const py = Math.sin(angle) * radiusZ * jitter;
        if (point === 0) {
          shape.moveTo(px, py);
        } else {
          shape.lineTo(px, py);
        }
      }
      shape.closePath();
      const floe = new Mesh(
        new ExtrudeGeometry(shape, {
          depth: 4 + (floeIndex % 3) * 1.3,
          bevelEnabled: true,
          bevelSegments: 2,
          bevelSize: 3.5,
          bevelThickness: 2.2,
          curveSegments: 1,
        }),
        this.snowMaterial,
      );
      floe.geometry.center();
      floe.rotation.x = -Math.PI / 2;
      floe.rotation.z = rotation;
      floe.position.set(x, -0.4, z);
      floe.castShadow = true;
      floe.receiveShadow = true;
      this.root.add(floe);
    }
  }

  private createMarineSnow(): Points<BufferGeometry, ShaderMaterial> {
    const count = 3_200;
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const sizes = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = (seededNoise(index * 5) - 0.5) * 420;
      positions[index * 3 + 1] = (seededNoise(index * 5 + 1) - 0.5) * 220;
      positions[index * 3 + 2] = (seededNoise(index * 5 + 2) - 0.5) * 420;
      seeds[index] = seededNoise(index * 5 + 3);
      sizes[index] = 0.65 + seededNoise(index * 5 + 4) * 1.85;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("aSeed", new BufferAttribute(seeds, 1));
    geometry.setAttribute("aSize", new BufferAttribute(sizes, 1));
    const material = new ShaderMaterial({
      name: "AKULA suspended marine particles",
      transparent: true,
      depthWrite: true,
      toneMapped: false,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0.68 },
      },
      vertexShader: `
        uniform float uTime;
        attribute float aSeed;
        attribute float aSize;
        varying float vSeed;

        void main() {
          vec3 drifted = position;
          drifted.x += sin(uTime * 0.11 + aSeed * 37.0) * (0.8 + aSeed * 2.2);
          drifted.y += sin(uTime * 0.075 + aSeed * 53.0) * (1.4 + aSeed * 3.1);
          drifted.z += cos(uTime * 0.09 + aSeed * 29.0) * (0.7 + aSeed * 1.8);
          vec4 viewPosition = modelViewMatrix * vec4(drifted, 1.0);
          gl_Position = projectionMatrix * viewPosition;
          gl_PointSize = clamp(aSize * 92.0 / max(-viewPosition.z, 16.0), 0.55, 4.1);
          vSeed = aSeed;
        }
      `,
      fragmentShader: `
        uniform float uOpacity;
        varying float vSeed;

        void main() {
          float radius = length(gl_PointCoord - 0.5) * 2.0;
          float softParticle = 1.0 - smoothstep(0.18, 1.0, radius);
          if (softParticle < 0.015) discard;
          vec3 color = mix(vec3(0.39, 0.68, 0.72), vec3(0.76, 0.91, 0.91), vSeed);
          float opacity = softParticle * uOpacity * mix(0.28, 0.9, vSeed);
          gl_FragColor = vec4(color, opacity);
        }
      `,
    });
    const particles = new Points(geometry, material);
    particles.frustumCulled = false;
    this.root.add(particles);
    return particles;
  }

  private updateFog(
    optics: UnderwaterOpticsState,
    environment: NorthSeaEnvironmentState,
  ): void {
    const fog = this.scene.fog;
    if (!(fog instanceof FogExp2)) {
      return;
    }

    if (!this.waterEffectsEnabled) {
      fog.color.copy(NORMAL_FOG_COLOR);
      fog.color.lerp(TACTICAL_FOG_COLOR, this.tacticalAmount);
      fog.density = MathUtils.lerp(0, 0.000035, this.tacticalAmount);
      return;
    }

    const depthBlend = MathUtils.smoothstep(optics.cameraDepthMeters, 10, 155);
    this.underwaterFogColor.lerpColors(
      SHALLOW_UNDERWATER_FOG_COLOR,
      DEEP_UNDERWATER_FOG_COLOR,
      depthBlend,
    );
    this.underwaterFogColor.lerp(
      new Color(0x173f37),
      environment.phytoplanktonBloom * (1 - depthBlend) * 0.34,
    );
    fog.color.lerpColors(
      NORMAL_FOG_COLOR,
      this.underwaterFogColor,
      optics.amount,
    );
    fog.color.lerp(TACTICAL_FOG_COLOR, this.tacticalAmount);

    const underwaterDensity = Math.max(
      MathUtils.lerp(0.0038, 0.0068, depthBlend),
      0.76 / Math.max(24, optics.visibilityMeters),
    );
    const surfaceDensity = northSeaSurfaceFogDensity(
      environment.surfaceVisibilityMeters,
      this.ocean.visibleRainIntensity,
    );
    const cameraDensity = MathUtils.lerp(
      surfaceDensity,
      underwaterDensity,
      optics.amount,
    );
    fog.density = MathUtils.lerp(cameraDensity, 0.000035, this.tacticalAmount);
  }

  private updateWeatherLighting(environment: NorthSeaEnvironmentState): void {
    const lightThroughCloud = MathUtils.clamp(
      1 - environment.cloudCover * 0.62 - environment.squall * 0.18,
      0.16,
      1,
    );
    this.skyLight.intensity =
      (0.45 + environment.daylight * 2.15) * lightThroughCloud;
    this.sunLight.intensity = environment.daylight * 4.6 * lightThroughCloud;
    this.sunLight.color
      .set(0xff9a68)
      .lerp(
        new Color(0xd5efff),
        MathUtils.smoothstep(environment.daylight, 0.2, 0.68),
      );

    const horizontal = Math.cos(environment.sunElevationRadians);
    this.sunLight.position.set(
      -1_150 * horizontal,
      1_150 * Math.sin(environment.sunElevationRadians),
      -1_740 * horizontal,
    );
    this.sunDisc.position.copy(this.sunLight.position);
    const material = this.sunDisc.material;
    if (material instanceof MeshBasicMaterial) {
      material.opacity =
        environment.daylight *
        (1 - environment.cloudCover * 0.72) *
        (1 - environment.saltHaze * 0.38);
      material.color
        .set(0xff8b55)
        .lerp(
          new Color(0xd9f6ff),
          MathUtils.smoothstep(environment.daylight, 0.22, 0.72),
        );
    }
  }

  private createContact(): void {
    const hull = new Mesh(new SphereGeometry(1, 24, 10), this.contactMaterial);
    hull.scale.set(6.8, 5.4, 42);
    hull.castShadow = true;
    const sail = new Mesh(
      new CylinderGeometry(2.2, 3.4, 6.4, 8),
      this.contactMaterial,
    );
    sail.position.set(0, 5.2, -4);
    const planes = new Mesh(new PlaneGeometry(24, 8), this.contactMaterial);
    planes.rotation.x = -Math.PI / 2;
    planes.position.z = 28;
    this.contactRoot.add(hull, sail, planes);
    this.root.add(this.contactRoot);
  }

  private async loadSurfaceTextures(): Promise<void> {
    const loader = new TextureLoader();
    const [
      groundDiffuse,
      groundNormal,
      groundArm,
      snowDiffuse,
      snowNormal,
      snowRough,
    ] = await Promise.all([
      loader.loadAsync(
        "/assets/textures/rocks-ground-06/rocks_ground_06_diff_1k.jpg",
      ),
      loader.loadAsync(
        "/assets/textures/rocks-ground-06/rocks_ground_06_nor_gl_1k.jpg",
      ),
      loader.loadAsync(
        "/assets/textures/rocks-ground-06/rocks_ground_06_arm_1k.jpg",
      ),
      loader.loadAsync("/assets/textures/snow-02/snow_02_diff_1k.jpg"),
      loader.loadAsync("/assets/textures/snow-02/snow_02_nor_gl_1k.jpg"),
      loader.loadAsync("/assets/textures/snow-02/snow_02_rough_1k.jpg"),
    ]);

    for (const texture of [groundDiffuse, groundNormal, groundArm]) {
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
      texture.anisotropy = 8;
    }
    groundDiffuse.colorSpace = SRGBColorSpace;
    this.terrainMaterial.map = groundDiffuse;
    this.terrainMaterial.normalMap = groundNormal;
    this.terrainMaterial.normalScale.set(0.72, 0.72);
    this.terrainMaterial.roughnessMap = groundArm;
    this.terrainMaterial.needsUpdate = true;

    for (const texture of [snowDiffuse, snowNormal, snowRough]) {
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
      texture.repeat.set(2.4, 2.4);
    }
    snowDiffuse.colorSpace = SRGBColorSpace;
    this.snowMaterial.map = snowDiffuse;
    this.snowMaterial.normalMap = snowNormal;
    this.snowMaterial.normalScale.set(0.72, 0.72);
    this.snowMaterial.roughnessMap = snowRough;
    this.snowMaterial.needsUpdate = true;
  }

  private async loadBoulderField(): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(
      "/assets/models/rock-07/rock_07_1k.glb",
    );
    const sourceRocks: Mesh[] = [];
    gltf.scene.traverse((object) => {
      if (sourceRocks.length === 0 && object instanceof Mesh) {
        sourceRocks.push(object);
      }
    });
    const sourceRock = sourceRocks[0];
    if (sourceRock === undefined) {
      return;
    }

    const sourceMaterial = Array.isArray(sourceRock.material)
      ? sourceRock.material[0]
      : sourceRock.material;
    if (!(sourceMaterial instanceof MeshStandardMaterial)) {
      return;
    }

    const geometry = sourceRock.geometry.clone();
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    if (bounds === null) {
      geometry.dispose();
      return;
    }
    const center = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    geometry.translate(-center.x, -bounds.min.y, -center.z);

    const material = sourceMaterial.clone();
    material.color.multiplyScalar(0.56);
    material.roughness = Math.max(material.roughness, 0.9);
    material.metalness = 0;
    this.detailMaterials.add(material);

    const wallRockCount = 104;
    const floorRockCount = 72;
    const rocks = new InstancedMesh(
      geometry,
      material,
      wallRockCount + floorRockCount,
    );
    rocks.name = "mareano-channel-boulder-field";
    rocks.castShadow = true;
    rocks.receiveShadow = true;

    const matrix = new Matrix4();
    const position = new Vector3();
    const scale = new Vector3();
    const up = new Vector3(0, 1, 0);
    const align = new Quaternion();
    const spin = new Quaternion();
    const orientation = new Quaternion();
    const color = new Color();
    const sourceDiameter = Math.max(size.x, size.z);

    for (let index = 0; index < wallRockCount + floorRockCount; index += 1) {
      let x: number;
      let z: number;
      let diameter: number;
      if (index < wallRockCount) {
        const trackIndex = Math.floor(index / 2);
        const side = index % 2 === 0 ? -1 : 1;
        z =
          -3_350 +
          (trackIndex / (wallRockCount / 2 - 1)) * 6_700 +
          (seededNoise(index * 7 + 1) - 0.5) * 88;
        x = channelWallAt(z, side) + (seededNoise(index * 7 + 2) - 0.5) * 128;
        diameter = 7 + seededNoise(index * 7 + 3) * 23;
      } else {
        const floorIndex = index - wallRockCount;
        z = -3_450 + seededNoise(floorIndex * 11 + 101) * 6_900;
        x =
          riftCenterAt(z) + (seededNoise(floorIndex * 11 + 102) - 0.5) * 1_050;
        diameter = 4 + seededNoise(floorIndex * 11 + 103) * 15;
      }

      const groundNormal = terrainNormalAt(x, z);
      position.set(x, terrainHeightAt(x, z) - diameter * 0.035, z);
      align.setFromUnitVectors(up, groundNormal);
      spin.setFromAxisAngle(up, seededNoise(index * 13 + 5) * Math.PI * 2);
      orientation.copy(align).multiply(spin);

      const baseScale = diameter / Math.max(0.001, sourceDiameter);
      scale.set(
        baseScale * (0.78 + seededNoise(index * 13 + 6) * 0.46),
        baseScale * (0.72 + seededNoise(index * 13 + 7) * 0.5),
        baseScale * (0.8 + seededNoise(index * 13 + 8) * 0.42),
      );
      matrix.compose(position, orientation, scale);
      rocks.setMatrixAt(index, matrix);

      const shade = 0.7 + seededNoise(index * 13 + 9) * 0.26;
      rocks.setColorAt(index, color.setRGB(shade, shade, shade));
    }
    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor !== null) {
      rocks.instanceColor.needsUpdate = true;
    }
    rocks.computeBoundingSphere();
    this.root.add(rocks);
  }

  private async loadIcebergs(): Promise<void> {
    const loader = new GLTFLoader();
    const sources = await Promise.all(
      ICEBERG_ASSET_PATHS.map((path) => loader.loadAsync(path)),
    );

    for (const [index, keel] of ICE_KEELS.entries()) {
      const source = sources[index];
      if (source === undefined) {
        continue;
      }
      source.scene.updateMatrixWorld(true);
      const sourceMesh = firstMeshIn(source.scene);
      if (sourceMesh === undefined) {
        continue;
      }
      const sourceMaterial = Array.isArray(sourceMesh.material)
        ? sourceMesh.material[0]
        : sourceMesh.material;
      if (!(sourceMaterial instanceof MeshStandardMaterial)) {
        continue;
      }

      const geometry = createIcebergGeometry(
        sourceMesh.geometry,
        sourceMesh.matrixWorld,
        keel,
        index,
      );
      const material = createIcebergMaterial(sourceMaterial);
      const iceberg = new Mesh(geometry, material);
      iceberg.name = `iceberg-${index + 1}-solid`;
      iceberg.position.set(keel.x, 0, keel.z);
      iceberg.rotation.y = keel.rotation;
      iceberg.castShadow = true;
      iceberg.receiveShadow = true;
      this.icebergMaterials.push(material);
      setFadingMaterialOpacity(
        material,
        1 - smoothTacticalFade(this.tacticalAmount),
      );
      this.root.add(iceberg);
    }
  }
}

function createIcebergMaterial(
  source: MeshStandardMaterial,
): MeshStandardMaterial {
  const material = source.clone();
  material.name = `${source.name || "scanned-rock"}-ice`;
  material.color.set(0xffffff);
  material.vertexColors = true;
  material.metalness = 0;
  material.roughness = 0.62;
  material.normalScale.set(0.68, 0.68);
  material.aoMapIntensity = 0.72;
  material.side = FrontSide;
  material.transparent = false;
  material.opacity = 1;
  material.depthWrite = true;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D(map, vMapUv);

  #ifdef DECODE_VIDEO_TEXTURE
    sampledDiffuseColor = sRGBTransferEOTF(sampledDiffuseColor);
  #endif

  float scannedIceDetail = dot(
    sampledDiffuseColor.rgb,
    vec3(0.2126, 0.7152, 0.0722)
  );
  scannedIceDetail = mix(
    0.74,
    1.12,
    smoothstep(0.06, 0.94, scannedIceDetail)
  );
  diffuseColor.rgb *= vec3(scannedIceDetail);
  diffuseColor.a *= sampledDiffuseColor.a;
#endif`,
    );
  };
  material.customProgramCacheKey = () => "akula-solid-iceberg-v1";
  material.needsUpdate = true;
  return material;
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

function setFadingMaterialOpacity(
  material: MeshStandardMaterial,
  opacity: number,
): void {
  const transparent = opacity < 0.999;
  if (material.transparent !== transparent) {
    material.transparent = transparent;
    material.needsUpdate = true;
  }
  material.opacity = opacity;
  material.depthWrite = opacity > 0.18;
}

function createTerrainMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: 0x819093,
    vertexColors: true,
    roughness: 0.96,
    metalness: 0.01,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms["terrainMapScale"] = { value: 1 / 22 };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vTerrainWorldPosition;
varying vec3 vTerrainWorldNormal;`,
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
vTerrainWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTerrainWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vTerrainWorldPosition;
varying vec3 vTerrainWorldNormal;
uniform float terrainMapScale;

vec3 terrainTriplanarWeights(vec3 worldNormal) {
  vec3 weights = pow(abs(normalize(worldNormal)), vec3(5.0));
  return weights / max(dot(weights, vec3(1.0)), 0.0001);
}

vec4 sampleTerrainTriplanar(
  sampler2D textureSampler,
  vec3 worldPosition,
  vec3 weights
) {
  vec3 scaledPosition = worldPosition * terrainMapScale;
  return texture2D(textureSampler, scaledPosition.zy) * weights.x
    + texture2D(textureSampler, scaledPosition.xz) * weights.y
    + texture2D(textureSampler, scaledPosition.xy) * weights.z;
}`,
      )
      .replace(
        "#include <map_fragment>",
        `#ifdef USE_MAP
  vec3 terrainMapWeights = terrainTriplanarWeights(vTerrainWorldNormal);
  vec4 sampledDiffuseColor = sampleTerrainTriplanar(
    map,
    vTerrainWorldPosition,
    terrainMapWeights
  );
  diffuseColor *= sampledDiffuseColor;
#endif`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
  vec3 terrainRoughnessWeights = terrainTriplanarWeights(vTerrainWorldNormal);
  vec4 texelRoughness = sampleTerrainTriplanar(
    roughnessMap,
    vTerrainWorldPosition,
    terrainRoughnessWeights
  );
  roughnessFactor *= texelRoughness.g;
#endif`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#ifdef USE_NORMALMAP_OBJECTSPACE
  normal = texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0;
  normal = normalize(normalMatrix * normal);
#elif defined(USE_NORMALMAP_TANGENTSPACE)
  vec3 baseWorldNormal = normalize(vTerrainWorldNormal);
  vec3 terrainNormalWeights = terrainTriplanarWeights(baseWorldNormal);
  vec3 scaledPosition = vTerrainWorldPosition * terrainMapScale;
  vec3 mapX = texture2D(normalMap, scaledPosition.zy).xyz * 2.0 - 1.0;
  vec3 mapY = texture2D(normalMap, scaledPosition.xz).xyz * 2.0 - 1.0;
  vec3 mapZ = texture2D(normalMap, scaledPosition.xy).xyz * 2.0 - 1.0;
  mapX.xy *= normalScale;
  mapY.xy *= normalScale;
  mapZ.xy *= normalScale;
  mapX = vec3(mapX.z * sign(baseWorldNormal.x), mapX.y, mapX.x);
  mapY = vec3(mapY.x, mapY.z * sign(baseWorldNormal.y), mapY.y);
  mapZ = vec3(mapZ.x, mapZ.y, mapZ.z * sign(baseWorldNormal.z));
  vec3 mappedWorldNormal = normalize(
    mapX * terrainNormalWeights.x
      + mapY * terrainNormalWeights.y
      + mapZ * terrainNormalWeights.z
  );
  normal = normalize(mat3(viewMatrix) * mappedWorldNormal);
#elif defined(USE_BUMPMAP)
  normal = perturbNormalArb(
    -vViewPosition,
    normal,
    dHdxy_fwd(),
    faceDirection
  );
#endif`,
      );
  };
  material.customProgramCacheKey = () => "akula-terrain-triplanar-v1";
  return material;
}

function createPockmarkBowlGeometry(): BufferGeometry {
  const radialSegments = 28;
  const rings = 6;
  const positions: number[] = [0, 0, 0];
  const indices: number[] = [];

  for (let ring = 1; ring <= rings; ring += 1) {
    const radius = ring / rings;
    const floorProfile = radius * radius * (3 - 2 * radius);
    const rimDistance = (radius - 0.86) / 0.09;
    const height = floorProfile + Math.exp(-rimDistance * rimDistance) * 0.1;
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const angle = (segment / radialSegments) * Math.PI * 2;
      positions.push(
        Math.cos(angle) * radius,
        height,
        Math.sin(angle) * radius,
      );
    }
  }

  for (let segment = 0; segment < radialSegments; segment += 1) {
    const current = 1 + segment;
    const next = 1 + ((segment + 1) % radialSegments);
    indices.push(0, next, current);
  }
  for (let ring = 1; ring < rings; ring += 1) {
    const innerStart = 1 + (ring - 1) * radialSegments;
    const outerStart = innerStart + radialSegments;
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const nextSegment = (segment + 1) % radialSegments;
      const inner = innerStart + segment;
      const innerNext = innerStart + nextSegment;
      const outer = outerStart + segment;
      const outerNext = outerStart + nextSegment;
      indices.push(inner, innerNext, outerNext, inner, outerNext, outer);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function terrainNormalAt(x: number, z: number): Vector3 {
  const sampleRadius = 8;
  const heightLeft = terrainHeightAt(x - sampleRadius, z);
  const heightRight = terrainHeightAt(x + sampleRadius, z);
  const heightNear = terrainHeightAt(x, z - sampleRadius);
  const heightFar = terrainHeightAt(x, z + sampleRadius);
  return new Vector3(
    heightLeft - heightRight,
    sampleRadius * 2,
    heightNear - heightFar,
  ).normalize();
}

function seededNoise(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43_758.5453;
  return value - Math.floor(value);
}

function smoothTacticalFade(amount: number): number {
  const normalized = MathUtils.clamp((amount - 0.06) / 0.62, 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function smoothChartReveal(amount: number): number {
  const normalized = MathUtils.clamp((amount - 0.16) / 0.56, 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function createBathymetricContourGeometry(): BufferGeometry {
  const vertices: number[] = [];
  const columns = 72;
  const rows = 60;
  const stepX = (MAP_HALF_WIDTH * 2) / columns;
  const stepZ = (MAP_HALF_LENGTH * 2) / rows;
  const contourLevels = [-175, -150, -125, -100, -80, -60, -35];

  for (let row = 0; row < rows; row += 1) {
    const z0 = -MAP_HALF_LENGTH + row * stepZ;
    const z1 = z0 + stepZ;
    for (let column = 0; column < columns; column += 1) {
      const x0 = -MAP_HALF_WIDTH + column * stepX;
      const x1 = x0 + stepX;
      const corners = [
        { x: x0, z: z0, height: terrainHeightAt(x0, z0) },
        { x: x1, z: z0, height: terrainHeightAt(x1, z0) },
        { x: x1, z: z1, height: terrainHeightAt(x1, z1) },
        { x: x0, z: z1, height: terrainHeightAt(x0, z1) },
      ] as const;
      for (const level of contourLevels) {
        const intersections: Array<Readonly<{ x: number; z: number }>> = [];
        appendContourIntersection(intersections, corners[0], corners[1], level);
        appendContourIntersection(intersections, corners[1], corners[2], level);
        appendContourIntersection(intersections, corners[2], corners[3], level);
        appendContourIntersection(intersections, corners[3], corners[0], level);
        if (intersections.length === 2) {
          const [first, second] = intersections;
          if (first !== undefined && second !== undefined) {
            appendChartSegment(vertices, first, second, level);
          }
        } else if (intersections.length === 4) {
          const [first, second, third, fourth] = intersections;
          if (
            first !== undefined &&
            second !== undefined &&
            third !== undefined &&
            fourth !== undefined
          ) {
            appendChartSegment(vertices, first, second, level);
            appendChartSegment(vertices, third, fourth, level);
          }
        }
      }
    }
  }

  const boundaryY = 12;
  appendChartSegment(
    vertices,
    { x: -MAP_HALF_WIDTH, z: -MAP_HALF_LENGTH },
    { x: MAP_HALF_WIDTH, z: -MAP_HALF_LENGTH },
    boundaryY,
  );
  appendChartSegment(
    vertices,
    { x: MAP_HALF_WIDTH, z: -MAP_HALF_LENGTH },
    { x: MAP_HALF_WIDTH, z: MAP_HALF_LENGTH },
    boundaryY,
  );
  appendChartSegment(
    vertices,
    { x: MAP_HALF_WIDTH, z: MAP_HALF_LENGTH },
    { x: -MAP_HALF_WIDTH, z: MAP_HALF_LENGTH },
    boundaryY,
  );
  appendChartSegment(
    vertices,
    { x: -MAP_HALF_WIDTH, z: MAP_HALF_LENGTH },
    { x: -MAP_HALF_WIDTH, z: -MAP_HALF_LENGTH },
    boundaryY,
  );

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(Float32Array.from(vertices), 3),
  );
  return geometry;
}

function createChartGridGeometry(): BufferGeometry {
  const vertices: number[] = [];
  const gridY = 13.5;
  const interval = 250;
  for (let x = -MAP_HALF_WIDTH; x <= MAP_HALF_WIDTH; x += interval) {
    vertices.push(x, gridY, -MAP_HALF_LENGTH, x, gridY, MAP_HALF_LENGTH);
  }
  for (let z = -MAP_HALF_LENGTH; z <= MAP_HALF_LENGTH; z += interval) {
    vertices.push(-MAP_HALF_WIDTH, gridY, z, MAP_HALF_WIDTH, gridY, z);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(Float32Array.from(vertices), 3),
  );
  return geometry;
}

function createIceHazardGeometry(): BufferGeometry {
  const vertices: number[] = [];
  const segments = 48;
  for (const keel of ICE_KEELS) {
    for (let segment = 0; segment < segments; segment += 1) {
      const firstAngle = (segment / segments) * Math.PI * 2;
      const secondAngle = ((segment + 1) / segments) * Math.PI * 2;
      const first = rotatedEllipsePoint(keel, firstAngle);
      const second = rotatedEllipsePoint(keel, secondAngle);
      vertices.push(first.x, 14, first.z, second.x, 14, second.z);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(Float32Array.from(vertices), 3),
  );
  return geometry;
}

function appendContourIntersection(
  target: Array<Readonly<{ x: number; z: number }>>,
  first: Readonly<{ x: number; z: number; height: number }>,
  second: Readonly<{ x: number; z: number; height: number }>,
  level: number,
): void {
  const crosses =
    (first.height < level && second.height >= level) ||
    (second.height < level && first.height >= level);
  if (!crosses) {
    return;
  }
  const amount = (level - first.height) / (second.height - first.height);
  target.push({
    x: MathUtils.lerp(first.x, second.x, amount),
    z: MathUtils.lerp(first.z, second.z, amount),
  });
}

function appendChartSegment(
  target: number[],
  first: Readonly<{ x: number; z: number }>,
  second: Readonly<{ x: number; z: number }>,
  height: number,
): void {
  target.push(first.x, height + 2.5, first.z, second.x, height + 2.5, second.z);
}

function rotatedEllipsePoint(
  keel: (typeof ICE_KEELS)[number],
  angle: number,
): Readonly<{ x: number; z: number }> {
  const localX = Math.cos(angle) * keel.radiusX;
  const localZ = Math.sin(angle) * keel.radiusZ;
  const cosine = Math.cos(keel.rotation);
  const sine = Math.sin(keel.rotation);
  return {
    x: keel.x + localX * cosine - localZ * sine,
    z: keel.z + localX * sine + localZ * cosine,
  };
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

function requireShaderUniform(
  material: ShaderMaterial,
  name: string,
): { value: unknown } {
  const uniform = material.uniforms[name];
  if (uniform === undefined) {
    throw new Error(`Missing marine-particle shader uniform: ${name}`);
  }
  return uniform;
}
