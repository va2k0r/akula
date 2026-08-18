import {
  AdditiveBlending,
  Box3,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  LineSegments,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  Points,
  PointsMaterial,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  TubeGeometry,
  Vector3,
} from "three";
import type { Material, Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  absoluteBearingFromRelative,
  PassiveSonarRing,
} from "./PassiveSonarRing";
import { publicAssetPath } from "./PublicAssetPath";
import type { SubmarineState } from "./SubmarineDynamics";

const AKULA_LENGTH_METERS = 110;
const TRAIL_POINT_COUNT = 260;
const STANDARD_BALLAST_POINT_COUNT = 120;
const MAIN_BALLAST_BLOW_POINT_COUNT = 900;
const BALLAST_POINT_COUNT = MAIN_BALLAST_BLOW_POINT_COUNT;
const CHASE_SONAR_RING_SCALE = 0.56;
const SONAR_RING_VERTICAL_OFFSET = -7.5;
const TAIL_CONTROL_HINGE_X = -17.45;
const TAIL_CONTROL_CENTER_Y = -1.21;
const MAX_RUDDER_ANGLE = 0.46;
const MAX_STERN_PLANE_ANGLE = 0.42;
const PROPELLER_AXIS = new Vector3(1, 0, 0);
const PROPELLER_RESPONSE = 2.8;
const ASCENT_BUBBLE_START_SPEED = 1.05;
const ASCENT_BUBBLE_STOP_SPEED = 0.78;
const ASCENT_BUBBLE_FULL_SPEED = 3.2;

export type BallastBurstKind = "standard" | "main-blow";

export interface BallastBurstProfile {
  readonly particleCount: number;
  readonly emissionDurationSeconds: number;
  readonly particleLifetimeSeconds: number;
  readonly opacity: number;
  readonly pointSize: number;
  readonly hullSpanMeters: number;
  readonly riseSpeedMetersPerSecond: number;
}

const STANDARD_BALLAST_BURST: BallastBurstProfile = {
  particleCount: STANDARD_BALLAST_POINT_COUNT,
  emissionDurationSeconds: 0.42,
  particleLifetimeSeconds: 2.1,
  opacity: 0.58,
  pointSize: 1.55,
  hullSpanMeters: 42,
  riseSpeedMetersPerSecond: 18,
};

const MAIN_BALLAST_BLOW_BURST: BallastBurstProfile = {
  particleCount: MAIN_BALLAST_BLOW_POINT_COUNT,
  emissionDurationSeconds: 1.15,
  particleLifetimeSeconds: 3.1,
  opacity: 0.88,
  pointSize: 2.05,
  hullSpanMeters: 90,
  riseSpeedMetersPerSecond: 17,
};

export function ballastBurstProfile(
  kind: BallastBurstKind,
): BallastBurstProfile {
  return kind === "main-blow"
    ? MAIN_BALLAST_BLOW_BURST
    : STANDARD_BALLAST_BURST;
}

export function ascentBubbleIntensity(
  depthRateMetersPerSecond: number,
  currentlyActive: boolean,
): number {
  const riseSpeed = Math.max(0, -depthRateMetersPerSecond);
  const activationThreshold = currentlyActive
    ? ASCENT_BUBBLE_STOP_SPEED
    : ASCENT_BUBBLE_START_SPEED;
  if (riseSpeed <= activationThreshold) {
    return 0;
  }
  const normalized = MathUtils.clamp(
    (riseSpeed - ASCENT_BUBBLE_STOP_SPEED) /
      (ASCENT_BUBBLE_FULL_SPEED - ASCENT_BUBBLE_STOP_SPEED),
    0,
    1,
  );
  return normalized ** 0.72;
}
const PROPELLER_STOP_EPSILON = 0.02;
const PROPELLER_REGIMES = [
  { throttle: -0.22, rpm: -74 },
  { throttle: 0, rpm: 0 },
  { throttle: 0.16, rpm: 42 },
  { throttle: 0.52, rpm: 112 },
  { throttle: 1, rpm: 220 },
] as const;
const FLANK_PROPELLER_RPM = 220;
const CAVITATION_BLADE_COUNT = 7;
const CAVITATION_SHEET_POINTS_PER_BLADE = 22;
const CAVITATION_VORTEX_POINTS_PER_BLADE = 64;
const CAVITATION_FILAMENT_SEGMENTS_PER_BLADE = 34;
const CAVITATION_FILAMENT_VERTEX_COUNT =
  CAVITATION_BLADE_COUNT * CAVITATION_FILAMENT_SEGMENTS_PER_BLADE * 2;
const CAVITATION_CLOUD_POINT_COUNT = 640;
const CAVITATION_SHEET_POINT_COUNT =
  CAVITATION_BLADE_COUNT * CAVITATION_SHEET_POINTS_PER_BLADE;
const CAVITATION_VORTEX_POINT_COUNT =
  CAVITATION_BLADE_COUNT * CAVITATION_VORTEX_POINTS_PER_BLADE;
const CAVITATION_POINT_COUNT =
  CAVITATION_SHEET_POINT_COUNT +
  CAVITATION_VORTEX_POINT_COUNT +
  CAVITATION_CLOUD_POINT_COUNT;
const TWO_PI = Math.PI * 2;

export class AkulaVehicle {
  public readonly root = new Group();
  private readonly tacticalRoot = new Group();
  private readonly sonarOccluderRoot = new Group();
  private readonly sonarOverlayRoot = new Group();
  private readonly passiveSonarRing: PassiveSonarRing;
  private readonly sonarOccluderMaterial = new MeshBasicMaterial({
    colorWrite: false,
    depthTest: true,
    depthWrite: true,
    side: DoubleSide,
    toneMapped: false,
  });
  private readonly modelAxis = new Group();
  private readonly rudderPivot = new Group();
  private readonly sternPlanesPivot = new Group();
  private readonly propulsionEffectsRoot = new Group();
  private readonly cavitationRibbonRoot = new Group();
  private readonly propellerRestQuaternion = new Quaternion();
  private readonly propellerSpinQuaternion = new Quaternion();
  private readonly trailPositions = new Float32Array(TRAIL_POINT_COUNT * 3);
  private readonly ballastPositions = new Float32Array(BALLAST_POINT_COUNT * 3);
  private readonly ballastGeometry = new BufferGeometry();
  private readonly cavitationPositions = new Float32Array(
    CAVITATION_POINT_COUNT * 3,
  );
  private readonly cavitationSizes = new Float32Array(CAVITATION_POINT_COUNT);
  private readonly cavitationAlphas = new Float32Array(CAVITATION_POINT_COUNT);
  private readonly cavitationFilamentPositions = new Float32Array(
    CAVITATION_FILAMENT_VERTEX_COUNT * 3,
  );
  private readonly cavitationFilamentAlphas = new Float32Array(
    CAVITATION_FILAMENT_VERTEX_COUNT,
  );
  private readonly bubbleTexture = createBubbleTexture();
  private readonly cavitationMaterial = createCavitationMaterial(
    this.bubbleTexture,
  );
  private readonly cavitationFilamentMaterial =
    createCavitationFilamentMaterial();
  private readonly cavitationRibbonMaterial = createCavitationRibbonMaterial();
  private readonly cavitationSheetMaterial = createCavitationSheetMaterial();
  private readonly cavitationSheet = new Mesh(
    // Vapour can briefly overrun the physical tip radius before collapsing.
    // The small overshoot also keeps the seven-blade sheet readable from the
    // normal chase camera without turning it into an oversized exhaust cone.
    new RingGeometry(0.08, 1.2, 128, 1),
    this.cavitationSheetMaterial,
  );
  private readonly trailMaterial = new PointsMaterial({
    color: 0xb7e9ef,
    size: 1.25,
    transparent: true,
    opacity: 0.12,
    map: this.bubbleTexture,
    alphaTest: 0.02,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  private readonly ballastMaterial = new PointsMaterial({
    color: 0xd2f4f5,
    size: 1.55,
    transparent: true,
    opacity: 0,
    map: this.bubbleTexture,
    alphaTest: 0.02,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  private readonly tacticalMarkerMaterial = new MeshBasicMaterial({
    color: 0xb8c59a,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
  });
  private readonly modelMaterials = new Set<Material>();
  private trailAttribute: BufferAttribute | undefined;
  private ballastAttribute: BufferAttribute | undefined;
  private cavitationPositionAttribute: BufferAttribute | undefined;
  private cavitationSizeAttribute: BufferAttribute | undefined;
  private cavitationAlphaAttribute: BufferAttribute | undefined;
  private cavitationFilamentPositionAttribute: BufferAttribute | undefined;
  private cavitationFilamentAlphaAttribute: BufferAttribute | undefined;
  private propeller: Object3D | undefined;
  private propellerAngle = 0;
  private propellerAngularVelocity = 0;
  private propellerRadius = 1.85;
  private readonly propellerEffectOrigin = new Vector3();
  private cavitationAmount = 0;
  private ballastBurstAge = Number.POSITIVE_INFINITY;
  private ballastBurstKind: BallastBurstKind = "standard";
  private ascentBubbleTarget = 0;
  private ascentBubbleAmount = 0;
  private ascentBubbleAge = 0;
  private tacticalAmount = 0;

  public constructor(parent: Object3D, overlayParent: Object3D) {
    this.root.rotation.order = "YXZ";
    this.sonarOccluderRoot.name = "PassiveSonarHullOccluder";
    this.sonarOccluderRoot.rotation.order = "YXZ";
    this.sonarOccluderRoot.visible = false;
    this.propulsionEffectsRoot.name = "PropellerEffects";
    this.root.add(this.modelAxis, this.propulsionEffectsRoot);
    parent.add(this.root, this.tacticalRoot);
    overlayParent.add(this.sonarOccluderRoot, this.sonarOverlayRoot);
    this.createWake();
    this.createTacticalMarker();
    this.passiveSonarRing = new PassiveSonarRing(this.sonarOverlayRoot);

    const navLight = new PointLight(0x8ed8df, 180, 115, 1.85);
    navLight.position.set(0, 8.5, -8);
    const cameraRim = new PointLight(0x5c9fb2, 1_250, 250, 1.72);
    cameraRim.position.set(0, 34, 74);
    this.root.add(navLight, cameraRim);
  }

  public async initialize(): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(
      publicAssetPath("assets/models/akula/akula.glb"),
    );
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(model);
    const center = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    const scale = AKULA_LENGTH_METERS / Math.max(1, size.x);
    model.position.sub(center);
    model.scale.setScalar(scale);
    model.traverse((object) => {
      if (!(object instanceof Mesh)) {
        return;
      }
      object.castShadow = false;
      object.receiveShadow = true;
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) {
        material.transparent = true;
        this.modelMaterials.add(material);
        if (material instanceof MeshStandardMaterial) {
          material.roughness = Math.max(0.48, material.roughness);
          material.metalness = Math.max(0.18, material.metalness);
          material.envMapIntensity = 0.65;
        }
      }
    });

    const hull = model.getObjectByName("Submarine");
    if (!(hull instanceof Mesh)) {
      throw new Error("The Akula hull mesh is missing; cannot rig its rudder.");
    }
    const propeller = model.getObjectByName("Propeller");
    if (propeller === undefined) {
      throw new Error(
        "The Akula propeller mesh is missing; cannot animate it.",
      );
    }
    this.propeller = propeller;
    this.propellerRestQuaternion.copy(propeller.quaternion);
    this.rigSourceTailControls(hull);

    // The source model is authored bow-first on +X. Rotate it into our -Z
    // vehicle convention so camera, dynamics, and control surfaces agree.
    this.modelAxis.rotation.y = Math.PI / 2;
    this.modelAxis.add(model);

    // The sonar ring is composited after the main scene's depth buffer has
    // been cleared. Re-render an exact, colourless copy of the hull into the
    // overlay depth buffer so the far side of the ring cannot show through
    // the submarine. Geometry remains shared with the visible model.
    const sonarHullOccluder = this.modelAxis.clone(true);
    sonarHullOccluder.name = "PassiveSonarHullOccluderGeometry";
    sonarHullOccluder.traverse((object) => {
      if (!(object instanceof Mesh)) {
        return;
      }
      object.material = this.sonarOccluderMaterial;
      object.castShadow = false;
      object.receiveShadow = false;
      object.renderOrder = 40;
    });
    this.sonarOccluderRoot.add(sonarHullOccluder);
    this.sonarOccluderRoot.visible = true;

    // Bind every propulsion effect to the geometric centre of the source
    // propeller. This replaces the old hand-authored wake offset, which sat
    // almost three metres above the shaft.
    this.root.updateWorldMatrix(true, true);
    const propellerBounds = new Box3().setFromObject(propeller);
    const propellerCenter = propellerBounds.getCenter(new Vector3());
    const propellerSize = propellerBounds.getSize(new Vector3());
    this.root.worldToLocal(propellerCenter);
    this.propellerEffectOrigin.copy(propellerCenter);
    this.propulsionEffectsRoot.position.copy(propellerCenter);
    this.propellerRadius = Math.max(propellerSize.x, propellerSize.y) * 0.5;
    this.cavitationSheet.scale.setScalar(this.propellerRadius);
    this.cavitationRibbonRoot.scale.setScalar(this.propellerRadius);
  }

  public update(
    state: SubmarineState,
    elapsedSeconds: number,
    deltaSeconds: number,
  ): void {
    this.root.position.set(state.x, state.y, state.z);
    this.root.rotation.x = state.pitch;
    // Three.js positive yaw turns local -Z toward port. Dynamics uses positive
    // heading for starboard, so the rendered hull must take the opposite sign.
    this.root.rotation.y = -state.heading;
    this.root.rotation.z = state.roll;
    this.sonarOccluderRoot.position.set(state.x, state.y, state.z);
    this.sonarOccluderRoot.rotation.x = state.pitch;
    this.sonarOccluderRoot.rotation.y = -state.heading;
    this.sonarOccluderRoot.rotation.z = state.roll;
    this.tacticalRoot.position.set(state.x, state.y + 16, state.z);
    this.tacticalRoot.rotation.y = -state.heading;
    this.sonarOverlayRoot.position.set(
      state.x,
      state.y + SONAR_RING_VERTICAL_OFFSET,
      state.z,
    );
    // Cardinal bearings belong to the world, not to the hull. Keeping this
    // root unrotated makes 000/090/180/270 absolute in every camera mode.
    this.sonarOverlayRoot.rotation.y = 0;
    this.rudderPivot.rotation.y = -state.rudder * MAX_RUDDER_ANGLE;
    this.sternPlanesPivot.rotation.z = -state.planes * MAX_STERN_PLANE_ANGLE;
    this.updatePropeller(state.propulsionThrottle, deltaSeconds);
    this.updateWake(state, elapsedSeconds, deltaSeconds);

    this.ballastBurstAge += deltaSeconds;
    this.ascentBubbleAmount = MathUtils.damp(
      this.ascentBubbleAmount,
      this.ascentBubbleTarget,
      this.ascentBubbleTarget > this.ascentBubbleAmount ? 5.2 : 2.4,
      deltaSeconds,
    );
    if (this.ascentBubbleTarget > 0 || this.ascentBubbleAmount > 0.003) {
      this.ascentBubbleAge += deltaSeconds;
    } else {
      this.ascentBubbleAge = 0;
      this.ascentBubbleAmount = 0;
    }
    this.updateBallastBubbles(elapsedSeconds);
  }

  public setAscentBubbleIntensity(intensity: number): void {
    const nextTarget = MathUtils.clamp(intensity, 0, 1);
    if (this.ascentBubbleTarget === 0 && nextTarget > 0) {
      this.ascentBubbleAge = 0;
    }
    this.ascentBubbleTarget = nextTarget;
  }

  public burstBallast(): void {
    this.ballastBurstKind = "standard";
    this.ballastBurstAge = 0;
  }

  public burstMainBallastBlow(): void {
    this.ballastBurstKind = "main-blow";
    this.ballastBurstAge = 0;
  }

  public get propellerRotationRadians(): number {
    return this.propellerAngle;
  }

  public get propellerRevolutionsPerMinute(): number {
    return (this.propellerAngularVelocity * 60) / (Math.PI * 2);
  }

  public get propellerCavitationStrength(): number {
    return this.cavitationAmount;
  }

  public get propellerRadiusMeters(): number {
    return this.propellerRadius;
  }

  public get propellerEffectsOrigin(): Readonly<{
    x: number;
    y: number;
    z: number;
  }> {
    return {
      x: this.propellerEffectOrigin.x,
      y: this.propellerEffectOrigin.y,
      z: this.propellerEffectOrigin.z,
    };
  }

  public updatePassiveSonar(
    relativeBearing: number,
    observerHeading: number,
    signalStrength: number,
    ownSpeedMetersPerSecond: number,
    listening: boolean,
    elapsedSeconds: number,
    deltaSeconds: number,
  ): void {
    this.passiveSonarRing.updateSignal(
      absoluteBearingFromRelative(relativeBearing, observerHeading),
      relativeBearing,
      signalStrength,
      ownSpeedMetersPerSecond,
      listening,
      elapsedSeconds,
      deltaSeconds,
    );
  }

  public setTacticalView(amount: number, cameraRangeToOwnship: number): void {
    this.tacticalAmount = MathUtils.clamp(amount, 0, 1);
    const markerAmount = smoothMarkerFade(this.tacticalAmount);
    this.tacticalRoot.visible = markerAmount > 0.002;
    this.tacticalMarkerMaterial.opacity = markerAmount * 0.94;
    this.passiveSonarRing.setViewAmount(this.tacticalAmount);
    // The ownship datum is instrumentation, not a scale model. Growing it in
    // direct proportion to camera altitude keeps the same angular size through
    // the whole pullback and lets it dissolve into the 2D symbol unchanged.
    const markerScale = MathUtils.clamp(cameraRangeToOwnship / 1_800, 0.32, 80);
    const sonarMapScale = MathUtils.clamp(
      cameraRangeToOwnship / 1_800,
      0.32,
      2.4,
    );
    const overlayScale = MathUtils.lerp(
      CHASE_SONAR_RING_SCALE,
      sonarMapScale,
      markerAmount,
    );
    this.tacticalRoot.scale.setScalar(markerScale);
    this.sonarOverlayRoot.scale.set(
      overlayScale,
      Math.min(overlayScale, 1),
      overlayScale,
    );

    const modelOpacity = 1 - smoothModelFade(this.tacticalAmount);
    this.root.visible = modelOpacity > 0.002;
    this.sonarOccluderRoot.visible = modelOpacity > 0.45;
    for (const material of this.modelMaterials) {
      material.opacity = modelOpacity;
      material.depthWrite = modelOpacity > 0.45;
    }
  }

  public dispose(): void {
    this.passiveSonarRing.dispose();
    this.root.traverse((object) => {
      if (object instanceof Mesh || object instanceof Points) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const material of materials) {
          material.dispose();
        }
      }
    });
    this.bubbleTexture.dispose();
    this.sonarOccluderMaterial.dispose();
    this.root.removeFromParent();
    this.tacticalRoot.removeFromParent();
    this.sonarOccluderRoot.removeFromParent();
    this.sonarOverlayRoot.removeFromParent();
  }

  private rigSourceTailControls(hull: Mesh): void {
    const sourceGeometry = hull.geometry;
    const partition = partitionAkulaTailGeometry(sourceGeometry);
    const controlsParent = hull.parent;
    if (controlsParent === null) {
      partition.fixed.dispose();
      partition.rudders.dispose();
      partition.sternPlanes.dispose();
      throw new Error("The source Akula hull has no tail-control parent.");
    }

    sourceGeometry.dispose();
    hull.geometry = partition.fixed;

    // The source hull node carries a non-uniform correction scale. Bake that
    // local transform into the detached meshes and hinge coordinates, then
    // animate them beside the hull. Rotating them below the scaled hull node
    // would stretch and shear the surfaces as they deflect.
    hull.updateMatrix();
    partition.rudders.applyMatrix4(hull.matrix);
    partition.sternPlanes.applyMatrix4(hull.matrix);

    const rudderHinge = new Vector3(
      TAIL_CONTROL_HINGE_X,
      TAIL_CONTROL_CENTER_Y,
      0,
    ).applyMatrix4(hull.matrix);
    this.rudderPivot.name = "TailRudderHinge";
    this.rudderPivot.position.copy(rudderHinge);
    const rudders = new Mesh(partition.rudders, hull.material);
    rudders.name = "SourceTailRuddersAnimated";
    rudders.position.copy(rudderHinge).multiplyScalar(-1);
    rudders.castShadow = false;
    rudders.receiveShadow = true;
    this.rudderPivot.add(rudders);

    const sternPlanesHinge = new Vector3(
      TAIL_CONTROL_HINGE_X,
      TAIL_CONTROL_CENTER_Y,
      0,
    ).applyMatrix4(hull.matrix);
    this.sternPlanesPivot.name = "SternPlanesHinge";
    this.sternPlanesPivot.position.copy(sternPlanesHinge);
    const sternPlanes = new Mesh(partition.sternPlanes, hull.material);
    sternPlanes.name = "SourceSternPlanesAnimated";
    sternPlanes.position.copy(sternPlanesHinge).multiplyScalar(-1);
    sternPlanes.castShadow = false;
    sternPlanes.receiveShadow = true;
    this.sternPlanesPivot.add(sternPlanes);

    controlsParent.add(this.rudderPivot, this.sternPlanesPivot);
  }

  private updatePropeller(throttle: number, deltaSeconds: number): void {
    const targetAngularVelocity = propellerAngularVelocity(throttle);
    this.propellerAngularVelocity = MathUtils.damp(
      this.propellerAngularVelocity,
      targetAngularVelocity,
      PROPELLER_RESPONSE,
      deltaSeconds,
    );
    if (
      targetAngularVelocity === 0 &&
      Math.abs(this.propellerAngularVelocity) < PROPELLER_STOP_EPSILON
    ) {
      this.propellerAngularVelocity = 0;
    }
    this.propellerAngle = MathUtils.euclideanModulo(
      this.propellerAngle + this.propellerAngularVelocity * deltaSeconds,
      Math.PI * 2,
    );
    if (this.propeller === undefined) {
      return;
    }
    this.propellerSpinQuaternion.setFromAxisAngle(
      PROPELLER_AXIS,
      this.propellerAngle,
    );
    this.propeller.quaternion
      .copy(this.propellerRestQuaternion)
      .multiply(this.propellerSpinQuaternion);
  }

  private createWake(): void {
    this.cavitationSheet.name = "PropellerSheetCavitation";
    this.cavitationSheet.visible = false;
    this.cavitationSheet.frustumCulled = false;
    this.cavitationSheet.renderOrder = 5;
    this.cavitationSheet.position.z = 0.12;
    this.propulsionEffectsRoot.add(this.cavitationSheet);

    const trailGeometry = new BufferGeometry();
    this.trailAttribute = new BufferAttribute(this.trailPositions, 3);
    this.trailAttribute.setUsage(DynamicDrawUsage);
    trailGeometry.setAttribute("position", this.trailAttribute);
    const trail = new Points(trailGeometry, this.trailMaterial);
    trail.name = "PropellerWash";
    trail.frustumCulled = false;
    this.propulsionEffectsRoot.add(trail);

    const cavitationGeometry = new BufferGeometry();
    this.cavitationPositionAttribute = new BufferAttribute(
      this.cavitationPositions,
      3,
    );
    this.cavitationSizeAttribute = new BufferAttribute(this.cavitationSizes, 1);
    this.cavitationAlphaAttribute = new BufferAttribute(
      this.cavitationAlphas,
      1,
    );
    this.cavitationPositionAttribute.setUsage(DynamicDrawUsage);
    this.cavitationSizeAttribute.setUsage(DynamicDrawUsage);
    this.cavitationAlphaAttribute.setUsage(DynamicDrawUsage);
    cavitationGeometry.setAttribute(
      "position",
      this.cavitationPositionAttribute,
    );
    cavitationGeometry.setAttribute("aSize", this.cavitationSizeAttribute);
    cavitationGeometry.setAttribute("aAlpha", this.cavitationAlphaAttribute);
    const cavitation = new Points(cavitationGeometry, this.cavitationMaterial);
    cavitation.name = "BladeTipCavitation";
    cavitation.frustumCulled = false;
    cavitation.renderOrder = 6;
    this.propulsionEffectsRoot.add(cavitation);

    const filamentGeometry = new BufferGeometry();
    this.cavitationFilamentPositionAttribute = new BufferAttribute(
      this.cavitationFilamentPositions,
      3,
    );
    this.cavitationFilamentAlphaAttribute = new BufferAttribute(
      this.cavitationFilamentAlphas,
      1,
    );
    this.cavitationFilamentPositionAttribute.setUsage(DynamicDrawUsage);
    this.cavitationFilamentAlphaAttribute.setUsage(DynamicDrawUsage);
    filamentGeometry.setAttribute(
      "position",
      this.cavitationFilamentPositionAttribute,
    );
    filamentGeometry.setAttribute(
      "aAlpha",
      this.cavitationFilamentAlphaAttribute,
    );
    const filaments = new LineSegments(
      filamentGeometry,
      this.cavitationFilamentMaterial,
    );
    filaments.name = "BladeTipVortexFilaments";
    filaments.frustumCulled = false;
    filaments.renderOrder = 7;
    this.propulsionEffectsRoot.add(filaments);

    const ribbonGeometry = createCavitationRibbonGeometry();
    this.cavitationRibbonRoot.name = "BladeTipVapourRibbons";
    this.cavitationRibbonRoot.visible = false;
    for (let blade = 0; blade < CAVITATION_BLADE_COUNT; blade += 1) {
      const ribbon = new Mesh(ribbonGeometry, this.cavitationRibbonMaterial);
      ribbon.rotation.z = blade * (TWO_PI / CAVITATION_BLADE_COUNT);
      ribbon.frustumCulled = false;
      ribbon.renderOrder = 7;
      this.cavitationRibbonRoot.add(ribbon);
    }
    this.propulsionEffectsRoot.add(this.cavitationRibbonRoot);

    this.ballastAttribute = new BufferAttribute(this.ballastPositions, 3);
    this.ballastAttribute.setUsage(DynamicDrawUsage);
    this.ballastGeometry.setAttribute("position", this.ballastAttribute);
    this.ballastGeometry.setDrawRange(0, 0);
    const ballast = new Points(this.ballastGeometry, this.ballastMaterial);
    ballast.frustumCulled = false;
    this.root.add(ballast);
  }

  private createTacticalMarker(): void {
    const courseLine = new Shape();
    courseLine.moveTo(-0.65, 0);
    courseLine.lineTo(0.65, 0);
    courseLine.lineTo(0.65, 34);
    courseLine.lineTo(-0.65, 34);
    courseLine.closePath();
    const markerParts = [
      new Mesh(new RingGeometry(4.1, 5.2, 64), this.tacticalMarkerMaterial),
      new Mesh(new RingGeometry(7, 8.1, 64), this.tacticalMarkerMaterial),
      new Mesh(new ShapeGeometry(courseLine), this.tacticalMarkerMaterial),
    ];
    for (const markerPart of markerParts) {
      markerPart.rotation.x = -Math.PI / 2;
      markerPart.renderOrder = 40;
      this.tacticalRoot.add(markerPart);
    }
    this.tacticalRoot.visible = false;
  }

  private updateWake(
    state: SubmarineState,
    elapsedSeconds: number,
    deltaSeconds: number,
  ): void {
    const speedFraction = MathUtils.clamp(
      Math.abs(state.speedMetersPerSecond) / 15.8,
      0,
      1,
    );
    const shaftFraction = MathUtils.clamp(
      Math.abs(this.propellerRevolutionsPerMinute) / FLANK_PROPELLER_RPM,
      0,
      1,
    );
    const washDirection = state.propulsionThrottle < -0.05 ? -1 : 1;
    const wakeLength = MathUtils.lerp(10, 82, shaftFraction);
    for (let index = 0; index < TRAIL_POINT_COUNT; index += 1) {
      const seed = pseudoRandom(index * 5 + 1);
      const progression = MathUtils.euclideanModulo(
        seed + elapsedSeconds * (0.075 + shaftFraction * 0.24),
        1,
      );
      const spread =
        0.22 +
        progression *
          (1.4 + shaftFraction * 5.2 + Math.abs(state.rudder) * 3.5);
      const angle =
        pseudoRandom(index * 5 + 2) * TWO_PI +
        this.propellerAngle * 0.08 -
        progression * TWO_PI * (0.45 + shaftFraction * 1.2);
      this.trailPositions[index * 3] = Math.cos(angle) * spread;
      this.trailPositions[index * 3 + 1] =
        Math.sin(angle) * spread * 0.68 + state.depthRate * progression * 0.35;
      this.trailPositions[index * 3 + 2] =
        washDirection * (0.15 + progression * wakeLength);
    }
    if (this.trailAttribute !== undefined) {
      this.trailAttribute.needsUpdate = true;
    }
    this.trailMaterial.opacity =
      (speedFraction * speedFraction * 0.018 +
        shaftFraction * shaftFraction * 0.105) *
      (1 - this.tacticalAmount) *
      (1 - this.cavitationAmount * 0.45);
    this.trailMaterial.size = 0.55 + shaftFraction * 1.15;

    this.updateCavitation(state, elapsedSeconds, deltaSeconds);
  }

  private updateCavitation(
    state: SubmarineState,
    elapsedSeconds: number,
    deltaSeconds: number,
  ): void {
    const target = cavitationStrength(
      state.propulsionThrottle,
      this.propellerRevolutionsPerMinute,
      Math.max(0, -state.y),
    );
    this.cavitationAmount = MathUtils.damp(
      this.cavitationAmount,
      target,
      target > this.cavitationAmount ? 4.8 : 2.15,
      deltaSeconds,
    );
    if (target === 0 && this.cavitationAmount < 0.001) {
      this.cavitationAmount = 0;
    }

    const pulse = MathUtils.clamp(
      0.82 +
        Math.sin(elapsedSeconds * 13.7) * 0.11 +
        Math.sin(elapsedSeconds * 31.1 + 1.4) * 0.07,
      0.62,
      1,
    );
    const opacityUniform = this.cavitationMaterial.uniforms["uOpacity"];
    if (opacityUniform !== undefined) {
      opacityUniform.value =
        this.cavitationAmount * (1 - this.tacticalAmount) * pulse * 1.05;
    }
    const filamentOpacityUniform =
      this.cavitationFilamentMaterial.uniforms["uOpacity"];
    if (filamentOpacityUniform !== undefined) {
      filamentOpacityUniform.value =
        this.cavitationAmount *
        (1 - this.tacticalAmount) *
        (0.62 + pulse * 0.26);
    }
    const ribbonOpacityUniform =
      this.cavitationRibbonMaterial.uniforms["uOpacity"];
    if (ribbonOpacityUniform !== undefined) {
      ribbonOpacityUniform.value =
        this.cavitationAmount *
        (1 - this.tacticalAmount) *
        (0.55 + pulse * 0.3);
    }
    const ribbonTimeUniform = this.cavitationRibbonMaterial.uniforms["uTime"];
    if (ribbonTimeUniform !== undefined) {
      ribbonTimeUniform.value = elapsedSeconds;
    }
    const sheetOpacityUniform =
      this.cavitationSheetMaterial.uniforms["uOpacity"];
    if (sheetOpacityUniform !== undefined) {
      sheetOpacityUniform.value =
        this.cavitationAmount *
        (1 - this.tacticalAmount) *
        (0.54 + pulse * 0.24);
    }
    const sheetTimeUniform = this.cavitationSheetMaterial.uniforms["uTime"];
    if (sheetTimeUniform !== undefined) {
      sheetTimeUniform.value = elapsedSeconds;
    }
    this.cavitationSheet.visible = this.cavitationAmount > 0.002;
    this.cavitationSheet.rotation.z = -this.propellerAngle;
    this.cavitationRibbonRoot.visible = this.cavitationAmount > 0.002;
    this.cavitationRibbonRoot.rotation.z = this.propellerAngle;
    if (this.cavitationAmount <= 0.0001) {
      return;
    }

    this.updateCavitationFilaments(elapsedSeconds);

    let pointIndex = 0;
    const bladeSpacing = TWO_PI / CAVITATION_BLADE_COUNT;

    // Sheet cavitation: a thin, unstable film remains attached to each blade
    // before it sheds at the tip. The points follow the real propeller phase.
    for (let blade = 0; blade < CAVITATION_BLADE_COUNT; blade += 1) {
      for (
        let sample = 0;
        sample < CAVITATION_SHEET_POINTS_PER_BLADE;
        sample += 1
      ) {
        const seed = pseudoRandom(blade * 97 + sample * 13 + 11);
        const radialProgress =
          (sample + 0.35 + pseudoRandom(blade * 31 + sample + 5) * 0.3) /
          CAVITATION_SHEET_POINTS_PER_BLADE;
        const radius = this.propellerRadius * (0.16 + radialProgress * 0.84);
        const angle =
          this.propellerAngle +
          blade * bladeSpacing +
          radialProgress * radialProgress * 0.43 +
          (seed - 0.5) * 0.075;
        const localPulse =
          0.72 +
          Math.max(0, Math.sin(elapsedSeconds * (18 + seed * 9) + seed * 19)) *
            0.48;
        this.setCavitationPoint(
          pointIndex,
          Math.cos(angle) * radius,
          Math.sin(angle) * radius,
          0.04 + radialProgress * 1.25 + seed * 0.28,
          0.16 + radialProgress * 0.44,
          (0.2 + radialProgress * 0.38) * localPulse,
        );
        pointIndex += 1;
      }
    }

    // Seven coherent tip vortices preserve the blade count near the disk,
    // then widen and break down as ambient pressure collapses the vapour.
    for (let blade = 0; blade < CAVITATION_BLADE_COUNT; blade += 1) {
      for (
        let sample = 0;
        sample < CAVITATION_VORTEX_POINTS_PER_BLADE;
        sample += 1
      ) {
        const seed = pseudoRandom(blade * 71 + sample * 17 + 101);
        const progression = MathUtils.euclideanModulo(
          sample / CAVITATION_VORTEX_POINTS_PER_BLADE +
            elapsedSeconds * (0.31 + seed * 0.045),
          1,
        );
        const breakup = MathUtils.smoothstep(progression, 0.5, 1);
        const ageSeconds = progression * 1.22;
        const angle =
          this.propellerAngle +
          blade * bladeSpacing -
          this.propellerAngularVelocity * ageSeconds * 0.34 +
          Math.sin(elapsedSeconds * 4.7 + seed * 23) * breakup * 0.2;
        const radius =
          this.propellerRadius * (1 + progression * 0.2) * (1 - breakup * 0.43);
        const turbulence = (seed - 0.5) * breakup * 3.4;
        const fade = 1 - MathUtils.smoothstep(progression, 0.68, 1);
        this.setCavitationPoint(
          pointIndex,
          Math.cos(angle) * radius + turbulence,
          Math.sin(angle) * radius +
            (pseudoRandom(blade * 53 + sample * 7 + 19) - 0.5) * breakup * 2.4 +
            progression * progression * 0.7,
          0.28 + progression * 32,
          0.5 + progression * 1.45,
          fade * (0.85 + seed * 0.65),
        );
        pointIndex += 1;
      }
    }

    // The cinematic cloud is the collapsed-vapour aftermath: larger,
    // irregular pockets, still narrow at the propeller and buoyant downstream.
    for (let sample = 0; sample < CAVITATION_CLOUD_POINT_COUNT; sample += 1) {
      const seed = pseudoRandom(sample * 29 + 401);
      const radialSeed = pseudoRandom(sample * 47 + 607);
      const transportProgress = MathUtils.euclideanModulo(
        seed + elapsedSeconds * (0.13 + radialSeed * 0.075),
        1,
      );
      const progression = transportProgress * transportProgress;
      const collapse = MathUtils.smoothstep(progression, 0.52, 1);
      const cloudRadius =
        (this.propellerRadius * 0.34 + progression * 6.5) *
        (1 - collapse * 0.32);
      const radius = Math.sqrt(radialSeed) * cloudRadius;
      const angle =
        pseudoRandom(sample * 61 + 811) * TWO_PI +
        elapsedSeconds * (1.65 - progression * 1.2) +
        Math.sin(elapsedSeconds * 3.1 + seed * 17) * progression * 0.45;
      const pocket = Math.pow(
        0.5 + 0.5 * Math.sin(elapsedSeconds * 11.3 + seed * 31),
        2,
      );
      const fade = 1 - MathUtils.smoothstep(progression, 0.76, 1);
      this.setCavitationPoint(
        pointIndex,
        Math.cos(angle) * radius,
        Math.sin(angle) * radius + progression * progression * 3.4,
        0.18 + progression * 50,
        (0.38 + progression * 1.8) * (0.7 + radialSeed * 0.6),
        fade * (0.7 + seed * 0.55 + pocket * 0.4),
      );
      pointIndex += 1;
    }

    if (this.cavitationPositionAttribute !== undefined) {
      this.cavitationPositionAttribute.needsUpdate = true;
    }
    if (this.cavitationSizeAttribute !== undefined) {
      this.cavitationSizeAttribute.needsUpdate = true;
    }
    if (this.cavitationAlphaAttribute !== undefined) {
      this.cavitationAlphaAttribute.needsUpdate = true;
    }
  }

  private updateCavitationFilaments(elapsedSeconds: number): void {
    const bladeSpacing = TWO_PI / CAVITATION_BLADE_COUNT;
    let vertexIndex = 0;
    for (let blade = 0; blade < CAVITATION_BLADE_COUNT; blade += 1) {
      for (
        let segment = 0;
        segment < CAVITATION_FILAMENT_SEGMENTS_PER_BLADE;
        segment += 1
      ) {
        for (let endpoint = 0; endpoint < 2; endpoint += 1) {
          const progression =
            (segment + endpoint) / CAVITATION_FILAMENT_SEGMENTS_PER_BLADE;
          const breakup = MathUtils.smoothstep(progression, 0.56, 1);
          const ageSeconds = progression * 1.08;
          const phase =
            this.propellerAngle +
            blade * bladeSpacing -
            this.propellerAngularVelocity * ageSeconds * 0.315;
          const radius =
            this.propellerRadius *
            (1.025 + progression * 0.2) *
            (1 - breakup * 0.42);
          const instability =
            Math.sin(elapsedSeconds * 8.3 + blade * 2.17 + progression * 21.4) *
            breakup *
            0.42;
          const fade = 1 - MathUtils.smoothstep(progression, 0.66, 1);
          const shimmer =
            0.68 +
            0.32 *
              Math.sin(
                elapsedSeconds * 17.7 + blade * 1.73 - progression * 28.5,
              );
          this.cavitationFilamentPositions[vertexIndex * 3] =
            Math.cos(phase) * radius + instability;
          this.cavitationFilamentPositions[vertexIndex * 3 + 1] =
            Math.sin(phase) * radius +
            progression * progression * 0.85 +
            instability * 0.62;
          this.cavitationFilamentPositions[vertexIndex * 3 + 2] =
            0.2 + progression * 34;
          this.cavitationFilamentAlphas[vertexIndex] = MathUtils.clamp(
            fade * shimmer,
            0,
            1,
          );
          vertexIndex += 1;
        }
      }
    }
    if (this.cavitationFilamentPositionAttribute !== undefined) {
      this.cavitationFilamentPositionAttribute.needsUpdate = true;
    }
    if (this.cavitationFilamentAlphaAttribute !== undefined) {
      this.cavitationFilamentAlphaAttribute.needsUpdate = true;
    }
  }

  private setCavitationPoint(
    index: number,
    x: number,
    y: number,
    z: number,
    size: number,
    alpha: number,
  ): void {
    this.cavitationPositions[index * 3] = x;
    this.cavitationPositions[index * 3 + 1] = y;
    this.cavitationPositions[index * 3 + 2] = z;
    this.cavitationSizes[index] = size;
    this.cavitationAlphas[index] = MathUtils.clamp(alpha, 0, 1);
  }

  private updateBallastBubbles(elapsedSeconds: number): void {
    if (this.ascentBubbleAmount > 0.003) {
      this.updateAscentBubbles(elapsedSeconds);
      return;
    }
    const profile = ballastBurstProfile(this.ballastBurstKind);
    const burstDuration =
      profile.emissionDurationSeconds + profile.particleLifetimeSeconds;
    const fadeStart = profile.emissionDurationSeconds * 0.72;
    const active = MathUtils.clamp(
      1 -
        Math.max(0, this.ballastBurstAge - fadeStart) /
          (burstDuration - fadeStart),
      0,
      1,
    );
    const visiblePointCount = active > 0 ? profile.particleCount : 0;
    this.ballastGeometry.setDrawRange(0, visiblePointCount);
    this.ballastMaterial.opacity =
      active * profile.opacity * (1 - this.tacticalAmount);
    this.ballastMaterial.size = profile.pointSize;
    for (let index = 0; index < visiblePointCount; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const emissionSeed = pseudoRandom(index + 140);
      const emissionDelay =
        emissionSeed * emissionSeed * profile.emissionDurationSeconds;
      const age = this.ballastBurstAge - emissionDelay;
      if (age < 0 || age > profile.particleLifetimeSeconds) {
        this.ballastPositions[index * 3] = 0;
        this.ballastPositions[index * 3 + 1] = -10_000;
        this.ballastPositions[index * 3 + 2] = 0;
        continue;
      }
      const spread = 0.35 + age * 1.15;
      const swirl = elapsedSeconds * 2.2 + index * 1.71;
      this.ballastPositions[index * 3] =
        side * (5.1 + pseudoRandom(index) * 2.8) + Math.sin(swirl) * spread;
      this.ballastPositions[index * 3 + 1] =
        2.5 +
        age * profile.riseSpeedMetersPerSecond +
        Math.sin(index * 0.63) * age * 0.9;
      this.ballastPositions[index * 3 + 2] =
        -profile.hullSpanMeters * 0.5 +
        pseudoRandom(index + 30) * profile.hullSpanMeters +
        Math.cos(swirl * 0.81) * spread * 0.72;
    }
    if (this.ballastAttribute !== undefined) {
      this.ballastAttribute.needsUpdate = true;
    }
  }

  private updateAscentBubbles(elapsedSeconds: number): void {
    const intensity = MathUtils.clamp(this.ascentBubbleAmount, 0, 1);
    const visiblePointCount = Math.round(
      MathUtils.lerp(
        STANDARD_BALLAST_POINT_COUNT,
        BALLAST_POINT_COUNT,
        intensity,
      ),
    );
    const hullSpan = MathUtils.lerp(48, 90, intensity);
    const opacityFade = MathUtils.smoothstep(intensity, 0, 0.12);
    this.ballastGeometry.setDrawRange(0, visiblePointCount);
    this.ballastMaterial.opacity =
      opacityFade *
      MathUtils.lerp(0.24, 0.88, intensity) *
      (1 - this.tacticalAmount);
    this.ballastMaterial.size = MathUtils.lerp(1.45, 2.05, intensity);

    for (let index = 0; index < visiblePointCount; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const emissionSeed = pseudoRandom(index + 140);
      const emissionDelay = emissionSeed * emissionSeed * 0.9;
      if (this.ascentBubbleAge < emissionDelay) {
        this.ballastPositions[index * 3] = 0;
        this.ballastPositions[index * 3 + 1] = -10_000;
        this.ballastPositions[index * 3 + 2] = 0;
        continue;
      }
      const lifetime = 2.25 + pseudoRandom(index + 370) * 0.95;
      const age = MathUtils.euclideanModulo(
        this.ascentBubbleAge - emissionDelay,
        lifetime,
      );
      const spread = 0.32 + age * MathUtils.lerp(0.82, 1.35, intensity);
      const swirl = elapsedSeconds * (2 + intensity * 0.8) + index * 1.71;
      this.ballastPositions[index * 3] =
        side * (5.1 + pseudoRandom(index) * 2.8) + Math.sin(swirl) * spread;
      this.ballastPositions[index * 3 + 1] =
        2.5 +
        age * MathUtils.lerp(14, 19, intensity) +
        Math.sin(index * 0.63) * age * 0.9;
      this.ballastPositions[index * 3 + 2] =
        -hullSpan * 0.5 +
        pseudoRandom(index + 30) * hullSpan +
        Math.cos(swirl * 0.81) * spread * 0.72;
    }
    if (this.ballastAttribute !== undefined) {
      this.ballastAttribute.needsUpdate = true;
    }
  }
}

function smoothMarkerFade(amount: number): number {
  const normalized = MathUtils.clamp((amount - 0.14) / 0.5, 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function smoothModelFade(amount: number): number {
  const normalized = MathUtils.clamp((amount - 0.08) / 0.58, 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

export interface AkulaTailGeometryPartition {
  readonly fixed: BufferGeometry;
  readonly rudders: BufferGeometry;
  readonly sternPlanes: BufferGeometry;
  readonly fixedTriangleCount: number;
  readonly rudderTriangleCount: number;
  readonly sternPlaneTriangleCount: number;
}

interface TailComponentBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

type TailComponentKind = "fixed" | "rudder" | "stern-plane";

/**
 * The source GLB merged every hull part into one indexed mesh, but its four
 * all-moving stern surfaces are still separate connected components. Extract
 * those complete components instead of cutting with a centroid threshold:
 * a threshold leaves parts of each surface in the fixed hull and makes the
 * animated copy look doubled as soon as it deflects.
 */
export function partitionAkulaTailGeometry(
  source: BufferGeometry,
): AkulaTailGeometryPartition {
  const position = source.getAttribute("position");
  const sourceIndex = source.getIndex();
  if (position === undefined || sourceIndex === null) {
    throw new Error("The Akula hull needs indexed position geometry.");
  }

  const triangleCount = sourceIndex.count / 3;
  if (!Number.isInteger(triangleCount)) {
    throw new Error(
      "The Akula hull index does not contain complete triangles.",
    );
  }

  const parent = new Uint32Array(triangleCount);
  const rank = new Uint8Array(triangleCount);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    parent[triangle] = triangle;
  }

  const findRoot = (triangle: number): number => {
    let root = triangle;
    while (parent[root] !== root) {
      root = parent[root] ?? root;
    }
    let current = triangle;
    while (parent[current] !== current) {
      const next = parent[current] ?? root;
      parent[current] = root;
      current = next;
    }
    return root;
  };
  const join = (first: number, second: number): void => {
    let firstRoot = findRoot(first);
    let secondRoot = findRoot(second);
    if (firstRoot === secondRoot) {
      return;
    }
    if ((rank[firstRoot] ?? 0) < (rank[secondRoot] ?? 0)) {
      [firstRoot, secondRoot] = [secondRoot, firstRoot];
    }
    parent[secondRoot] = firstRoot;
    if (rank[firstRoot] === rank[secondRoot]) {
      rank[firstRoot] = (rank[firstRoot] ?? 0) + 1;
    }
  };

  // UV and normal seams duplicate vertex indices. Weld only for connectivity,
  // at sub-millimetre source precision, while retaining the untouched source
  // vertices and attributes in the three output geometries.
  const ownerByPosition = new Map<string, number>();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = sourceIndex.getX(triangle * 3 + corner);
      const key = quantizedPositionKey(
        position.getX(vertex),
        position.getY(vertex),
        position.getZ(vertex),
      );
      const owner = ownerByPosition.get(key);
      if (owner === undefined) {
        ownerByPosition.set(key, triangle);
      } else {
        join(triangle, owner);
      }
    }
  }

  const boundsByRoot = new Map<number, TailComponentBounds>();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const root = findRoot(triangle);
    let bounds = boundsByRoot.get(root);
    if (bounds === undefined) {
      bounds = {
        minX: Number.POSITIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        minZ: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
        maxZ: Number.NEGATIVE_INFINITY,
      };
      boundsByRoot.set(root, bounds);
    }
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = sourceIndex.getX(triangle * 3 + corner);
      const x = position.getX(vertex);
      const y = position.getY(vertex);
      const z = position.getZ(vertex);
      bounds.minX = Math.min(bounds.minX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.minZ = Math.min(bounds.minZ, z);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.maxY = Math.max(bounds.maxY, y);
      bounds.maxZ = Math.max(bounds.maxZ, z);
    }
  }

  const kindByRoot = new Map<number, TailComponentKind>();
  let rudderComponentCount = 0;
  let sternPlaneComponentCount = 0;
  for (const [root, bounds] of boundsByRoot) {
    let kind: TailComponentKind = "fixed";
    if (isSourceTailRudder(bounds)) {
      kind = "rudder";
      rudderComponentCount += 1;
    } else if (isSourceSternPlane(bounds)) {
      kind = "stern-plane";
      sternPlaneComponentCount += 1;
    }
    kindByRoot.set(root, kind);
  }

  if (rudderComponentCount !== 2 || sternPlaneComponentCount !== 2) {
    throw new Error(
      `Expected two Akula tail rudders and two stern planes; found ${rudderComponentCount} and ${sternPlaneComponentCount}.`,
    );
  }

  const fixedIndices: number[] = [];
  const rudderIndices: number[] = [];
  const sternPlaneIndices: number[] = [];
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const root = findRoot(triangle);
    const kind = kindByRoot.get(root) ?? "fixed";
    const target =
      kind === "rudder"
        ? rudderIndices
        : kind === "stern-plane"
          ? sternPlaneIndices
          : fixedIndices;
    const offset = triangle * 3;
    target.push(
      sourceIndex.getX(offset),
      sourceIndex.getX(offset + 1),
      sourceIndex.getX(offset + 2),
    );
  }

  return {
    fixed: geometryWithIndices(source, fixedIndices),
    rudders: geometryWithIndices(source, rudderIndices),
    sternPlanes: geometryWithIndices(source, sternPlaneIndices),
    fixedTriangleCount: fixedIndices.length / 3,
    rudderTriangleCount: rudderIndices.length / 3,
    sternPlaneTriangleCount: sternPlaneIndices.length / 3,
  };
}

function quantizedPositionKey(x: number, y: number, z: number): string {
  return `${Math.round(x * 10_000)},${Math.round(y * 10_000)},${Math.round(z * 10_000)}`;
}

function isSourceTailRudder(bounds: TailComponentBounds): boolean {
  return (
    bounds.minX < -17.4 &&
    bounds.maxX < -14.3 &&
    bounds.maxX - bounds.minX > 2.8 &&
    bounds.maxY - bounds.minY > 2.4 &&
    bounds.maxZ - bounds.minZ < 0.55
  );
}

function isSourceSternPlane(bounds: TailComponentBounds): boolean {
  const entirelyStarboard = bounds.minZ > 0.45 && bounds.maxZ > 4;
  const entirelyPort = bounds.maxZ < -0.45 && bounds.minZ < -4;
  return (
    bounds.minX < -17.4 &&
    bounds.maxX < -14.3 &&
    bounds.maxX - bounds.minX > 2.8 &&
    bounds.maxY - bounds.minY < 0.55 &&
    (entirelyStarboard || entirelyPort)
  );
}

function geometryWithIndices(
  source: BufferGeometry,
  indices: readonly number[],
): BufferGeometry {
  const indexedSelection = source.clone();
  indexedSelection.setIndex([...indices]);
  indexedSelection.clearGroups();
  indexedSelection.addGroup(0, indices.length, 0);
  // Compact the attributes as well as the draw index. This guarantees that
  // the fixed hull no longer contains even unused copies of the articulated
  // vertices, and gives every moving mesh its true culling bounds.
  const geometry = indexedSelection.toNonIndexed();
  indexedSelection.dispose();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function pseudoRandom(seed: number): number {
  const value = Math.sin(seed * 91.133 + 7.17) * 12_749.42;
  return value - Math.floor(value);
}

export function propellerAngularVelocity(throttle: number): number {
  return (propellerRpm(throttle) * TWO_PI) / 60;
}

export function propellerRpm(throttle: number): number {
  const normalizedThrottle = MathUtils.clamp(throttle, -1, 1);
  const firstRegime = PROPELLER_REGIMES[0];
  if (firstRegime === undefined || normalizedThrottle <= firstRegime.throttle) {
    return firstRegime?.rpm ?? 0;
  }
  for (let index = 1; index < PROPELLER_REGIMES.length; index += 1) {
    const next = PROPELLER_REGIMES[index];
    const previous = PROPELLER_REGIMES[index - 1];
    if (
      next !== undefined &&
      previous !== undefined &&
      normalizedThrottle <= next.throttle
    ) {
      const amount =
        (normalizedThrottle - previous.throttle) /
        (next.throttle - previous.throttle);
      return MathUtils.lerp(previous.rpm, next.rpm, amount);
    }
  }
  return PROPELLER_REGIMES.at(-1)?.rpm ?? 0;
}

export function cavitationStrength(
  throttle: number,
  propellerRpmValue: number,
  depthMeters: number,
): number {
  const flankLoad = MathUtils.smoothstep(throttle, 0.78, 1);
  const shaftOnset = MathUtils.smoothstep(
    Math.abs(propellerRpmValue) / FLANK_PROPELLER_RPM,
    0.72,
    0.94,
  );
  // Hydrostatic pressure delays and shortens vapour formation with depth, but
  // FLANK remains legible at patrol depths for the game's visual language.
  const pressureSuppression = MathUtils.lerp(
    1,
    0.58,
    MathUtils.clamp((depthMeters - 12) / 190, 0, 1),
  );
  return flankLoad * shaftOnset * pressureSuppression;
}

function createCavitationMaterial(texture: CanvasTexture): ShaderMaterial {
  return new ShaderMaterial({
    name: "AKULA blade-tip cavitation",
    uniforms: {
      uMap: { value: texture },
      uColor: { value: new Color(0xdcfaff) },
      uOpacity: { value: 0 },
    },
    vertexShader: `
      attribute float aSize;
      attribute float aAlpha;
      varying float vAlpha;

      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        float perspective = 440.0 / max(1.0, -viewPosition.z);
        gl_PointSize = clamp(aSize * perspective, 1.0, 28.0);
        gl_Position = projectionMatrix * viewPosition;
        vAlpha = aAlpha;
      }
    `,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vAlpha;

      void main() {
        vec4 sprite = texture2D(uMap, gl_PointCoord);
        float alpha = sprite.a * vAlpha * uOpacity;
        if (alpha < 0.008) discard;
        vec3 scatteredLight = uColor * mix(0.72, 1.16, vAlpha);
        gl_FragColor = vec4(scatteredLight, alpha);
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
}

function createCavitationFilamentMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: "AKULA blade-tip vortex filaments",
    uniforms: {
      // Deliberately HDR so the thin physical filaments catch the restrained
      // scene bloom instead of disappearing against deep water.
      uColor: { value: new Color(0xbceff7).multiplyScalar(1.8) },
      uOpacity: { value: 0 },
    },
    vertexShader: `
      attribute float aAlpha;
      varying float vAlpha;

      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        vAlpha = aAlpha;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vAlpha;

      void main() {
        float alpha = vAlpha * uOpacity;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
}

function createCavitationRibbonGeometry(): TubeGeometry {
  const path: Vector3[] = [];
  const pathSamples = 56;
  for (let sample = 0; sample <= pathSamples; sample += 1) {
    const progression = sample / pathSamples;
    const breakup = MathUtils.smoothstep(progression, 0.56, 1);
    const phase = -progression * TWO_PI * 1.28;
    const radius = (1.025 + progression * 0.2) * (1 - breakup * 0.42);
    path.push(
      new Vector3(
        Math.cos(phase) * radius,
        Math.sin(phase) * radius + progression * progression * 0.46,
        0.1 + progression * 18.4,
      ),
    );
  }
  return new TubeGeometry(new CatmullRomCurve3(path), 88, 0.16, 5, false);
}

function createCavitationRibbonMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: "AKULA cinematic vapour ribbons",
    uniforms: {
      uColor: { value: new Color(0xaeeef7).multiplyScalar(2.4) },
      uOpacity: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: `
      varying float vAlong;

      void main() {
        vAlong = uv.x;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      varying float vAlong;

      void main() {
        float birth = smoothstep(0.0, 0.035, vAlong);
        float collapse = 1.0 - smoothstep(0.56, 1.0, vAlong);
        float tearing = 0.58
          + 0.28 * sin(vAlong * 83.0 - uTime * 18.0)
          + 0.14 * sin(vAlong * 151.0 + uTime * 27.0);
        float alpha = birth * collapse * clamp(tearing, 0.12, 1.0) * uOpacity;
        if (alpha < 0.008) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    toneMapped: false,
  });
}

function createCavitationSheetMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: "AKULA attached sheet cavitation",
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
    },
    vertexShader: `
      varying vec2 vDiskPosition;

      void main() {
        vDiskPosition = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uOpacity;
      varying vec2 vDiskPosition;

      void main() {
        float radius = length(vDiskPosition);
        float angle = atan(vDiskPosition.y, vDiskPosition.x);
        float bladeWave = 0.5 + 0.5 * sin(angle * 7.0 - radius * 5.4);
        float bladeSheet = pow(bladeWave, 4.2);
        float tornEdge = pow(
          0.5 + 0.5 * sin(angle * 21.0 + radius * 13.0 - uTime * 29.0),
          5.0
        );
        float suctionBand = smoothstep(0.18, 0.56, radius);
        float tipFade = 1.0 - smoothstep(0.94, 1.2, radius);
        float tipFringe = smoothstep(0.72, 0.94, radius)
          * (1.0 - smoothstep(1.0, 1.2, radius));
        float breakup = 0.72
          + 0.18 * sin(angle * 19.0 + uTime * 24.0)
          + 0.1 * sin(angle * 31.0 - uTime * 37.0);
        float vapour = (0.11 + bladeSheet * 0.83 + tornEdge * 0.09)
          * suctionBand
          * tipFade
          * clamp(breakup, 0.3, 1.0)
          + tipFringe * tornEdge * 0.16;
        float alpha = vapour * uOpacity;
        if (alpha < 0.006) discard;
        gl_FragColor = vec4(vec3(0.7, 0.92, 1.0), alpha);
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    toneMapped: false,
  });
}

function createBubbleTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("Canvas 2D is required for bubble particles.");
  }
  const gradient = context.createRadialGradient(32, 32, 4, 32, 32, 30);
  gradient.addColorStop(0, "rgba(255,255,255,0.92)");
  gradient.addColorStop(0.48, "rgba(226,251,255,0.72)");
  gradient.addColorStop(0.72, "rgba(206,246,252,0.24)");
  gradient.addColorStop(1, "rgba(206,246,252,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
}
