import {
  BufferAttribute,
  Color,
  MathUtils,
  type BufferGeometry,
  type Matrix4,
} from "three";
import type { IceKeel } from "./WorldGeometry";

interface IcebergVariant {
  readonly sourceWaterline: number;
  readonly tipScale: number;
  readonly belly: number;
  readonly taperCurve: number;
  readonly depthCurve: number;
  readonly crownPinch: number;
  readonly twist: number;
  readonly leanX: number;
  readonly leanZ: number;
}

const ICEBERG_VARIANTS: readonly IcebergVariant[] = Object.freeze([
  {
    sourceWaterline: 0.34,
    tipScale: 0.28,
    belly: 0.14,
    taperCurve: 1.28,
    depthCurve: 1.06,
    crownPinch: 0.14,
    twist: 0.16,
    leanX: -0.12,
    leanZ: 0.07,
  },
  {
    sourceWaterline: 0.29,
    tipScale: 0.38,
    belly: 0.08,
    taperCurve: 1.55,
    depthCurve: 0.94,
    crownPinch: 0.08,
    twist: -0.1,
    leanX: 0.08,
    leanZ: -0.14,
  },
  {
    sourceWaterline: 0.38,
    tipScale: 0.22,
    belly: 0.19,
    taperCurve: 1.12,
    depthCurve: 1.14,
    crownPinch: 0.2,
    twist: 0.24,
    leanX: 0.15,
    leanZ: 0.03,
  },
  {
    sourceWaterline: 0.32,
    tipScale: 0.34,
    belly: 0.11,
    taperCurve: 1.4,
    depthCurve: 1,
    crownPinch: 0.11,
    twist: -0.19,
    leanX: -0.04,
    leanZ: 0.16,
  },
]);

const DEEP_ICE_COLOR = new Color(0x347a8f);
const SHALLOW_ICE_COLOR = new Color(0xa8d8df);
const WATERLINE_COLOR = new Color(0xc7e8e9);
const SNOW_COLOR = new Color(0xf0f7f4);

/**
 * Turns a closed, Y-up source mesh into one complete iceberg volume.
 *
 * Only vertex positions, normals, and colors change. Indices and UVs remain
 * untouched, so a watertight source stays watertight and keeps its scanned PBR
 * surface detail.
 */
export function createIcebergGeometry(
  source: BufferGeometry,
  sourceWorldMatrix: Matrix4,
  keel: IceKeel,
  variantIndex: number,
): BufferGeometry {
  const variant =
    ICEBERG_VARIANTS[variantIndex % ICEBERG_VARIANTS.length] ??
    ICEBERG_VARIANTS[0];
  if (variant === undefined) {
    throw new Error("At least one iceberg deformation variant is required.");
  }

  const geometry = source.clone();
  geometry.applyMatrix4(sourceWorldMatrix);
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (bounds === null) {
    geometry.dispose();
    throw new Error("Iceberg source geometry has no bounding box.");
  }

  const sizeX = bounds.max.x - bounds.min.x;
  const sizeY = bounds.max.y - bounds.min.y;
  const sizeZ = bounds.max.z - bounds.min.z;
  if (sizeX <= 0 || sizeY <= 0 || sizeZ <= 0) {
    geometry.dispose();
    throw new Error("Iceberg source geometry must have non-zero dimensions.");
  }

  const centerX = (bounds.min.x + bounds.max.x) * 0.5;
  const centerZ = (bounds.min.z + bounds.max.z) * 0.5;
  const halfX = sizeX * 0.5;
  const halfZ = sizeZ * 0.5;
  const positions = geometry.getAttribute("position");
  const colors = new Float32Array(positions.count * 3);
  const workingColor = new Color();

  for (let index = 0; index < positions.count; index += 1) {
    const normalizedX = (positions.getX(index) - centerX) / halfX;
    const normalizedZ = (positions.getZ(index) - centerZ) / halfZ;
    const normalizedY = MathUtils.clamp(
      (positions.getY(index) - bounds.min.y) / sizeY,
      0,
      1,
    );

    let localX: number;
    let localY: number;
    let localZ: number;

    if (normalizedY < variant.sourceWaterline) {
      const depth =
        (variant.sourceWaterline - normalizedY) / variant.sourceWaterline;
      const taperAmount = Math.pow(depth, variant.taperCurve);
      const taper = MathUtils.lerp(1, variant.tipScale, taperAmount);
      const belly = 1 + Math.sin(depth * Math.PI) * variant.belly;
      const twist = variant.twist * depth;
      const cosine = Math.cos(twist);
      const sine = Math.sin(twist);
      const twistedX = normalizedX * cosine - normalizedZ * sine;
      const twistedZ = normalizedX * sine + normalizedZ * cosine;
      const radialDistance = MathUtils.clamp(
        Math.hypot(normalizedX, normalizedZ) / Math.SQRT2,
        0,
        1,
      );
      const roundedTip = 0.9 + (1 - radialDistance) * 0.1;

      localX =
        twistedX * keel.radiusX * taper * belly +
        keel.radiusX * variant.leanX * depth * depth;
      localZ =
        twistedZ * keel.radiusZ * taper * belly +
        keel.radiusZ * variant.leanZ * depth * depth;
      localY =
        -keel.keelDepth * Math.pow(depth, variant.depthCurve) * roundedTip;

      const depthColor = MathUtils.clamp(Math.pow(depth, 0.72), 0, 1);
      workingColor.lerpColors(SHALLOW_ICE_COLOR, DEEP_ICE_COLOR, depthColor);
    } else {
      const crown =
        (normalizedY - variant.sourceWaterline) / (1 - variant.sourceWaterline);
      const crownScale = 1 - variant.crownPinch * Math.pow(crown, 1.35);
      localX = normalizedX * keel.radiusX * crownScale;
      localZ = normalizedZ * keel.radiusZ * crownScale;
      localY = keel.crownHeight * Math.pow(crown, 0.88);
      workingColor.lerpColors(
        WATERLINE_COLOR,
        SNOW_COLOR,
        MathUtils.smoothstep(crown, 0.02, 0.72),
      );
    }

    const scannedVariation =
      0.94 +
      Math.sin(
        normalizedX * 11.3 +
          normalizedZ * 7.7 +
          normalizedY * 17.1 +
          variantIndex * 2.9,
      ) *
        0.035;
    workingColor.multiplyScalar(scannedVariation);

    positions.setXYZ(index, localX, localY, localZ);
    colors[index * 3] = workingColor.r;
    colors[index * 3 + 1] = workingColor.g;
    colors[index * 3 + 2] = workingColor.b;
  }

  positions.needsUpdate = true;
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
