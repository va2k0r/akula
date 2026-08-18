import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DynamicDrawUsage,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
} from "three";
import type { Object3D } from "three";
import { sampleAcousticSignatureVisual } from "../visualization/signalVisualMath";
import {
  FROSTBITE_CONTACT_CYCLE_DURATION_SECONDS,
  FROSTBITE_CONTACT_SIGNATURE,
} from "./ContactSignature";
import { CONTACT_RING_MINIMUM_SIGNAL_QUALITY } from "./ContactSensoryProgression";

const TAU = Math.PI * 2;
const RING_RADIUS = 88;
const ARC_POINT_COUNT = 217;
const BLIND_SPOT_FADE_START = (125 * Math.PI) / 180;
const BLIND_SPOT_EDGE = (135 * Math.PI) / 180;
const ARC_START = -BLIND_SPOT_EDGE;
const ARC_END = BLIND_SPOT_EDGE;
const INNER_NOTCH_X = 7;
const INNER_NOTCH_Z = 40;
const MAX_TRACE_AMPLITUDE = 6.2;
const TRACE_ENVELOPE_RADIANS = (19 * Math.PI) / 180;
const TRACE_CUTOFF_RADIANS = TRACE_ENVELOPE_RADIANS * 3;
const TRACE_SECONDS_PER_RADIAN = 3.35;
const TRACE_DIFFERENCE_SECONDS = 0.16;
export const PASSIVE_SONAR_FORWARD_SECTOR_COUNT = 3;
export const PASSIVE_SONAR_SECTOR_WIDTH_RADIANS = Math.PI / 6;
export const PASSIVE_SONAR_FORWARD_HALF_ANGLE_RADIANS =
  (PASSIVE_SONAR_FORWARD_SECTOR_COUNT * PASSIVE_SONAR_SECTOR_WIDTH_RADIANS) / 2;

/** Below this quality the ring has no readable return; sound and haptics lead. */
// The strict progression is audio at 0.26, haptics at 0.50, and only then this
// visual trace at 0.78. Direction also remains gated to three bow sectors.
export const PASSIVE_SONAR_VISIBLE_SIGNAL_THRESHOLD =
  CONTACT_RING_MINIMUM_SIGNAL_QUALITY;

interface BearingLabel {
  readonly sprite: Sprite;
  readonly texture: CanvasTexture;
  readonly material: SpriteMaterial;
}

/**
 * A non-spectral directional cue. Its irregular profile is sampled from the
 * fused acoustic envelope, but its spatial density does not encode audible
 * frequency. Its gyro-repeater scale is fixed to true/world bearings.
 */
export class PassiveSonarRing {
  private readonly root = new Group();
  private readonly ringPositions = new Float32Array(ARC_POINT_COUNT * 3);
  private readonly notchPositions = new Float32Array(12);
  private readonly ringAttribute = new BufferAttribute(this.ringPositions, 3);
  private readonly notchAttribute = new BufferAttribute(this.notchPositions, 3);
  private readonly ringMaterial = new LineBasicMaterial({
    color: 0x9ee9e4,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly notchMaterial = new LineBasicMaterial({
    color: 0x78c4c4,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly tickMaterial = new LineBasicMaterial({
    color: 0xb8eeea,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly minorTickMaterial = new LineBasicMaterial({
    color: 0x82bbb9,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly labels: readonly BearingLabel[];
  private smoothedStrength = 0;

  public constructor(parent: Object3D) {
    this.root.name = "PassiveSonarCoverageRing";
    this.root.visible = false;

    this.ringAttribute.setUsage(DynamicDrawUsage);
    const ringGeometry = new BufferGeometry();
    ringGeometry.setAttribute("position", this.ringAttribute);
    const ring = new Line(ringGeometry, this.ringMaterial);
    ring.name = "PassiveSonarDirectionalWave";
    ring.frustumCulled = false;
    ring.renderOrder = 42;

    this.notchAttribute.setUsage(DynamicDrawUsage);
    const notchGeometry = new BufferGeometry();
    notchGeometry.setAttribute("position", this.notchAttribute);
    const notch = new LineSegments(notchGeometry, this.notchMaterial);
    notch.name = "PassiveSonarBlindSpotEdges";
    notch.frustumCulled = false;
    notch.renderOrder = 42;

    const ticks = new LineSegments(
      createMajorBearingTickGeometry(),
      this.tickMaterial,
    );
    ticks.name = "PassiveSonarMajorBearings";
    ticks.renderOrder = 43;

    const minorTicks = new LineSegments(
      createMinorBearingTickGeometry(),
      this.minorTickMaterial,
    );
    minorTicks.name = "PassiveSonarMinorBearings";
    minorTicks.renderOrder = 43;

    // Show complete three-digit true bearings. North remains the unlabelled
    // index between 330 and 030, avoiding a 000/cardinal decoration.
    this.labels = Array.from({ length: 11 }, (_, index) => {
      const bearingDegrees = (index + 1) * 30;
      return createBearingLabel(bearingDegrees, ((index + 1) * Math.PI) / 6);
    });

    this.root.add(
      ring,
      notch,
      ticks,
      minorTicks,
      ...this.labels.map(({ sprite }) => sprite),
    );
    parent.add(this.root);
    this.updateGeometry(0, 0, 0);
  }

  public updateSignal(
    absoluteBearing: number,
    relativeBearing: number,
    signalStrength: number,
    ownSpeedMetersPerSecond: number,
    listening: boolean,
    elapsedSeconds: number,
    deltaSeconds: number,
  ): void {
    const targetStrength = listening
      ? MathUtils.clamp(signalStrength, 0, 1)
      : 0;
    this.smoothedStrength = MathUtils.damp(
      this.smoothedStrength,
      targetStrength,
      5.4,
      deltaSeconds,
    );

    this.updateGeometry(
      absoluteBearing,
      relativeBearing,
      elapsedSeconds,
      ownSpeedMetersPerSecond,
    );
  }

  /** The ring is persistent; view amount only adjusts contrast for the map. */
  public setViewAmount(amount: number): void {
    const tacticalAmount = MathUtils.clamp(amount, 0, 1);
    this.root.visible = true;
    this.ringMaterial.opacity = MathUtils.lerp(0.46, 0.68, tacticalAmount);
    this.notchMaterial.opacity = MathUtils.lerp(0.34, 0.5, tacticalAmount);
    this.tickMaterial.opacity = MathUtils.lerp(0.34, 0.5, tacticalAmount);
    this.minorTickMaterial.opacity = MathUtils.lerp(0.17, 0.29, tacticalAmount);
    for (const label of this.labels) {
      label.material.opacity = MathUtils.lerp(0.32, 0.46, tacticalAmount);
    }
  }

  public dispose(): void {
    this.root.traverse((object) => {
      if (object instanceof Line || object instanceof LineSegments) {
        object.geometry.dispose();
        object.material.dispose();
      }
    });
    for (const label of this.labels) {
      label.texture.dispose();
      label.material.dispose();
    }
    this.root.removeFromParent();
  }

  private updateGeometry(
    absoluteBearing: number,
    relativeBearing: number,
    elapsedSeconds: number,
    ownSpeedMetersPerSecond = 0,
  ): void {
    const observerHeading = normalizeAngle(absoluteBearing - relativeBearing);
    for (let index = 0; index < ARC_POINT_COUNT; index += 1) {
      const progress = index / (ARC_POINT_COUNT - 1);
      const relativeSampleBearing = MathUtils.lerp(
        ARC_START,
        ARC_END,
        progress,
      );
      const sampleBearing = observerHeading + relativeSampleBearing;
      const verticalDisplacement = directionalWaveDisplacement(
        sampleBearing,
        absoluteBearing,
        relativeBearing,
        this.smoothedStrength,
        ownSpeedMetersPerSecond,
        elapsedSeconds,
        index,
      );
      const offset = index * 3;
      this.ringPositions[offset] = Math.sin(sampleBearing) * RING_RADIUS;
      this.ringPositions[offset + 1] = verticalDisplacement;
      this.ringPositions[offset + 2] = -Math.cos(sampleBearing) * RING_RADIUS;
    }
    this.ringAttribute.needsUpdate = true;

    const firstX = this.ringPositions[0] ?? 0;
    const firstY = this.ringPositions[1] ?? 0;
    const firstZ = this.ringPositions[2] ?? 0;
    const lastOffset = (ARC_POINT_COUNT - 1) * 3;
    const lastX = this.ringPositions[lastOffset] ?? 0;
    const lastY = this.ringPositions[lastOffset + 1] ?? 0;
    const lastZ = this.ringPositions[lastOffset + 2] ?? 0;
    const firstInner = rotateHullPoint(
      -INNER_NOTCH_X,
      INNER_NOTCH_Z,
      observerHeading,
    );
    const lastInner = rotateHullPoint(
      INNER_NOTCH_X,
      INNER_NOTCH_Z,
      observerHeading,
    );
    this.notchPositions.set([
      firstX,
      firstY,
      firstZ,
      firstInner.x,
      0,
      firstInner.z,
      lastX,
      lastY,
      lastZ,
      lastInner.x,
      0,
      lastInner.z,
    ]);
    this.notchAttribute.needsUpdate = true;
  }
}

export function directionalWaveDisplacement(
  sampleBearing: number,
  absoluteSignalBearing: number,
  relativeSignalBearing: number,
  signalStrength: number,
  ownSpeedMetersPerSecond: number,
  elapsedSeconds: number,
  sampleIndex: number,
): number {
  const sensitivity =
    passiveArraySensitivity(relativeSignalBearing) *
    forwardRingSectorSensitivity(relativeSignalBearing);
  if (sensitivity <= 0) {
    return 0;
  }
  const strength = MathUtils.smoothstep(
    signalStrength,
    PASSIVE_SONAR_VISIBLE_SIGNAL_THRESHOLD,
    1,
  );
  if (strength <= 0) {
    return 0;
  }

  const angularOffset = normalizeAngle(sampleBearing - absoluteSignalBearing);
  if (Math.abs(angularOffset) >= TRACE_CUTOFF_RADIANS) {
    return 0;
  }

  const normalizedOffset = angularOffset / TRACE_ENVELOPE_RADIANS;
  const spatialEnvelope = Math.exp(-0.5 * normalizedOffset * normalizedOffset);
  const traceTime = positiveModulo(
    elapsedSeconds + angularOffset * TRACE_SECONDS_PER_RADIAN,
    FROSTBITE_CONTACT_CYCLE_DURATION_SECONDS,
  );
  const earlierTime = positiveModulo(
    traceTime - TRACE_DIFFERENCE_SECONDS,
    FROSTBITE_CONTACT_CYCLE_DURATION_SECONDS,
  );
  const laterTime = positiveModulo(
    traceTime + TRACE_DIFFERENCE_SECONDS,
    FROSTBITE_CONTACT_CYCLE_DURATION_SECONDS,
  );
  const current = sampleAcousticSignatureVisual(
    FROSTBITE_CONTACT_SIGNATURE,
    FROSTBITE_CONTACT_CYCLE_DURATION_SECONDS,
    traceTime,
    signalStrength,
    sampleIndex,
  );
  const earlier = sampleAcousticSignatureVisual(
    FROSTBITE_CONTACT_SIGNATURE,
    FROSTBITE_CONTACT_CYCLE_DURATION_SECONDS,
    earlierTime,
    signalStrength,
    sampleIndex,
  );
  const later = sampleAcousticSignatureVisual(
    FROSTBITE_CONTACT_SIGNATURE,
    FROSTBITE_CONTACT_CYCLE_DURATION_SECONDS,
    laterTime,
    signalStrength,
    sampleIndex,
  );

  // Local curvature plus slope turns the fused 1:2:4 envelope into a bipolar,
  // irregular trace instead of inventing one clean display sine wave.
  const localBaseline = (earlier.combinedEnvelope + later.combinedEnvelope) / 2;
  const curvature = (current.combinedEnvelope - localBaseline) * 2.25;
  const slope = (later.combinedEnvelope - earlier.combinedEnvelope) * 0.72;
  const irregularTrace = MathUtils.clamp(curvature + slope, -1, 1);

  return (
    irregularTrace *
    spatialEnvelope *
    MAX_TRACE_AMPLITUDE *
    strength *
    speedAmplitudeScale(ownSpeedMetersPerSecond) *
    sensitivity
  );
}

export function speedAmplitudeScale(speedMetersPerSecond: number): number {
  const speed = Math.abs(
    Number.isFinite(speedMetersPerSecond) ? speedMetersPerSecond : 0,
  );
  return 1 / (1 + speed / 6);
}

export function passiveArraySensitivity(relativeBearing: number): number {
  const absoluteBearing = Math.abs(normalizeAngle(relativeBearing));
  if (absoluteBearing <= BLIND_SPOT_FADE_START) {
    return 1;
  }
  if (absoluteBearing >= BLIND_SPOT_EDGE) {
    return 0;
  }
  const progress =
    (absoluteBearing - BLIND_SPOT_FADE_START) /
    (BLIND_SPOT_EDGE - BLIND_SPOT_FADE_START);
  return 1 - progress * progress * (3 - 2 * progress);
}

/**
 * The ring itself remains a broad passive-array repeater, but only a source in
 * the three contiguous 30-degree sectors centred on the bow may deform it.
 */
export function forwardRingSectorSensitivity(relativeBearing: number): number {
  const absoluteBearing = Math.abs(normalizeAngle(relativeBearing));
  return absoluteBearing <= PASSIVE_SONAR_FORWARD_HALF_ANGLE_RADIANS + 1e-9
    ? 1
    : 0;
}

export function absoluteBearingFromRelative(
  relativeBearing: number,
  observerHeading: number,
): number {
  return positiveModulo(relativeBearing + observerHeading, TAU);
}

function createMajorBearingTickGeometry(): BufferGeometry {
  const positions: number[] = [];
  for (let index = 0; index < 12; index += 1) {
    appendRadialTick(
      positions,
      (index * Math.PI) / 6,
      RING_RADIUS - 0.45,
      RING_RADIUS + 1.35,
    );
  }
  return new BufferGeometry().setAttribute(
    "position",
    new BufferAttribute(new Float32Array(positions), 3),
  );
}

function createMinorBearingTickGeometry(): BufferGeometry {
  const positions: number[] = [];
  for (let index = 1; index < 36; index += 1) {
    if (index % 3 === 0) {
      continue;
    }
    appendRadialTick(
      positions,
      (index * Math.PI) / 18,
      RING_RADIUS - 0.15,
      RING_RADIUS + 0.55,
    );
  }
  return new BufferGeometry().setAttribute(
    "position",
    new BufferAttribute(new Float32Array(positions), 3),
  );
}

function appendRadialTick(
  positions: number[],
  bearing: number,
  innerRadius: number,
  outerRadius: number,
): void {
  positions.push(
    Math.sin(bearing) * innerRadius,
    0.08,
    -Math.cos(bearing) * innerRadius,
    Math.sin(bearing) * outerRadius,
    0.08,
    -Math.cos(bearing) * outerRadius,
  );
}

function createBearingLabel(
  bearingDegrees: number,
  bearing: number,
): BearingLabel {
  const bearingText = String(bearingDegrees).padStart(3, "0");
  const text = `${bearingText}°`;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 28;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("Canvas 2D is required for sonar bearing labels.");
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "rgba(177, 225, 221, 0.82)";
  context.font = "500 12px ui-monospace, SFMono-Regular, Consolas, monospace";
  context.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const material = new SpriteMaterial({
    map: texture,
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
  const sprite = new Sprite(material);
  const labelRadius = RING_RADIUS + 5.2;
  sprite.name = `PassiveSonarBearing${bearingText}`;
  sprite.position.set(
    Math.sin(bearing) * labelRadius,
    0.45,
    -Math.cos(bearing) * labelRadius,
  );
  sprite.scale.set(8, 3.5, 1);
  sprite.renderOrder = 44;
  return { sprite, texture, material };
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function rotateHullPoint(
  x: number,
  z: number,
  heading: number,
): Readonly<{ x: number; z: number }> {
  const cosine = Math.cos(heading);
  const sine = Math.sin(heading);
  return {
    x: x * cosine - z * sine,
    z: x * sine + z * cosine,
  };
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}
