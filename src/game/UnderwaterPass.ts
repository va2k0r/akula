import {
  Color,
  Matrix4,
  NoBlending,
  ShaderMaterial,
  Vector2,
  Vector3,
  type Camera,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import {
  FullScreenQuad,
  Pass,
} from "three/examples/jsm/postprocessing/Pass.js";
import type { UnderwaterOpticsState } from "./UnderwaterOptics";

/**
 * Full-frame water-volume treatment. Scene fog still handles transparent
 * geometry; this pass uses the real depth buffer for absorption, caustic
 * projection, refractive wobble and wavelength separation.
 */
export class UnderwaterPass extends Pass {
  private readonly projectionInverse = new Matrix4();
  private readonly cameraWorld = new Matrix4();
  private readonly cameraPosition = new Vector3();
  private readonly material = new ShaderMaterial({
    name: "AKULA underwater volume",
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
    toneMapped: false,
    uniforms: {
      tDiffuse: { value: null },
      tDepth: { value: null },
      uTime: { value: 0 },
      uAmount: { value: 0 },
      uCameraDepth: { value: 0 },
      uSurfaceHeight: { value: 0 },
      uVisibility: { value: 170 },
      uResolution: { value: new Vector2(1, 1) },
      uProjectionInverse: { value: new Matrix4() },
      uCameraWorld: { value: new Matrix4() },
      uCameraPosition: { value: new Vector3() },
      uShallowFog: { value: new Color(0x0b4652) },
      uDeepFog: { value: new Color(0x021521) },
    },
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: createUnderwaterFragmentShader(),
  });
  private readonly fullscreen = new FullScreenQuad(this.material);

  public constructor(private readonly camera: Camera) {
    super();
  }

  public update(time: number, state: UnderwaterOpticsState): void {
    requireUniform(this.material, "uTime").value = time;
    requireUniform(this.material, "uAmount").value = state.amount;
    requireUniform(this.material, "uCameraDepth").value =
      state.cameraDepthMeters;
    requireUniform(this.material, "uSurfaceHeight").value = state.surfaceHeight;
    requireUniform(this.material, "uVisibility").value = state.visibilityMeters;
    this.enabled = state.amount > 0.001;
  }

  public override setSize(width: number, height: number): void {
    const resolution = requireUniform(this.material, "uResolution").value;
    if (resolution instanceof Vector2) {
      resolution.set(width, height);
    }
  }

  public override render(
    renderer: WebGLRenderer,
    writeBuffer: WebGLRenderTarget,
    readBuffer: WebGLRenderTarget,
  ): void {
    requireUniform(this.material, "tDiffuse").value = readBuffer.texture;
    requireUniform(this.material, "tDepth").value = readBuffer.depthTexture;

    this.projectionInverse.copy(this.camera.projectionMatrixInverse);
    this.cameraWorld.copy(this.camera.matrixWorld);
    this.cameraPosition.setFromMatrixPosition(this.camera.matrixWorld);
    requireUniform(this.material, "uProjectionInverse").value =
      this.projectionInverse;
    requireUniform(this.material, "uCameraWorld").value = this.cameraWorld;
    requireUniform(this.material, "uCameraPosition").value =
      this.cameraPosition;

    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) {
      renderer.clear(
        renderer.autoClearColor,
        renderer.autoClearDepth,
        renderer.autoClearStencil,
      );
    }
    this.fullscreen.render(renderer);
  }

  public override dispose(): void {
    this.material.dispose();
    this.fullscreen.dispose();
  }
}

function requireUniform(
  material: ShaderMaterial,
  name: string,
): { value: unknown } {
  const uniform = material.uniforms[name];
  if (uniform === undefined) {
    throw new Error(`Missing underwater shader uniform: ${name}`);
  }
  return uniform;
}

function createUnderwaterFragmentShader(): string {
  return `
    precision highp float;

    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform float uTime;
    uniform float uAmount;
    uniform float uCameraDepth;
    uniform float uSurfaceHeight;
    uniform float uVisibility;
    uniform vec2 uResolution;
    uniform mat4 uProjectionInverse;
    uniform mat4 uCameraWorld;
    uniform vec3 uCameraPosition;
    uniform vec3 uShallowFog;
    uniform vec3 uDeepFog;

    varying vec2 vUv;

    vec4 viewPositionFromDepth(vec2 uv, float depth) {
      vec4 clipPosition = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
      vec4 viewPosition = uProjectionInverse * clipPosition;
      return viewPosition / max(viewPosition.w, 0.00001);
    }

    float causticLayer(vec2 point, float time) {
      vec2 warped = point;
      warped += vec2(
        sin(point.y * 0.73 + time * 0.83),
        sin(point.x * 0.61 - time * 0.67)
      ) * 1.45;
      float first = sin(warped.x * 1.31 + sin(warped.y * 1.17 + time));
      float second = sin(warped.y * 1.43 - sin(warped.x * 1.09 - time * 0.72));
      float ridge = abs(first + second);
      return pow(1.0 - smoothstep(0.06, 0.82, ridge), 2.4);
    }

    float causticWeb(vec2 worldPoint) {
      float slow = causticLayer(worldPoint * 0.095, uTime * 0.42);
      float fine = causticLayer(worldPoint.yx * 0.157 + 17.0, -uTime * 0.31);
      return clamp(slow * 0.76 + fine * 0.42, 0.0, 1.0);
    }

    void main() {
      vec2 centered = vUv * 2.0 - 1.0;
      centered.x *= uResolution.x / max(uResolution.y, 1.0);
      float edge = smoothstep(0.15, 1.38, length(centered));
      vec2 edgeDistance = min(vUv, 1.0 - vUv);
      float distortionFade = smoothstep(
        0.0,
        0.055,
        min(edgeDistance.x, edgeDistance.y)
      );

      float longRipple = sin(
        vUv.y * 47.0 + uTime * 0.76 + sin(vUv.x * 9.0 - uTime * 0.29)
      );
      float crossRipple = sin(
        vUv.x * 38.0 - uTime * 0.53 + sin(vUv.y * 13.0 + uTime * 0.21)
      );
      vec2 refraction = vec2(longRipple, crossRipple)
        * 0.00108
        * uAmount
        * distortionFade;
      vec2 sampleUv = clamp(vUv + refraction, vec2(0.001), vec2(0.999));

      vec2 fringeDirection = normalize(centered + vec2(0.0001));
      vec2 fringe = fringeDirection
        * (0.00034 + edge * 0.00128)
        * uAmount
        * distortionFade;
      vec3 color = vec3(
        texture2D(tDiffuse, clamp(sampleUv + fringe, vec2(0.001), vec2(0.999))).r,
        texture2D(tDiffuse, sampleUv).g,
        texture2D(tDiffuse, clamp(sampleUv - fringe, vec2(0.001), vec2(0.999))).b
      );

      float sceneDepth = texture2D(tDepth, sampleUv).x;
      vec4 viewPosition = viewPositionFromDepth(sampleUv, sceneDepth);
      vec3 worldPosition = (uCameraWorld * vec4(viewPosition.xyz, 1.0)).xyz;
      float sceneDistance = length(viewPosition.xyz);
      float hasGeometry = 1.0 - step(0.999995, sceneDepth);

      float depthFactor = smoothstep(8.0, 155.0, uCameraDepth);
      float extinction = 1.65 / max(uVisibility, 1.0);
      float fogAmount = 1.0 - exp(-min(sceneDistance, 6000.0) * extinction);
      fogAmount = mix(1.0, fogAmount, hasGeometry);

      vec3 absorptionCoefficient = mix(
        vec3(0.0125, 0.0048, 0.0026),
        vec3(0.0185, 0.0074, 0.0041),
        depthFactor
      );
      vec3 transmittance = exp(
        -absorptionCoefficient * min(sceneDistance, uVisibility * 1.25)
      );
      color *= mix(vec3(1.0), transmittance, uAmount);

      vec3 fogColor = mix(uShallowFog, uDeepFog, depthFactor);
      float underwaterObject = hasGeometry * step(worldPosition.y, uSurfaceHeight - 0.35);
      vec3 dx = dFdx(worldPosition);
      vec3 dy = dFdy(worldPosition);
      vec3 surfaceNormal = normalize(cross(dx, dy) + vec3(0.00001));
      vec3 sunDirection = normalize(vec3(-0.42, 0.31, -0.85));
      float surfaceExposure = 0.24 + 0.76 * abs(dot(surfaceNormal, sunDirection));
      float objectDepth = max(uSurfaceHeight - worldPosition.y, 0.0);
      float causticFade = exp(-objectDepth * 0.018) * exp(-uCameraDepth * 0.006);
      float caustic = causticWeb(worldPosition.xz)
        * surfaceExposure
        * causticFade
        * underwaterObject
        * (1.0 - fogAmount * 0.74)
        * uAmount;
      vec3 viewRay = normalize(worldPosition - uCameraPosition);
      float lookingUp = smoothstep(-0.08, 0.72, viewRay.y);
      float shaftPattern = sin(
        viewRay.x * 26.0 + viewRay.z * 19.0 + uTime * 0.18
      ) * 0.5 + 0.5;
      shaftPattern *= sin(
        viewRay.x * 11.0 - viewRay.z * 29.0 - uTime * 0.13
      ) * 0.5 + 0.5;
      float shafts = smoothstep(0.48, 0.92, shaftPattern)
        * lookingUp
        * exp(-uCameraDepth * 0.013)
        * (0.42 + 0.58 * fogAmount)
        * uAmount;
      color = mix(color, fogColor, fogAmount * uAmount);
      // Caustic projection and suspended shafts are in-scattered light. Add
      // them after extinction so nearby ribbons remain visible in turbid water.
      color += vec3(0.16, 0.52, 0.58)
        * caustic
        * mix(0.78, 0.38, fogAmount);
      color += vec3(0.10, 0.38, 0.45)
        * shafts
        * mix(0.36, 0.2, fogAmount);
      gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
    }
  `;
}
