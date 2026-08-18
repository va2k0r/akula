import {
  BufferAttribute,
  BufferGeometry,
  BackSide,
  Color,
  DepthTexture,
  DoubleSide,
  HalfFloatType,
  LinearFilter,
  LineSegments,
  Matrix4,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  UnsignedIntType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from "three";
import {
  MAX_OCEAN_COMPONENTS,
  NORTH_ATLANTIC_SEA_STATE,
  NORTH_ATLANTIC_WAVES,
  sampleOceanSurface,
  type OceanSurfaceSample,
} from "./OceanSpectrum";
import type { NorthSeaEnvironmentState } from "./NorthSeaEnvironment";

const SUN_DIRECTION = new Vector3(-0.42, 0.31, -0.85).normalize();
const SURFACE_SIZE = 6_000;
const SURFACE_SEGMENTS = 384;
const SURFACE_GRID_EXPONENT = 1.6;
const STORM_SEA_SEVERITY = 0.78;
const STORM_RAIN_BASELINE = 0.62;
const RAIN_DROP_COUNT = 3_200;

/**
 * Optical pipeline adapted from WaterThreeJS by mohamedachrefelouafi (MIT),
 * with the procedural wave progression replaced by AKULA's dual-JONSWAP sea.
 * Full upstream notice is retained in THIRD_PARTY_NOTICES.md.
 */
export class OceanSurface {
  public readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  public readonly sky: Mesh<SphereGeometry, ShaderMaterial>;
  public readonly rain: LineSegments<BufferGeometry, ShaderMaterial>;

  private readonly waveA = Array.from(
    { length: MAX_OCEAN_COMPONENTS },
    () => new Vector4(),
  );
  private readonly waveB = Array.from(
    { length: MAX_OCEAN_COMPONENTS },
    () => new Vector4(),
  );
  private readonly refractionTarget = createSceneTarget(1, 1);
  private readonly resolution = new Vector2(1, 1);
  private readonly drawingBufferSize = new Vector2();
  private underwater = true;
  private tacticalAmount = 0;
  private waterEffectsEnabled = true;
  private rainIntensity = STORM_RAIN_BASELINE;

  public constructor() {
    for (const [index, wave] of NORTH_ATLANTIC_WAVES.entries()) {
      this.waveA[index]?.set(
        wave.directionX,
        wave.directionZ,
        wave.waveNumber,
        wave.amplitude,
      );
      this.waveB[index]?.set(
        wave.angularFrequency,
        wave.phase,
        wave.horizontalAmplitude,
        wave.band === "wind-sea" ? 1 : 0,
      );
    }

    const waterMaterial = new ShaderMaterial({
      name: "AKULA Dual-JONSWAP Ocean",
      side: DoubleSide,
      depthWrite: true,
      transparent: true,
      toneMapped: false,
      uniforms: {
        uTime: { value: 0 },
        uWaveCount: { value: NORTH_ATLANTIC_WAVES.length },
        uWaveA: { value: this.waveA },
        uWaveB: { value: this.waveB },
        uSunDirection: { value: SUN_DIRECTION.clone() },
        uWindDirection: {
          value: new Vector2(
            Math.cos(NORTH_ATLANTIC_SEA_STATE.windSea.directionRadians),
            Math.sin(NORTH_ATLANTIC_SEA_STATE.windSea.directionRadians),
          ),
        },
        uResolution: { value: this.resolution },
        uRefractionTexture: { value: this.refractionTarget.texture },
        uDepthTexture: { value: this.refractionTarget.depthTexture },
        uNear: { value: 0.5 },
        uFar: { value: 6_000 },
        uProjectionMatrix: { value: new Matrix4() },
        uCameraUnderwater: { value: 1 },
        uTacticalView: { value: 0 },
        uDeepColor: { value: new Color(0x011824) },
        uShallowColor: { value: new Color(0x2b4a4f) },
        uFoamColor: { value: new Color(0xdde4df) },
        uWeather: { value: new Vector4(0, 0, 0.25, 0.5) },
        uDaylight: { value: 0.72 },
        uSeaSeverity: { value: STORM_SEA_SEVERITY },
        uRainIntensity: { value: this.rainIntensity },
      },
      vertexShader: createVertexShader(),
      fragmentShader: createFragmentShader(),
    });

    const geometry = new PlaneGeometry(
      SURFACE_SIZE,
      SURFACE_SIZE,
      SURFACE_SEGMENTS,
      SURFACE_SEGMENTS,
    );
    geometry.rotateX(-Math.PI / 2);
    concentrateSurfaceGrid(geometry);
    this.mesh = new Mesh(geometry, waterMaterial);
    this.mesh.name = "North Atlantic JONSWAP surface";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;

    const skyMaterial = new ShaderMaterial({
      name: "AKULA Arctic sky",
      side: BackSide,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
      uniforms: {
        uTime: { value: 0 },
        uSunDirection: { value: SUN_DIRECTION.clone() },
        uTacticalView: { value: 0 },
        uWeather: { value: new Vector4(0, 0, 0.25, 0.5) },
        uDaylight: { value: 0.72 },
        uSeaSeverity: { value: STORM_SEA_SEVERITY },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorldPosition = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform float uTime;
        uniform vec3 uSunDirection;
        uniform float uTacticalView;
        uniform vec4 uWeather;
        uniform float uDaylight;
        uniform float uSeaSeverity;
        varying vec3 vWorldPosition;
        ${NOISE_GLSL}
        ${ARCTIC_SKY_GLSL}
        void main() {
          vec3 direction = normalize(vWorldPosition - cameraPosition);
          float opacity = 1.0 - smoothstep(0.18, 0.72, uTacticalView);
          gl_FragColor = vec4(arcticSky(direction, normalize(uSunDirection)), opacity);
        }
      `,
    });
    this.sky = new Mesh(new SphereGeometry(3_400, 40, 24), skyMaterial);
    this.sky.name = "Barents Sea sky dome";
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;

    this.rain = createStormRainField();
  }

  public update(time: number, camera: Camera): void {
    requireUniform(this.mesh.material, "uTime").value = time;
    const projectionMatrix = requireUniform(
      this.mesh.material,
      "uProjectionMatrix",
    ).value;
    if (!(projectionMatrix instanceof Matrix4)) {
      throw new Error("Ocean projection uniform is not a Matrix4.");
    }
    projectionMatrix.copy(camera.projectionMatrix);
    requireUniform(this.sky.material, "uTime").value = time;
    this.sky.position.copy(camera.position);

    const sample = this.sample(camera.position.x, camera.position.z, time);
    this.underwater = camera.position.y < sample.height - 0.12;
    requireUniform(this.mesh.material, "uCameraUnderwater").value = this
      .underwater
      ? 1
      : 0;

    this.rain.position.copy(camera.position);
    requireUniform(this.rain.material, "uTime").value = time;
    requireUniform(this.rain.material, "uOpacity").value =
      this.rainIntensity *
      (this.underwater ? 0 : 1) *
      (1 - this.tacticalAmount);

    // The non-linear grid is densest under the camera. Following continuously
    // preserves that density without the visible jumps caused by snapped
    // translations; waves remain world-anchored because the shader evaluates
    // their phase after modelMatrix has placed every vertex in world space.
    this.mesh.position.x = camera.position.x;
    this.mesh.position.z = camera.position.z;
  }

  public sample(x: number, z: number, time: number): OceanSurfaceSample {
    return sampleOceanSurface(NORTH_ATLANTIC_WAVES, x, z, time);
  }

  public setTacticalView(amount: number): void {
    this.tacticalAmount = Math.min(1, Math.max(0, amount));
    requireUniform(this.mesh.material, "uTacticalView").value =
      this.tacticalAmount;
    requireUniform(this.sky.material, "uTacticalView").value =
      this.tacticalAmount;
    this.mesh.material.depthWrite = this.tacticalAmount < 0.04;
    this.updateVisibility();
  }

  public setWaterEffectsEnabled(enabled: boolean): void {
    this.waterEffectsEnabled = enabled;
    this.updateVisibility();
  }

  public setEnvironment(environment: NorthSeaEnvironmentState): void {
    this.rainIntensity = stormRainIntensity(
      environment.rain,
      environment.windStrength,
      environment.squall,
    );
    const weather = new Vector4(
      this.rainIntensity,
      environment.squall,
      environment.saltHaze,
      environment.clearing,
    );
    for (const material of [this.mesh.material, this.sky.material]) {
      const weatherUniform = requireUniform(material, "uWeather").value;
      if (weatherUniform instanceof Vector4) {
        weatherUniform.copy(weather);
      }
      requireUniform(material, "uDaylight").value = environment.daylight;
      const sunDirection = requireUniform(material, "uSunDirection").value;
      if (sunDirection instanceof Vector3) {
        const horizontal = Math.cos(environment.sunElevationRadians);
        sunDirection
          .set(
            -0.44 * horizontal,
            Math.sin(environment.sunElevationRadians),
            -0.9 * horizontal,
          )
          .normalize();
      }
    }
    requireUniform(this.mesh.material, "uRainIntensity").value =
      this.rainIntensity;
  }

  public get visibleRainIntensity(): number {
    return this.rainIntensity;
  }

  public renderRefraction(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
  ): void {
    if (
      !this.waterEffectsEnabled ||
      this.underwater ||
      this.tacticalAmount > 0.025
    ) {
      return;
    }
    renderer.getDrawingBufferSize(this.drawingBufferSize);
    this.ensureTargetSize(
      Math.max(1, Math.round(this.drawingBufferSize.x * 0.7)),
      Math.max(1, Math.round(this.drawingBufferSize.y * 0.7)),
    );

    const previousTarget = renderer.getRenderTarget();
    const previousXr = renderer.xr.enabled;
    const previousVisibility = this.mesh.visible;
    const previousRainVisibility = this.rain.visible;
    renderer.xr.enabled = false;
    this.mesh.visible = false;
    this.rain.visible = false;
    renderer.setRenderTarget(this.refractionTarget);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(previousTarget);
    this.mesh.visible = previousVisibility;
    this.rain.visible = previousRainVisibility;
    renderer.xr.enabled = previousXr;
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.rain.geometry.dispose();
    this.rain.material.dispose();
    this.refractionTarget.dispose();
  }

  private ensureTargetSize(width: number, height: number): void {
    if (this.resolution.x === width && this.resolution.y === height) {
      return;
    }
    this.resolution.set(width, height);
    this.refractionTarget.setSize(width, height);
  }

  private updateVisibility(): void {
    this.mesh.visible = this.waterEffectsEnabled && this.tacticalAmount < 0.82;
    this.sky.visible = this.tacticalAmount < 0.82;
    this.rain.visible = this.waterEffectsEnabled && this.tacticalAmount < 0.82;
  }
}

export function stormRainIntensity(
  weatherRain: number,
  windStrength: number,
  squall: number,
): number {
  const windDrivenRain =
    STORM_RAIN_BASELINE + clamp01(windStrength) * 0.14 + clamp01(squall) * 0.12;
  return clamp01(Math.max(weatherRain, windDrivenRain));
}

function createStormRainField(): LineSegments<BufferGeometry, ShaderMaterial> {
  const positions = new Float32Array(RAIN_DROP_COUNT * 2 * 3);
  const seeds = new Float32Array(RAIN_DROP_COUNT * 2);
  const endpoints = new Float32Array(RAIN_DROP_COUNT * 2);
  for (let index = 0; index < RAIN_DROP_COUNT; index += 1) {
    const radialSeed = hashScalar(index * 3 + 17);
    const angle = hashScalar(index * 5 + 29) * Math.PI * 2;
    const radius = Math.sqrt(radialSeed) * 155;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = (hashScalar(index * 7 + 41) - 0.5) * 18;
    const seed = hashScalar(index * 11 + 73);
    for (let endpoint = 0; endpoint < 2; endpoint += 1) {
      const vertexIndex = index * 2 + endpoint;
      positions[vertexIndex * 3] = x;
      positions[vertexIndex * 3 + 1] = y;
      positions[vertexIndex * 3 + 2] = z;
      seeds[vertexIndex] = seed;
      endpoints[vertexIndex] = endpoint;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("aSeed", new BufferAttribute(seeds, 1));
  geometry.setAttribute("aEndpoint", new BufferAttribute(endpoints, 1));
  const material = new ShaderMaterial({
    name: "AKULA North Sea rain streaks",
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: STORM_RAIN_BASELINE },
      uWindDirection: {
        value: new Vector2(
          Math.cos(NORTH_ATLANTIC_SEA_STATE.windSea.directionRadians),
          Math.sin(NORTH_ATLANTIC_SEA_STATE.windSea.directionRadians),
        ),
      },
    },
    vertexShader: `
      precision highp float;
      uniform float uTime;
      uniform vec2 uWindDirection;
      attribute float aSeed;
      attribute float aEndpoint;
      varying float vFade;
      varying float vSeed;

      void main() {
        float fallRate = mix(0.62, 0.96, aSeed);
        float cycle = fract(aSeed + uTime * fallRate);
        vec3 local = position;
        local.y += 52.0 - cycle * 104.0;
        local.xz += uWindDirection * (cycle * 13.0);
        local.y -= aEndpoint * mix(0.85, 2.8, aSeed);
        local.xz += uWindDirection * aEndpoint * 0.78;
        vec4 world = modelMatrix * vec4(local, 1.0);
        vec4 viewPosition = viewMatrix * world;
        vFade = (1.0 - smoothstep(18.0, 175.0, length(local.xz)))
          * smoothstep(-56.0, -28.0, local.y)
          * (1.0 - smoothstep(34.0, 58.0, local.y));
        vSeed = aSeed;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform float uOpacity;
      varying float vFade;
      varying float vSeed;
      void main() {
        vec3 rainColor = mix(
          vec3(0.38, 0.43, 0.45),
          vec3(0.5, 0.55, 0.56),
          vSeed
        );
        float dropOpacity = mix(0.08, 0.19, vSeed);
        gl_FragColor = vec4(rainColor, uOpacity * vFade * dropOpacity);
      }
    `,
  });
  const rain = new LineSegments(geometry, material);
  rain.name = "North Sea driving rain";
  rain.frustumCulled = false;
  rain.renderOrder = 4;
  return rain;
}

function hashScalar(value: number): number {
  const sine = Math.sin(value * 12.9898 + 78.233) * 43_758.5453;
  return sine - Math.floor(sine);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function concentrateSurfaceGrid(geometry: PlaneGeometry): void {
  const positions = geometry.getAttribute("position");
  if (positions === undefined) {
    throw new Error("Ocean surface geometry has no position attribute.");
  }
  const halfSize = SURFACE_SIZE * 0.5;
  for (let index = 0; index < positions.count; index += 1) {
    positions.setX(index, warpSurfaceAxis(positions.getX(index), halfSize));
    positions.setZ(index, warpSurfaceAxis(positions.getZ(index), halfSize));
  }
  positions.needsUpdate = true;
  geometry.computeBoundingSphere();
}

function warpSurfaceAxis(value: number, halfSize: number): number {
  const normalized = Math.min(1, Math.abs(value) / halfSize);
  return (
    Math.sign(value) * halfSize * Math.pow(normalized, SURFACE_GRID_EXPONENT)
  );
}

function createSceneTarget(width: number, height: number): WebGLRenderTarget {
  const target = new WebGLRenderTarget(width, height, {
    type: HalfFloatType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: true,
  });
  target.depthTexture = new DepthTexture(width, height, UnsignedIntType);
  return target;
}

function requireUniform(
  material: ShaderMaterial,
  name: string,
): { value: unknown } {
  const uniform = material.uniforms[name];
  if (uniform === undefined) {
    throw new Error(`Missing ocean shader uniform: ${name}`);
  }
  return uniform;
}

function createVertexShader(): string {
  return `
    precision highp float;
    #define MAX_WAVES ${MAX_OCEAN_COMPONENTS}

    uniform float uTime;
    uniform int uWaveCount;
    uniform vec4 uWaveA[MAX_WAVES];
    uniform vec4 uWaveB[MAX_WAVES];

    varying vec3 vWorldPosition;
    varying vec3 vWorldNormal;
    varying float vFold;
    varying float vHeight;
    varying float vWindHeight;
    varying float vViewZ;

    void main() {
      vec3 rest = (modelMatrix * vec4(position, 1.0)).xyz;
      rest.y = 0.0;
      vec3 displacement = vec3(0.0);
      vec3 dPdx = vec3(1.0, 0.0, 0.0);
      vec3 dPdz = vec3(0.0, 0.0, 1.0);
      float jxx = 1.0;
      float jzz = 1.0;
      float jxz = 0.0;
      float windHeight = 0.0;

      for (int i = 0; i < MAX_WAVES; i++) {
        if (i >= uWaveCount) break;
        vec4 a = uWaveA[i]; // direction.xy, k, vertical amplitude
        vec4 b = uWaveB[i]; // omega, phase, horizontal amplitude, wind-band flag
        vec2 direction = a.xy;
        float theta = a.z * dot(direction, rest.xz) - b.x * uTime + b.y;
        float sine = sin(theta);
        float cosine = cos(theta);
        float slope = a.w * a.z * cosine;
        float horizontalDerivative = -b.z * a.z * sine;

        displacement.xz += direction * b.z * cosine;
        displacement.y += a.w * sine;
        windHeight += a.w * sine * b.w;

        dPdx += vec3(
          horizontalDerivative * direction.x * direction.x,
          slope * direction.x,
          horizontalDerivative * direction.x * direction.y
        );
        dPdz += vec3(
          horizontalDerivative * direction.y * direction.x,
          slope * direction.y,
          horizontalDerivative * direction.y * direction.y
        );
        jxx += horizontalDerivative * direction.x * direction.x;
        jzz += horizontalDerivative * direction.y * direction.y;
        jxz += horizontalDerivative * direction.x * direction.y;
      }

      vec3 displaced = rest + displacement;
      vWorldPosition = displaced;
      vWorldNormal = normalize(cross(dPdz, dPdx));
      vFold = jxx * jzz - jxz * jxz;
      vHeight = displacement.y;
      vWindHeight = windHeight;
      vec4 viewPosition = viewMatrix * vec4(displaced, 1.0);
      vViewZ = viewPosition.z;
      gl_Position = projectionMatrix * viewPosition;
    }
  `;
}

function createFragmentShader(): string {
  return `
    precision highp float;
    #include <packing>

    uniform float uTime;
    uniform vec3 uSunDirection;
    uniform vec2 uWindDirection;
    uniform vec2 uResolution;
    uniform sampler2D uRefractionTexture;
    uniform sampler2D uDepthTexture;
    uniform float uNear;
    uniform float uFar;
    uniform mat4 uProjectionMatrix;
    uniform float uCameraUnderwater;
    uniform float uTacticalView;
    uniform vec3 uDeepColor;
    uniform vec3 uShallowColor;
    uniform vec3 uFoamColor;
    uniform vec4 uWeather;
    uniform float uDaylight;
    uniform float uSeaSeverity;
    uniform float uRainIntensity;

    varying vec3 vWorldPosition;
    varying vec3 vWorldNormal;
    varying float vFold;
    varying float vHeight;
    varying float vWindHeight;
    varying float vViewZ;

    ${NOISE_GLSL}
    ${ARCTIC_SKY_GLSL}

    float fresnelSchlick(float cosine, float f0) {
      return f0 + (1.0 - f0) * pow(clamp(1.0 - cosine, 0.0, 1.0), 5.0);
    }

    vec2 shortWaveSlope(
      vec2 point,
      float time,
      float angle,
      float wavelength,
      float steepness,
      float phase
    ) {
      vec2 acrossWind = vec2(-uWindDirection.y, uWindDirection.x);
      vec2 direction = normalize(
        uWindDirection * cos(angle) + acrossWind * sin(angle)
      );
      float waveNumber = 6.28318530718 / wavelength;
      float omega = sqrt(9.81 * waveNumber);
      float theta = waveNumber * dot(direction, point) - omega * time + phase;
      // Pixel-footprint filtering removes sub-pixel waves instead of letting
      // them alias into the long oily contour bands visible at grazing angles.
      float footprint = fwidth(theta);
      float filterAmount = 1.0 - smoothstep(0.72, 2.4, footprint);
      return direction * steepness * cos(theta) * filterAmount;
    }

    vec2 spectralDetailSlope(vec2 point, float time) {
      // The metre-scale geometry already carries the large sea. This band is
      // intentionally shorter and broader: coherent 3-28 m normal waves turn
      // reflected clouds into the concentric "oil" contours seen in review.
      vec2 slope = vec2(0.0);
      slope += shortWaveSlope(point, time, -0.91, 5.10, 0.032, 0.7);
      slope += shortWaveSlope(point, time,  0.43, 4.35, 0.030, 2.9);
      slope += shortWaveSlope(point, time, -0.28, 3.72, 0.027, 5.1);
      slope += shortWaveSlope(point, time,  1.08, 3.14, 0.025, 1.8);
      slope += shortWaveSlope(point, time, -1.22, 2.68, 0.023, 4.3);
      slope += shortWaveSlope(point, time,  0.17, 2.29, 0.021, 0.2);
      slope += shortWaveSlope(point, time, -0.63, 1.94, 0.019, 3.6);
      slope += shortWaveSlope(point, time,  0.79, 1.66, 0.018, 5.8);
      slope += shortWaveSlope(point, time, -1.47, 1.41, 0.016, 2.1);
      slope += shortWaveSlope(point, time,  1.31, 1.19, 0.015, 4.9);
      slope += shortWaveSlope(point, time,  0.58, 0.86, 0.013, 3.9);
      slope += shortWaveSlope(point, time, -0.41, 0.52, 0.010, 5.5);
      return slope;
    }

    vec3 rainRippleDetail(vec2 point, float time) {
      const float cellSize = 1.85;
      vec2 baseCell = floor(point / cellSize - vec2(0.5));
      vec2 slope = vec2(0.0);
      float rings = 0.0;
      for (int offsetX = 0; offsetX <= 1; offsetX++) {
        for (int offsetY = 0; offsetY <= 1; offsetY++) {
          vec2 cell = baseCell + vec2(float(offsetX), float(offsetY));
          vec2 randomOffset = vec2(
            hash21(cell + vec2(17.1, 3.7)),
            hash21(cell + vec2(5.3, 29.9))
          );
          vec2 centre = (cell + randomOffset) * cellSize;
          float speed = mix(0.68, 1.04, hash21(cell + 9.2));
          float age = fract(time * speed + hash21(cell + 41.7));
          float activation = step(0.48, hash21(cell + vec2(81.3, 17.9)));
          float impactStrength = mix(
            0.38,
            1.0,
            hash21(cell + vec2(7.4, 63.1))
          ) * activation;
          float maximumRadius = mix(
            0.38,
            0.94,
            hash21(cell + vec2(31.7, 2.8))
          );
          float radius = age * maximumRadius;
          vec2 radial = point - centre;
          float distanceFromImpact = length(radial);
          float width = max(0.027, fwidth(distanceFromImpact) * 1.35);
          float ringDistance = abs(distanceFromImpact - radius);
          float ring = 1.0 - smoothstep(width, width * 2.6, ringDistance);
          float envelope = smoothstep(0.015, 0.09, age)
            * (1.0 - smoothstep(0.66, 1.0, age));
          float impactCrown = (1.0 - smoothstep(0.025, 0.12, distanceFromImpact))
            * (1.0 - smoothstep(0.015, 0.115, age))
            * impactStrength;
          float signedFace = sign(distanceFromImpact - radius);
          slope += radial / max(distanceFromImpact, 0.001)
            * ring * envelope * signedFace * 0.12 * impactStrength;
          rings += ring * envelope * impactStrength + impactCrown * 0.82;
        }
      }
      return vec3(slope, min(rings, 1.0));
    }

    float sceneEyeDepth(vec2 uv) {
      float depth = texture2D(uDepthTexture, uv).x;
      return -perspectiveDepthToViewZ(depth, uNear, uFar);
    }

    vec4 screenReflection(vec3 origin, vec3 direction) {
      float stepLength = 2.4;
      float previousDifference = -1.0;
      vec2 previousUv = vec2(0.0);
      for (int i = 1; i <= 24; i++) {
        vec3 point = origin + direction * (stepLength * float(i));
        vec4 clip = uProjectionMatrix * viewMatrix * vec4(point, 1.0);
        if (clip.w <= 0.0) break;
        vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
        if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0) break;
        float sceneDepth = sceneEyeDepth(uv);
        float rayDepth = -(viewMatrix * vec4(point, 1.0)).z;
        float difference = rayDepth - sceneDepth;
        if (difference > 0.0 && difference < 7.0 && sceneDepth < uFar * 0.97) {
          float refinement = previousDifference < 0.0
            ? 1.0
            : clamp(-previousDifference / (difference - previousDifference), 0.0, 1.0);
          vec2 hitUv = mix(previousUv, uv, refinement);
          vec2 edge = smoothstep(0.0, 0.12, hitUv) * smoothstep(0.0, 0.12, 1.0 - hitUv);
          return vec4(texture2D(uRefractionTexture, hitUv).rgb, edge.x * edge.y);
        }
        previousDifference = difference;
        previousUv = uv;
        stepLength *= 1.07;
      }
      return vec4(0.0);
    }

    void main() {
      vec3 sunDirection = normalize(uSunDirection);
      vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
      float distanceToCamera = length(cameraPosition - vWorldPosition);
      float detailFade = exp(-distanceToCamera * 0.008);
      bool underwater = uCameraUnderwater > 0.5;

      vec3 normal = normalize(vWorldNormal);
      vec2 detailSlope = spectralDetailSlope(vWorldPosition.xz, uTime);
      vec3 rainDetail = rainRippleDetail(vWorldPosition.xz, uTime);
      float rainDetailFade = exp(
        -distanceToCamera * (underwater ? 0.011 : 0.024)
      );
      detailSlope += rainDetail.xy * uRainIntensity * rainDetailFade;
      float rainImpact = rainDetail.z * uRainIntensity * rainDetailFade;
      float detailStrength = mix(0.28, 0.78, detailFade);
      normal = normalize(vec3(
        normal.x - detailSlope.x * detailStrength,
        normal.y,
        normal.z - detailSlope.y * detailStrength
      ));
      vec3 upwardNormal = normal;
      if (dot(normal, viewDirection) < 0.0) normal = -normal;

      vec3 color;
      float fresnel = fresnelSchlick(max(dot(normal, viewDirection), 0.0), 0.02);
      float microRoughness = clamp(
        0.3
          + length(detailSlope) * 0.72
          + uSeaSeverity * 0.12
          + uRainIntensity * 0.22,
        0.32,
        0.82
      );

      if (!underwater) {
        vec3 reflectionRay = reflect(-viewDirection, normal);
        vec3 skyRay = reflectionRay;
        skyRay.y = abs(skyRay.y);
        vec3 reflection = arcticSky(skyRay, sunDirection);
        vec3 roughSky = mix(
          vec3(0.075, 0.105, 0.12),
          vec3(0.31, 0.36, 0.37),
          clamp(skyRay.y * 0.72 + uDaylight * 0.2, 0.0, 1.0)
        );
        reflection = mix(reflection, roughSky, microRoughness * 0.58);
        vec4 sceneReflection = screenReflection(vWorldPosition, reflectionRay);
        float ssrElevation = smoothstep(0.08, 0.32, reflectionRay.y);
        reflection = mix(
          reflection,
          sceneReflection.rgb,
          sceneReflection.a * ssrElevation * 0.2 * (1.0 - microRoughness * 0.72)
        );

        vec2 screenUv = gl_FragCoord.xy / uResolution;
        vec2 refractedUv = clamp(
          screenUv + normal.xz * mix(0.003, 0.007, detailFade),
          vec2(0.002),
          vec2(0.998)
        );
        float waterDepth = -vViewZ;
        float sceneDepth = sceneEyeDepth(refractedUv);
        if (sceneDepth < waterDepth) {
          refractedUv = screenUv;
          sceneDepth = sceneEyeDepth(refractedUv);
        }
        float thickness = max(sceneDepth - waterDepth, 0.0);
        vec3 sourceColor = texture2D(uRefractionTexture, refractedUv).rgb;
        vec3 absorption = vec3(0.34, 0.105, 0.055);
        vec3 transmittance = exp(-absorption * thickness);
        vec3 waterColor = mix(
          uShallowColor,
          uDeepColor,
          1.0 - exp(-thickness * 0.055)
        );
        vec3 transmitted = sourceColor * transmittance + waterColor * (1.0 - transmittance);
        color = mix(transmitted, reflection, fresnel);

        vec3 halfVector = normalize(viewDirection + sunDirection);
        float sunExponent = mix(
          88.0,
          13.0,
          smoothstep(0.28, 0.82, microRoughness)
        );
        float sunGlint = pow(max(dot(normal, halfVector), 0.0), sunExponent);
        color += vec3(0.68, 0.78, 0.79) * sunGlint * 0.3;

        float backLight = pow(max(dot(viewDirection, -sunDirection), 0.0), 4.0);
        float thinCrest = smoothstep(0.7, 2.7, vHeight) * max(upwardNormal.y, 0.0);
        color += vec3(0.18, 0.43, 0.48) * backLight * thinCrest * 0.45;

        // Approximate the self-shadowing that makes a gale read as tonnes of
        // moving water rather than polished silver cloth. Troughs and lee
        // faces stay cold and dark while only exposed crests catch the sky.
        float troughLight = smoothstep(-3.8, 2.4, vHeight);
        float slopeLight = smoothstep(-0.24, 0.58, dot(upwardNormal, sunDirection));
        float stormContrast = mix(1.0, mix(0.58, 1.06, troughLight * 0.62 + slopeLight * 0.38), uSeaSeverity);
        color *= stormContrast;
      } else {
        vec3 incident = normalize(vWorldPosition - cameraPosition);
        vec3 refracted = refract(incident, -upwardNormal, 1.333);
        vec3 reflectedRay = reflect(incident, -upwardNormal);
        vec3 waterGlow = mix(uShallowColor, vec3(0.68, 0.84, 0.87), 0.42);
        float reflectedElevation = smoothstep(-0.82, 0.42, reflectedRay.y);
        vec3 internalReflection = mix(
          uDeepColor * 0.42,
          uShallowColor * 0.82,
          reflectedElevation
        );
        float undersideRoughness = clamp(
          microRoughness + uRainIntensity * 0.16,
          0.42,
          0.94
        );
        internalReflection = mix(
          internalReflection,
          uShallowColor * 0.76,
          undersideRoughness * 0.36
        );
        float reflectionShimmer = clamp(
          length(detailSlope) * 2.4 + dot(detailSlope, reflectedRay.xz),
          0.0,
          1.0
        );
        internalReflection += vec3(0.34, 0.62, 0.67)
          * smoothstep(0.3, 0.82, reflectionShimmer)
          * 0.12;
        if (dot(refracted, refracted) < 0.0001) {
          // Total internal reflection turns the underside into a restless,
          // dark mirror instead of a flat luminous ceiling.
          color = internalReflection * 1.03;
        } else {
          vec3 sky = arcticSky(refracted, sunDirection);
          float luminance = max(sky.r, max(sky.g, sky.b));
          sky = mix(sky, vec3(0.72, 0.84, 0.88) * luminance, 0.45);
          vec3 transmittedSky = mix(waterGlow, sky * 1.15, 0.78);
          color = mix(transmittedSky, internalReflection, max(fresnel, 0.08));
        }
        float shimmer = clamp(
          0.5 + dot(detailSlope, vec2(0.8, -0.6)) * 2.2,
          0.0,
          1.0
        );
        color += vec3(0.62, 0.78, 0.82) * smoothstep(0.62, 0.92, shimmer) * 0.045;
        // Seen from below, rain reads as bright expanding dents in the moving
        // ceiling plus tiny pressure flashes, never as streaks falling through
        // the water volume.
        float undersideFacing = smoothstep(
          0.05,
          0.78,
          max(dot(-normal, viewDirection), 0.0)
        );
        float undersideImpact = pow(clamp(rainImpact, 0.0, 1.0), 0.68);
        color += vec3(0.58, 0.82, 0.85)
          * undersideImpact
          * mix(0.38, 0.78, undersideFacing);
        color = mix(
          color,
          vec3(0.34, 0.59, 0.63),
          clamp(undersideImpact * 0.28, 0.0, 0.24)
        );
      }

      float foldEnergy = 1.0 - smoothstep(0.16, 0.58, vFold);
      float windCrest = smoothstep(0.28, 1.72, vWindHeight);
      float steepFace = smoothstep(0.035, 0.24, 1.0 - max(upwardNormal.y, 0.0));
      float weatherWhitecap = uWeather.x * 0.12 + uWeather.y * 0.22;
      float foamEnergy = clamp(
        foldEnergy * 0.5
          + windCrest * (0.34 + foldEnergy * 0.42)
          + steepFace * windCrest * 0.18
          + weatherWhitecap
          + uSeaSeverity * 0.08,
        0.0,
        1.0
      );
      vec2 foamPoint = vec2(
        dot(vWorldPosition.xz, uWindDirection),
        dot(vWorldPosition.xz, vec2(-uWindDirection.y, uWindDirection.x)) * 2.8
      );
      float crestNoise = fbm(foamPoint * 0.092 - uWindDirection * uTime * 0.24, 5) * 0.68
        + fbm(vWorldPosition.xz * 0.63 + uTime * 0.1, 4) * 0.32;
      float brokenCrest = smoothstep(
        0.52,
        0.79,
        crestNoise + foamEnergy * 0.4
      ) * smoothstep(0.08, 0.44, foamEnergy);
      float foamGranulation = fbm(
        vWorldPosition.xz * 1.45 - uWindDirection * uTime * 0.38,
        3
      );
      brokenCrest *= smoothstep(
        0.22,
        0.7,
        foamGranulation + foamEnergy * 0.32
      );
      float streakNoise = fbm(
        vec2(foamPoint.x * 0.028 - uTime * 0.16, foamPoint.y * 0.075),
        5
      );
      float windStreak = smoothstep(0.59, 0.81, streakNoise)
        * smoothstep(0.16, 0.72, foamEnergy)
        * (0.35 + windCrest * 0.65);
      float foam = clamp(brokenCrest + windStreak * uSeaSeverity, 0.0, 1.0);
      float foamLight = 0.64 + max(dot(upwardNormal, sunDirection), 0.0) * 0.28;
      color = mix(color, uFoamColor * foamLight, foam * mix(0.54, 0.78, uSeaSeverity));

      // Expanding, randomized rings are visible as water impacts rather than
      // a screen-space rain texture. Their normal contribution above already
      // roughens reflections; this restrained value cue makes them readable.
      if (!underwater) {
        color = mix(
          color,
          mix(uShallowColor, uFoamColor, 0.46),
          clamp(rainImpact * 0.035, 0.0, 0.03)
        );
      }

      if (!underwater) {
        vec3 horizonDirection = normalize(vec3(-viewDirection.x, 0.025, -viewDirection.z));
        vec3 horizonSky = min(arcticSky(horizonDirection, sunDirection), vec3(1.25));
        vec3 saltMist = mix(
          vec3(0.23, 0.29, 0.31),
          vec3(0.39, 0.43, 0.43),
          uDaylight
        );
        vec3 haze = mix(horizonSky, saltMist, 0.46 + uRainIntensity * 0.16);
        float atmosphericLoad = clamp(
          uWeather.z * 0.62
            + uWeather.x * 0.3
            + uWeather.y * 0.42
            + uSeaSeverity * 0.22,
          0.0,
          1.0
        );
        float hazeDensity = mix(0.00042, 0.00115, atmosphericLoad);
        float distanceHaze = 1.0 - exp(-distanceToCamera * hazeDensity);
        float grazingView = 1.0 - smoothstep(
          0.025,
          0.24,
          abs(viewDirection.y)
        );
        float mistBreakup = mix(
          0.72,
          1.0,
          noised(
            vWorldPosition.xz * 0.0018 + uTime * vec2(0.002, -0.001)
          ).x
        );
        float lowMarineMist = grazingView
          * (1.0 - exp(-distanceToCamera * 0.00135))
          * mistBreakup;
        float hazeAmount = clamp(
          distanceHaze * 0.62 + lowMarineMist * 0.34,
          0.0,
          0.72
        );
        float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = mix(color, vec3(luminance) * vec3(0.91, 0.98, 1.02), hazeAmount * 0.12);
        color = mix(color, haze, hazeAmount);
      } else {
        float underwaterFog = 1.0 - exp(-distanceToCamera * 0.017);
        color = mix(color, uDeepColor * 0.75, underwaterFog);
      }

      float tacticalOpacity = 1.0 - smoothstep(0.02, 0.52, uTacticalView);
      gl_FragColor = vec4(max(color, vec3(0.0)), tacticalOpacity);
    }
  `;
}

const NOISE_GLSL = `
  float hash21(vec2 point) {
    point = fract(point * vec2(123.34, 456.21));
    point += dot(point, point + 45.32);
    return fract(point.x * point.y);
  }

  vec3 noised(vec2 point) {
    vec2 cell = floor(point);
    vec2 fraction = fract(point);
    vec2 curve = fraction * fraction * fraction *
      (fraction * (fraction * 6.0 - 15.0) + 10.0);
    vec2 derivative = 30.0 * fraction * fraction *
      (fraction * (fraction - 2.0) + 1.0);
    float a = hash21(cell);
    float b = hash21(cell + vec2(1.0, 0.0));
    float c = hash21(cell + vec2(0.0, 1.0));
    float d = hash21(cell + vec2(1.0, 1.0));
    float k1 = b - a;
    float k2 = c - a;
    float k3 = a - b - c + d;
    float value = a + k1 * curve.x + k2 * curve.y + k3 * curve.x * curve.y;
    vec2 gradient = derivative * vec2(k1 + k3 * curve.y, k2 + k3 * curve.x);
    return vec3(value, gradient);
  }

  float fbm(vec2 point, int octaves) {
    float amplitude = 0.5;
    float sum = 0.0;
    mat2 rotation = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 7; i++) {
      if (i >= octaves) break;
      sum += amplitude * noised(point).x;
      point = rotation * point;
      amplitude *= 0.5;
    }
    return sum;
  }
`;

const ARCTIC_SKY_GLSL = `
  vec3 arcticSky(vec3 direction, vec3 sunDirection) {
    direction = normalize(direction);
    float up = clamp(direction.y, -1.0, 1.0);
    float sunAmount = max(dot(direction, sunDirection), 0.0);
    float horizonAmount = pow(clamp(1.0 - up, 0.0, 1.0), 2.2);
    vec3 zenith = mix(vec3(0.006, 0.012, 0.018), vec3(0.016, 0.04, 0.055), uDaylight);
    vec3 lowSunHorizon = vec3(0.44, 0.31, 0.25);
    vec3 coldHorizon = vec3(0.27, 0.36, 0.40);
    float lowSun = (1.0 - smoothstep(0.18, 0.62, uDaylight)) * uDaylight;
    vec3 horizon = mix(coldHorizon, lowSunHorizon, lowSun * 0.72);
    vec3 color = mix(zenith, horizon, horizonAmount);
    color = mix(color, vec3(0.012, 0.026, 0.034), smoothstep(0.02, -0.22, up));

    if (up > 0.025) {
      float planeDistance = 980.0 / max(up, 0.04);
      vec2 cloudPoint = direction.xz * planeDistance * 0.0012
        + uTime * vec2(0.0045, 0.0025);
      float broad = fbm(cloudPoint, 5);
      float detail = fbm(cloudPoint * 3.1 + 7.0, 4);
      float density = broad * 0.72 + detail * 0.28;
      float weatherCloud = clamp(
        uWeather.x * 0.18
          + uWeather.y * 0.28
          - uWeather.w * 0.08
          + uSeaSeverity * 0.2,
        -0.08,
        0.46
      );
      float cloud = smoothstep(0.43 - weatherCloud, 0.64 - weatherCloud, density)
        * smoothstep(0.03, 0.18, up);
      vec3 cloudDark = vec3(0.075, 0.095, 0.105);
      vec3 cloudLight = vec3(0.39, 0.43, 0.43);
      vec3 cloudColor = mix(cloudDark, cloudLight, smoothstep(0.44, 0.78, density));
      cloudColor += vec3(0.42, 0.49, 0.50) * pow(sunAmount, 5.0) * 0.45;
      cloudColor *= mix(0.72, 1.0, uDaylight);
      color = mix(
        color,
        cloudColor,
        cloud * clamp(0.76 + uWeather.y * 0.18 + uSeaSeverity * 0.12, 0.0, 0.98)
      );
    }

    color += vec3(0.57, 0.68, 0.70)
      * pow(sunAmount, 16.0)
      * 0.28
      * uDaylight
      * (1.0 - uSeaSeverity * 0.58);
    float sunDisk = smoothstep(0.99955, 0.9998, sunAmount);
    color += mix(vec3(1.0, 0.42, 0.18), vec3(0.82, 0.91, 0.93), uDaylight)
      * sunDisk * 3.4 * uDaylight * (1.0 - uSeaSeverity * 0.72);
    float horizonHaze = pow(clamp(1.0 - abs(up), 0.0, 1.0), 4.0)
      * clamp(
        uWeather.z * 0.66
          + uWeather.x * 0.3
          + uWeather.y * 0.42
          + uSeaSeverity * 0.2,
        0.0,
        1.0
      );
    color = mix(color, vec3(0.31, 0.36, 0.37) * mix(0.45, 1.0, uDaylight), horizonHaze);
    return max(color, vec3(0.0));
  }
`;
