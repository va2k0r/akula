import {
  ACESFilmicToneMapping,
  DepthTexture,
  HalfFloatType,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Timer,
  UnsignedIntType,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { AcousticSignatureEngine, type AcousticCode } from "../audio";
import { AkulaVehicle, ascentBubbleIntensity } from "./AkulaVehicle";
import { ArcticWorld } from "./ArcticWorld";
import { AudioSessionCoordinator } from "./AudioSessionCoordinator";
import { BallastBlowCooldown } from "./BallastBlowCooldown";
import { CameraRig, type CameraViewSnapshot } from "./CameraRig";
import {
  CONTACT_ACQUISITION_DWELL_SECONDS,
  CONTACT_ACQUISITION_PULSE_OFFSETS_SECONDS,
  INITIAL_CONTACT_ACQUISITION_STATE,
  contactBearingInsideCameraCone,
  contactAcquisitionProgress,
  contactDirectionalCueEnabled,
  contactSearchCueEnabled,
  selectAcquisitionCandidate,
  updateContactAcquisition,
  type AcquisitionCandidate,
  type ContactAcquisitionState,
} from "./ContactAcquisition";
import {
  ContactTracker,
  type ContactTrackSnapshot,
  type ContactTrackStatus,
  type SanitizedSonarMeasurement,
} from "./ContactTracker";
import {
  contactSignalStage,
  type ContactSignalStage,
} from "./ContactSensoryProgression";
import { FROSTBITE_CONTACT_SIGNATURE } from "./ContactSignature";
import {
  directionalContactHapticElapsedTime,
  directionalContactHapticProfile,
  INACTIVE_DIRECTIONAL_HAPTIC_PROFILE,
  type DirectionalContactHapticProfile,
} from "./DirectionalContactHaptics";
import { GameAudio } from "./GameAudio";
import type { HullStressSnapshot } from "./HullStressAudio";
import {
  AKULA_PLAYER_ACOUSTIC_CLASS,
  DEFAULT_ENEMY_BEHAVIOR_CONFIG,
  EnemySubmarine,
  huntScenarioFromSearch,
  type EnemySubmarineSnapshot,
  type HuntScenarioPreset,
} from "./EnemySubmarine";
import {
  DEBUG_HAPTIC_MAGNITUDE_MULTIPLIER,
  InputController,
  shouldPlayTelegraphClunkOnRelease,
  telegraphHapticFeedbackForTransition,
  type ControlFrame,
} from "./InputController";
import { TMA_DEBUG } from "./NavalContactCatalog";
import { NORTH_SEA_RIG_POSITION } from "./NorthSeaSurfaceActivity";
import { forwardRingSectorSensitivity } from "./PassiveSonarRing";
import { SonarStation } from "./SonarStation";
import { SeabedLidar } from "./SeabedLidar";
import {
  DEBUG_SENSOR_RANGE_MULTIPLIER,
  simulateVesselPassiveSonar,
  type PassiveSonarMeasurement,
} from "./SonarLogic";
import {
  StrategicPlot,
  strategicRecommendedViewSpanMeters,
  strategicTrackHistory,
  type StrategicPlotFrame,
} from "./StrategicPlot";
import {
  SubmarineDynamics,
  isPropulsionStopped,
  metersPerSecondToKnots,
  telegraphLabel,
  yawPivotOffsetMeters,
  type CollisionKind,
} from "./SubmarineDynamics";
import { TacticalMiniMap } from "./TacticalMiniMap";
import {
  appendTorpedoRunToEnable,
  closestTorpedoTargetLead,
  cycleTorpedoTargetLead,
  initialTorpedoEnablePoint,
  moveTorpedoEnablePoint,
  torpedoTargetLead,
  type TorpedoRunToEnablePlan,
  type TorpedoTargetLead,
  type TorpedoTargetPrediction,
} from "./TorpedoFireControl";
import { UnderwaterPass } from "./UnderwaterPass";
import {
  underwaterVisibilityMeters,
  type UnderwaterOpticsState,
} from "./UnderwaterOptics";
import {
  ICE_KEELS,
  MAP_HALF_LENGTH,
  MAP_HALF_WIDTH,
  terrainHeightAt,
} from "./WorldGeometry";
import {
  WEAPON_CATEGORIES,
  cycleWeaponCategory,
  weaponDrumPosition,
  type WeaponCategory,
} from "./WeaponSelector";

type MissionStage = "search" | "identify" | "tma";

const DEBUG_PLAYER_SPEED_MULTIPLIER = 10;

export interface AkulaDebugSnapshot {
  readonly ready: boolean;
  readonly started: boolean;
  readonly waterFxEnabled: boolean;
  readonly enemyPosEnabled: boolean;
  readonly vibrationX100Enabled: boolean;
  readonly sensorsX100Enabled: boolean;
  readonly playerSpeedX10Enabled: boolean;
  readonly playerSimulationSpeedMultiplier: number;
  readonly hapticMagnitudeMultiplier: number;
  readonly sensorRangeMultiplier: number;
  readonly gamepadConnected: boolean;
  readonly gamepadWakePending: boolean;
  readonly gamepadWakePhase: string;
  readonly haptics: string;
  readonly directionalContactHaptics: Readonly<{
    active: boolean;
    intervalMilliseconds: number;
    durationMilliseconds: number;
    weakMagnitude: number;
    alignmentDegrees: number;
    alignmentAmount: number;
    signalQuality: number;
  }>;
  readonly contactAcquisition: ContactAcquisitionState;
  readonly depthMeters: number;
  readonly depthRateMetersPerSecond: number;
  readonly speedKnots: number;
  readonly turnRateDegreesPerSecond: number;
  readonly throttle: number;
  readonly propulsionThrottle: number;
  readonly ballastBlowCooldownSeconds: number;
  readonly headingRadians: number;
  readonly yawPivotOffsetMeters: number;
  readonly propeller: Readonly<{
    angleRadians: number;
    revolutionsPerMinute: number;
    cavitationStrength: number;
    radiusMeters: number;
    effectsOrigin: Readonly<{ x: number; y: number; z: number }>;
  }>;
  readonly floorClearance: number;
  readonly iceClearance: number | null;
  readonly seabedLidar: Readonly<{
    active: boolean;
    amount: number;
    radiusMeters: number;
    returnIntervalSeconds: number;
    scanAgeSeconds: number;
  }>;
  readonly signalQuality: number;
  readonly contactSignalStage: ContactSignalStage;
  readonly contactRingReturnActive: boolean;
  readonly contactRangeMeters: number | null;
  readonly sonarListening: boolean;
  readonly sonarFocused: boolean;
  readonly contactAudioInCameraSector: boolean;
  readonly audioSessionActive: boolean;
  readonly audioOutputGain: number;
  readonly audioContextState: AudioContextState;
  readonly soundtrackPlaying: boolean;
  readonly soundtrackGain: number;
  readonly surfaceEnvironment: Readonly<{
    loaded: boolean;
    playing: boolean;
    underwaterAmount: number;
    airExposure: number;
    stormGain: number;
    stormLowpassHz: number;
    stormFilterQ: number;
  }>;
  readonly sonarContactReportsScheduled: number;
  readonly ownShipNoise: Readonly<{
    machinery: number;
    flow: number;
  }>;
  readonly hullStress: HullStressSnapshot;
  readonly contactClassified: boolean;
  readonly missionStage: MissionStage;
  readonly huntScenario: HuntScenarioPreset;
  readonly enemy: Readonly<{
    classId: string;
    aiState: string;
    speedKt: number;
    headingRad: number;
    sourceLevel: number;
    cavitating: boolean;
    maneuverId: string;
    maneuverCourseRad: number;
    maneuverSpeedKt: number;
    perceptionState: string;
    perceivedPlayerBearingRad: number | null;
    perceivedPlayerQuality: number;
    receivedPlayerSignal: number;
  }>;
  readonly torpedoFireControl: Readonly<{
    status: "idle" | "placing" | "confirmed";
    enablePoint: Readonly<{ x: number; z: number }> | null;
    cursorPoint: Readonly<{ x: number; z: number }> | null;
    queuedPoints: readonly Readonly<{ x: number; z: number }>[];
    queuedTargets: readonly (string | null)[];
    targetPrediction: Readonly<{
      trackId: string;
      trackLabel: string;
      selectionMode: "automatic" | "manual";
      candidateIndex: number;
      candidateCount: number;
      travelTimeSeconds: number;
      markerSeparationMeters: number;
      predictedPosition: Readonly<{ x: number; z: number }>;
    }> | null;
    lastSalvoSize: number;
    totalLaunched: number;
  }>;
  readonly weaponSelection: Readonly<{
    id: "torpedo" | "missile" | "mine";
    russianName: string;
    available: boolean;
  }>;
  readonly contacts: readonly Readonly<{
    id: string;
    number: number;
    status: ContactTrackStatus;
    classId: string | null;
    observations: number;
    estimatedSpeedKt: number | null;
    hypotheses: number;
    spreadMeters: number | null;
    fitResidual: number | null;
    confidence: number;
    motionLeg: number;
    possibleManeuver: boolean;
  }>[];
  readonly tmaTruth:
    | Readonly<{
        classId: string;
        speedKt: number;
        position: Readonly<{ x: number; z: number }>;
      }>
    | undefined;
  readonly position: Readonly<{ x: number; y: number; z: number }>;
  readonly camera: Readonly<{
    mode: "chase" | "tactical";
    position: Readonly<{ x: number; y: number; z: number }>;
    tacticalAmount: number;
    tacticalZoom: number;
    tacticalDistance: number;
    tacticalSpanMeters: number;
    tacticalYaw: number;
  }>;
  readonly underwater: Readonly<{
    active: boolean;
    amount: number;
    cameraDepthMeters: number;
    visibilityMeters: number;
  }>;
  readonly northSeaEnvironment: Readonly<{
    phase: string;
    rain: number;
    visibleRain: number;
    squall: number;
    saltHaze: number;
    surfaceVisibilityMeters: number;
    phytoplanktonBloom: number;
  }>;
  readonly renderer: Readonly<{
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
  }>;
  readonly performance: Readonly<{
    averageFps: number;
    p95FrameMs: number;
    maximumFrameMs: number;
  }>;
}

interface AkulaDebugApi {
  readonly getState: () => AkulaDebugSnapshot;
}

declare global {
  interface Window {
    __AKULA_DEBUG__?: AkulaDebugApi;
  }
}

const EMPTY_FRAME: ControlFrame = {
  turn: 0,
  dive: 0,
  leftTrigger: 0,
  rightTrigger: 0,
  ballast: 0,
  throttleStep: 0,
  gamepadThrottleStep: 0,
  gamepadThrottleReleaseStep: 0,
  cameraYaw: 0,
  cameraPitch: 0,
  cameraCenter: false,
  cameraMapToggle: false,
  torpedoPlan: false,
  ping: false,
  submit: false,
  cancel: false,
  digitSelectDelta: 0,
  digitValueDelta: 0,
  directDigit: undefined,
  reset: false,
  gamepadConnected: false,
  gamepadWakePending: false,
};

export function hasContactAnalysisInput(
  frame: Pick<
    ControlFrame,
    "digitSelectDelta" | "digitValueDelta" | "directDigit" | "submit"
  >,
): boolean {
  return (
    frame.submit ||
    frame.digitSelectDelta !== 0 ||
    frame.digitValueDelta !== 0 ||
    frame.directDigit !== undefined
  );
}

/** A crew-assigned bearing mark survives HELD, WEAK, and LOST track states. */
export function crewContactMarkCanProject(
  track: Pick<ContactTrackSnapshot, "status"> | undefined,
  hasRecordedBearing: boolean,
  tacticalAmount: number,
): boolean {
  return track !== undefined && hasRecordedBearing && tacticalAmount < 0.08;
}

export class PrototypeGame {
  private readonly abortController = new AbortController();
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly overlayScene = new Scene();
  private readonly camera = new PerspectiveCamera(50, 1, 0.5, 10_000);
  private readonly cameraForward = new Vector3();
  private readonly projectedContactBearing = new Vector3();
  private readonly projectedEnemyTruth = new Vector3();
  private readonly composer: EffectComposer;
  private readonly underwaterPass: UnderwaterPass;
  private readonly world: ArcticWorld;
  private readonly seabedLidar: SeabedLidar;
  private readonly vehicle: AkulaVehicle;
  private readonly cameraRig = new CameraRig(this.camera);
  private readonly dynamics = new SubmarineDynamics();
  private readonly huntScenario: HuntScenarioPreset;
  private readonly enemy: EnemySubmarine;
  private enemySnapshot: EnemySubmarineSnapshot;
  private readonly miniMap: TacticalMiniMap;
  private readonly strategicPlot: StrategicPlot;
  private readonly contactTracker = new ContactTracker();
  private readonly input = new InputController();
  private readonly audio = new GameAudio();
  private readonly audioSession = new AudioSessionCoordinator(this.audio);
  private readonly sonarEngine: AcousticSignatureEngine;
  private readonly sonar: SonarStation;
  private readonly resizeObserver: ResizeObserver;
  private readonly timer = new Timer();
  private readonly objective: HTMLElement;
  private readonly objectiveDetail: HTMLElement;
  private readonly objectiveProgress: HTMLElement;
  private readonly speedValue: HTMLElement;
  private readonly depthValue: HTMLElement;
  private readonly floorValue: HTMLElement;
  private readonly iceValue: HTMLElement;
  private readonly telegraphValue: HTMLElement;
  private readonly noiseValue: HTMLElement;
  private readonly compassValue: HTMLElement;
  private readonly controlHint: HTMLElement;
  private readonly contactBillboard: HTMLElement;
  private readonly enemyPositionMarker: HTMLElement;
  private readonly enemyPositionLabel: HTMLElement;
  private readonly tacticalOverlay: HTMLElement;
  private readonly tacticalDistanceValue: HTMLElement;
  private readonly mapActionHint: HTMLElement;
  private readonly weaponSelector: HTMLElement;
  private readonly weaponName: HTMLElement;
  private readonly weaponDetail: HTMLElement;
  private readonly weaponStatus: HTMLElement;
  private readonly weaponSalvoCount: HTMLElement;
  private readonly weaponSlots: readonly HTMLElement[];
  private readonly warning: HTMLElement;
  private readonly pingFlash: HTMLElement;
  private readonly debugOutput: HTMLOutputElement;
  private readonly hapticStatusValue: HTMLOutputElement;
  private readonly debugControl = {
    turn: 0,
    dive: 0,
    ballast: 0,
  };
  private debugThrottleStep = 0;
  private debugIcebergViewIndex = 0;
  private developmentEnemyTruthVisible = false;
  private strategicAutoFrameEnabled = false;
  private strategicAutoFrameAge = 0;
  private torpedoPlan: TorpedoRunToEnablePlan | undefined;
  private torpedoPlans: readonly TorpedoRunToEnablePlan[] = [];
  private torpedoCursorPoint: TorpedoRunToEnablePlan["enablePoint"] | undefined;
  private torpedoTargetTrackId: string | undefined;
  private torpedoTargetSelectionMode: "automatic" | "manual" = "automatic";
  private torpedoTargetPrediction: TorpedoTargetPrediction | undefined;
  private selectedWeaponIndex = 0;
  private lastTorpedoLaunchTime = Number.NEGATIVE_INFINITY;
  private lastUnavailableWeaponFireTime = Number.NEGATIVE_INFINITY;
  private lastEmptyTorpedoFireTime = Number.NEGATIVE_INFINITY;
  private lastTorpedoSalvoSize = 0;
  private totalTorpedoesLaunched = 0;
  private animationFrame: number | undefined;
  private disposed = false;
  private ready = false;
  private started = false;
  private waterFxEnabled = true;
  private vibrationX100Enabled = false;
  private sensorsX100Enabled = false;
  private playerSpeedX10Enabled = false;
  private simulationTime = 0;
  private renderTime = 0;
  private missionStage: MissionStage = "search";
  private signal: PassiveSonarMeasurement = {
    worldBearingRad: 0,
    relativeBearingRad: 0,
    signalQuality: 0.1,
    perceivable: false,
    inBlindCone: false,
    environmentMasked: false,
  };
  private currentContactMeasurement: SanitizedSonarMeasurement | undefined;
  private currentAcquisitionCandidate: AcquisitionCandidate | undefined;
  private currentContactCycleDurationSeconds: number;
  private nextContactCadenceUpdateSeconds = 0;
  private playerAccelerationKtPerSec = 0;
  private playerTurnRateDegPerSec = 0;
  private debugTruthRangeMeters: number | undefined;
  private gamepadConnected = false;
  private gamepadWakePending = false;
  private contactAudioInCameraSector = false;
  private directionalContactHaptics: DirectionalContactHapticProfile =
    INACTIVE_DIRECTIONAL_HAPTIC_PROFILE;
  private contactAcquisition: ContactAcquisitionState =
    INITIAL_CONTACT_ACQUISITION_STATE;
  private pendingTelegraphClunkStep = 0;
  private pingCooldown = 0;
  private impactCooldown = 0;
  private readonly ballastBlowCooldown = new BallastBlowCooldown();
  private ascentBubblesActive = false;
  private collisionFlash = 0;
  private sonarFocused = false;
  private contactBillboardOnScreen = false;
  private navigationRevealAge = 0;
  private objectiveRevealAge = 0;
  private controlHintAge = 0;
  private cameraView: CameraViewSnapshot = {
    mode: "chase",
    tacticalAmount: 0,
    tacticalZoom: 0,
    tacticalDistance: 260,
    cameraRangeToOwnship: 120,
    tacticalSpanMeters: 210,
    operationalAmount: 0,
    tacticalYaw: 0,
  };
  private readonly frameTimes: number[] = [];
  private underwaterOptics: UnderwaterOpticsState = {
    amount: 1,
    cameraDepthMeters: 52,
    surfaceHeight: 0,
    visibilityMeters: underwaterVisibilityMeters(52),
  };

  public constructor(private readonly root: HTMLElement) {
    const search = globalThis.location.search;
    const debugEnabled = new URLSearchParams(search).has("debug");
    this.huntScenario = huntScenarioFromSearch(search);
    this.enemy = new EnemySubmarine(
      this.huntScenario,
      DEFAULT_ENEMY_BEHAVIOR_CONFIG,
      debugEnabled,
    );
    this.enemySnapshot = this.enemy.snapshot;
    this.currentContactCycleDurationSeconds =
      this.enemySnapshot.cycleDurationSeconds;
    this.contactTracker.setLoggingEnabled(debugEnabled);
    root.replaceChildren();
    root.innerHTML = createInterfaceMarkup();
    const viewport = requireElement(root, ".viewport");
    this.objective = requireElement(root, '[data-testid="objective"]');
    this.objectiveDetail = requireElement(
      root,
      '[data-testid="objective-detail"]',
    );
    this.objectiveProgress = requireElement(root, ".objective-progress-fill");
    this.speedValue = requireElement(root, '[data-testid="speed"]');
    this.depthValue = requireElement(root, '[data-testid="depth"]');
    this.floorValue = requireElement(root, '[data-testid="floor-clearance"]');
    this.iceValue = requireElement(root, '[data-testid="ice-clearance"]');
    this.telegraphValue = requireElement(root, '[data-testid="telegraph"]');
    this.noiseValue = requireElement(root, '[data-testid="noise-state"]');
    this.compassValue = requireElement(root, '[data-testid="heading"]');
    this.controlHint = requireElement(root, '[data-testid="control-hint"]');
    this.contactBillboard = requireElement(
      root,
      '[data-testid="contact-billboard"]',
    );
    this.enemyPositionMarker = requireElement(
      root,
      '[data-testid="enemy-position-marker"]',
    );
    this.enemyPositionLabel = requireElement(
      this.enemyPositionMarker,
      '[data-testid="enemy-position-label"]',
    );
    this.tacticalOverlay = requireElement(root, ".tactical-overlay");
    this.tacticalDistanceValue = requireElement(
      root,
      '[data-testid="tactical-distance"]',
    );
    this.mapActionHint = requireElement(
      root,
      '[data-testid="map-action-hint"]',
    );
    this.weaponSelector = requireElement(
      root,
      '[data-testid="weapon-selector"]',
    );
    this.weaponName = requireElement(root, '[data-testid="weapon-name"]');
    this.weaponDetail = requireElement(root, '[data-testid="weapon-detail"]');
    this.weaponStatus = requireElement(root, '[data-testid="weapon-status"]');
    this.weaponSalvoCount = requireElement(
      root,
      '[data-testid="weapon-salvo-count"]',
    );
    this.weaponSlots = WEAPON_CATEGORIES.map(({ id }) =>
      requireElement(root, `[data-weapon="${id}"]`),
    );
    this.warning = requireElement(root, '[data-testid="warning"]');
    this.pingFlash = requireElement(root, ".ping-flash");
    this.debugOutput = requireElement<HTMLOutputElement>(
      root,
      '[data-testid="debug-state"]',
    );
    this.hapticStatusValue = requireElement<HTMLOutputElement>(
      root,
      '[data-testid="haptic-status"]',
    );
    this.miniMap = new TacticalMiniMap(
      requireElement<HTMLCanvasElement>(root, '[data-testid="minimap-canvas"]'),
    );
    this.strategicPlot = new StrategicPlot(
      requireElement<HTMLCanvasElement>(
        root,
        '[data-testid="strategic-plot-canvas"]',
      ),
      (trackId) => this.selectContactTrack(trackId),
    );

    this.renderer = new WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.13;
    this.renderer.shadowMap.enabled = true;
    this.renderer.setPixelRatio(
      Math.min(globalThis.devicePixelRatio || 1, 1.75),
    );
    this.renderer.domElement.className = "game-canvas";
    this.renderer.domElement.tabIndex = -1;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "AKULA Arctic submarine prototype",
    );
    viewport.prepend(this.renderer.domElement);

    const composerTarget = new WebGLRenderTarget(1, 1, {
      type: HalfFloatType,
      depthBuffer: true,
    });
    composerTarget.depthTexture = new DepthTexture(1, 1, UnsignedIntType);
    this.composer = new EffectComposer(this.renderer, composerTarget);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.underwaterPass = new UnderwaterPass(this.camera);
    this.composer.addPass(this.underwaterPass);
    const bloom = new UnrealBloomPass(new Vector2(1, 1), 0.38, 0.62, 0.9);
    bloom.threshold = 0.86;
    bloom.strength = 0.42;
    bloom.radius = 0.58;
    this.composer.addPass(bloom);
    this.composer.addPass(new OutputPass());

    this.world = new ArcticWorld(this.scene);
    this.seabedLidar = new SeabedLidar(this.scene);
    this.vehicle = new AkulaVehicle(this.scene, this.overlayScene);
    this.bindDebugMenu();
    this.sonarEngine = new AcousticSignatureEngine({
      audioContext: this.audio.context,
      output: this.audio.sonarContactInput,
      signature: this.enemySnapshot.classDefinition.signatureCode,
      cycleDuration: this.enemySnapshot.cycleDurationSeconds,
      soundProfileId: this.enemySnapshot.classDefinition.audioProfileId,
      continuousProfileMix: true,
    });
    this.sonar = new SonarStation(
      requireElement(root, ".sonar-panel"),
      this.sonarEngine,
      {
        onApplyHypothesis: (trackId, signatureCode) =>
          this.applyContactHypothesis(trackId, signatureCode),
        onRequestClose: () => this.setSonarFocused(false),
      },
    );

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(root);
    root.addEventListener("pointerdown", this.resumeAudio, {
      signal: this.abortController.signal,
    });
    globalThis.addEventListener("keydown", this.resumeAudio, {
      signal: this.abortController.signal,
    });
    globalThis.addEventListener("focus", this.focusGameSurface, {
      signal: this.abortController.signal,
    });
    if (debugEnabled) {
      root.classList.add("debug-mode");
      this.bindDebugControls();
    }
    this.world.setTmaDebugContactVisible(false);
    globalThis.addEventListener("pagehide", () => this.dispose(), {
      once: true,
      signal: this.abortController.signal,
    });

    if (debugEnabled) {
      window.__AKULA_DEBUG__ = { getState: () => this.getDebugState() };
    }
    if (document.hasFocus()) {
      this.focusGameSurface();
    }
    this.timer.connect(document);
    this.resize();
    this.cameraView = this.cameraRig.update(
      this.dynamics.state,
      0,
      0,
      true,
      false,
      0,
      1 / 60,
    );
    this.animationFrame = requestAnimationFrame(this.tick);
  }

  public async initialize(): Promise<void> {
    await Promise.all([
      this.vehicle.initialize(),
      this.world.initialize(),
      this.audio.prepareSoundtrack(),
      this.audio.prepareSonarist(),
      this.audio.prepareHullStress(),
      this.audio.prepareSurfaceEnvironment(),
    ]);
    if (this.disposed) {
      return;
    }
    this.ready = true;
    this.startGameplay();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.animationFrame !== undefined) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = undefined;
    }
    this.abortController.abort();
    this.resizeObserver.disconnect();
    this.input.dispose();
    this.audioSession.dispose();
    this.sonar.dispose();
    this.sonarEngine.dispose();
    this.audio.dispose();
    this.vehicle.dispose();
    this.seabedLidar.dispose();
    this.world.dispose();
    this.miniMap.dispose();
    this.strategicPlot.dispose();
    this.underwaterPass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.timer.dispose();
    delete window.__AKULA_DEBUG__;
  }

  private readonly tick = (timestamp: number): void => {
    this.timer.update(timestamp);
    const rawDelta = this.timer.getDelta();
    const deltaSeconds = Math.min(rawDelta, 0.05);
    if (rawDelta > 0 && rawDelta < 0.25) {
      this.frameTimes.push(rawDelta * 1_000);
      if (this.frameTimes.length > 240) {
        this.frameTimes.shift();
      }
    }
    this.renderTime += deltaSeconds;
    let frame = EMPTY_FRAME;
    let contactAnalysisConsumedCancel = false;
    if (this.started) {
      frame = this.applyDebugControls(this.input.sample());
      contactAnalysisConsumedCancel = this.sonarFocused && frame.cancel;
      this.simulationTime += deltaSeconds;
      this.updateSimulation(frame, deltaSeconds);
    }

    let cameraInput = this.started ? frame : EMPTY_FRAME;
    if (contactAnalysisConsumedCancel) {
      cameraInput = { ...cameraInput, cameraCenter: false };
    }
    const torpedoPlanningConsumesCamera = this.started
      ? this.updateTorpedoFireControl(frame, deltaSeconds)
      : false;
    if (torpedoPlanningConsumesCamera) {
      cameraInput = {
        ...cameraInput,
        cameraYaw: 0,
        cameraPitch: 0,
        cameraCenter: false,
        cameraMapToggle: false,
      };
    }
    let cameraMapToggle = cameraInput.cameraMapToggle;
    if (cameraMapToggle && this.cameraView.mode !== "tactical") {
      const recommendedSpan = this.recommendedStrategicViewSpanMeters();
      if (recommendedSpan !== undefined) {
        this.cameraRig.frameTacticalSpan(recommendedSpan, true);
        this.strategicAutoFrameEnabled = true;
        this.strategicAutoFrameAge = 0;
        cameraMapToggle = false;
      }
    } else if (cameraMapToggle) {
      this.strategicAutoFrameEnabled = false;
      this.strategicAutoFrameAge = 0;
    }
    if (
      this.cameraView.mode === "tactical" &&
      Math.abs(cameraInput.cameraPitch) > 0.16
    ) {
      this.strategicAutoFrameEnabled = false;
      this.strategicAutoFrameAge = 0;
    }
    if (this.strategicAutoFrameEnabled && this.cameraView.mode === "tactical") {
      this.strategicAutoFrameAge += deltaSeconds;
      if (this.strategicAutoFrameAge >= 0.8) {
        this.strategicAutoFrameAge = 0;
        const recommendedSpan = this.recommendedStrategicViewSpanMeters();
        if (
          recommendedSpan !== undefined &&
          Math.abs(recommendedSpan - this.cameraView.tacticalSpanMeters) >
            Math.max(500, this.cameraView.tacticalSpanMeters * 0.06)
        ) {
          this.cameraRig.frameTacticalSpan(recommendedSpan);
        }
      }
    }
    this.cameraView = this.cameraRig.update(
      this.dynamics.state,
      this.sonarFocused ? 0 : cameraInput.cameraYaw,
      this.sonarFocused ? 0 : cameraInput.cameraPitch,
      cameraInput.cameraCenter,
      cameraMapToggle,
      this.renderTime,
      deltaSeconds,
    );
    if (this.cameraView.tacticalAmount > 0.12 && this.sonarFocused) {
      this.setSonarFocused(false);
    }
    this.world.setTacticalView(this.cameraView.tacticalAmount);
    this.vehicle.setTacticalView(
      this.cameraView.tacticalAmount,
      this.cameraView.cameraRangeToOwnship,
    );
    const seabedLidarReturn = this.seabedLidar.update(
      this.dynamics.state,
      deltaSeconds,
      Math.max(this.cameraView.tacticalAmount, this.sonarFocused ? 1 : 0),
    );
    if (seabedLidarReturn !== undefined) {
      this.input.playSeabedLidarReturn(seabedLidarReturn);
    }
    this.updateDirectionalContactHaptics(cameraInput);
    const ownshipState = this.dynamics.state;
    this.underwaterOptics = this.world.update(
      this.renderTime,
      deltaSeconds,
      this.camera,
      {
        x: ownshipState.x,
        y: ownshipState.y,
        z: ownshipState.z,
        propulsionStopped: isPropulsionStopped(ownshipState.throttle),
        propulsionIntensity: Math.abs(ownshipState.propulsionThrottle),
      },
    );
    this.audio.setCameraMedium(this.underwaterOptics.amount);
    this.underwaterPass.update(this.renderTime, {
      ...this.underwaterOptics,
      amount:
        this.underwaterOptics.amount *
        (1 - this.cameraView.tacticalAmount) *
        (this.waterFxEnabled ? 1 : 0),
    });
    this.updateCameraInterface();
    this.updateMiniMap();
    this.updateStrategicPlot();
    this.world.renderWaterRefraction(this.renderer, this.camera);
    this.composer.render(deltaSeconds);
    const autoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.overlayScene, this.camera);
    this.renderer.autoClear = autoClear;
    this.animationFrame = requestAnimationFrame(this.tick);
  };

  private updateSimulation(frame: ControlFrame, deltaSeconds: number): void {
    this.updateInterfaceActivity(frame, deltaSeconds);
    const openedContactAnalysis =
      !this.sonarFocused &&
      this.contactBillboardOnScreen &&
      hasContactAnalysisInput(frame);
    if (openedContactAnalysis) {
      this.setSonarFocused(true);
    }
    if (frame.cameraMapToggle && this.sonarFocused) {
      this.setSonarFocused(false);
    }
    if (frame.reset) {
      this.dynamics.reset();
      this.ballastBlowCooldown.reset();
      if (this.contactTracker.snapshots().length === 0) {
        this.contactAcquisition = INITIAL_CONTACT_ACQUISITION_STATE;
      }
      this.input.stopDirectionalContactHaptics();
    }
    const ballastBlow = this.ballastBlowCooldown.update(
      frame.ballast < -0.62,
      deltaSeconds,
    );
    if (ballastBlow.triggered) {
      this.vehicle.burstMainBallastBlow();
      this.audio.ballastBurst();
    }
    const ballastCommand =
      frame.ballast < 0 && !ballastBlow.accepted ? 0 : frame.ballast;
    const previousState = this.dynamics.state;
    const playerSimulationSpeedMultiplier = this.playerSpeedX10Enabled
      ? DEBUG_PLAYER_SPEED_MULTIPLIER
      : 1;
    const waterSurface = this.world.sampleWater(
      previousState.x,
      previousState.z,
      this.renderTime,
    );
    const state = this.dynamics.update(
      {
        turn: frame.turn,
        dive: frame.dive,
        ballast: ballastCommand,
        throttleStep: frame.throttleStep,
      },
      deltaSeconds,
      waterSurface,
      playerSimulationSpeedMultiplier,
    );
    const previousSpeedKt = Math.abs(
      metersPerSecondToKnots(previousState.speedMetersPerSecond),
    );
    const currentSpeedKt = Math.abs(
      metersPerSecondToKnots(state.speedMetersPerSecond),
    );
    const safeDeltaSeconds = Math.max(
      1e-4,
      deltaSeconds * playerSimulationSpeedMultiplier,
    );
    this.playerAccelerationKtPerSec = Math.min(
      3,
      Math.max(-3, (currentSpeedKt - previousSpeedKt) / safeDeltaSeconds),
    );
    this.playerTurnRateDegPerSec =
      (Math.atan2(
        Math.sin(state.heading - previousState.heading),
        Math.cos(state.heading - previousState.heading),
      ) *
        180) /
      Math.PI /
      safeDeltaSeconds;
    const telegraphFeedback = telegraphHapticFeedbackForTransition(
      frame.gamepadThrottleStep,
      previousState.throttle,
      state.throttle,
    );
    if (telegraphFeedback === "limit") {
      this.pendingTelegraphClunkStep = 0;
      this.input.playTelegraphFeedback("limit");
    } else if (telegraphFeedback === "arrived") {
      this.pendingTelegraphClunkStep = frame.gamepadThrottleStep;
    }
    if (
      shouldPlayTelegraphClunkOnRelease(
        this.pendingTelegraphClunkStep,
        frame.gamepadThrottleReleaseStep,
      )
    ) {
      this.pendingTelegraphClunkStep = 0;
      this.input.playTelegraphFeedback("arrived");
    }
    if (!frame.gamepadConnected) {
      this.pendingTelegraphClunkStep = 0;
    }
    this.input.updateDepthHaptics(state.depthRate, Math.max(0, -state.y));
    const previousAscentBubblesActive = this.ascentBubblesActive;
    const ascentBubbles = ascentBubbleIntensity(
      state.depthRate,
      previousAscentBubblesActive,
    );
    this.ascentBubblesActive = ascentBubbles > 0;
    this.vehicle.setAscentBubbleIntensity(ascentBubbles);
    if (
      this.ascentBubblesActive &&
      !previousAscentBubblesActive &&
      this.ballastBlowCooldown.remainingSeconds === 0
    ) {
      this.audio.ballastBurst();
    }
    this.vehicle.update(state, this.simulationTime, deltaSeconds);
    this.audio.setMotion(
      state.speedMetersPerSecond,
      state.rudder,
      state.depthRate,
      state.propulsionThrottle,
      this.playerTurnRateDegPerSec,
    );
    this.gamepadConnected = frame.gamepadConnected;
    this.gamepadWakePending = frame.gamepadWakePending;

    this.enemySnapshot = this.enemy.update(this.simulationTime, deltaSeconds, {
      position: { x: state.x, y: state.y, z: state.z },
      headingRad: state.heading,
      speedKt: currentSpeedKt,
      accelerationKtPerSec: this.playerAccelerationKtPerSec,
      turnRateDegPerSec: this.playerTurnRateDegPerSec,
      propulsionStopped: isPropulsionStopped(state.throttle),
      classDefinition: AKULA_PLAYER_ACOUSTIC_CLASS,
    });
    if (this.developmentEnemyTruthVisible) {
      this.world.setContact(
        new Vector3(
          this.enemySnapshot.state.x,
          this.enemySnapshot.state.y,
          this.enemySnapshot.state.z,
        ),
        this.enemySnapshot.state.heading,
      );
      this.world.revealContact(1);
    }
    const sonarSimulation = simulateVesselPassiveSonar(
      { x: state.x, y: state.y, z: state.z },
      state.heading,
      state.speedMetersPerSecond,
      this.enemySnapshot.source,
      this.enemySnapshot.classDefinition,
      isPropulsionStopped(state.throttle),
      this.sensorsX100Enabled ? DEBUG_SENSOR_RANGE_MULTIPLIER : 1,
    );
    this.signal = sonarSimulation.measurement;
    this.debugTruthRangeMeters = sonarSimulation.truth.rangeMeters;
    if (
      this.simulationTime + 1e-8 >= this.nextContactCadenceUpdateSeconds &&
      (!this.contactAcquisition.cueStarted ||
        this.contactTracker.hasSource(this.enemySnapshot.entityId))
    ) {
      this.nextContactCadenceUpdateSeconds = this.simulationTime + 2;
      const nextCycleDuration = this.enemySnapshot.cycleDurationSeconds;
      if (
        Math.abs(nextCycleDuration - this.currentContactCycleDurationSeconds) >=
        this.currentContactCycleDurationSeconds * 0.035
      ) {
        this.currentContactCycleDurationSeconds = nextCycleDuration;
        this.sonarEngine.setCycleDuration(nextCycleDuration);
      }
    }
    this.currentContactMeasurement = {
      sourceEntityId: this.enemySnapshot.entityId,
      timeSeconds: this.simulationTime,
      worldBearingRad: this.signal.worldBearingRad,
      relativeBearingRad: this.signal.relativeBearingRad,
      signalQuality: this.signal.signalQuality,
      perceivable: this.signal.perceivable,
      observedPropulsionRateHz: this.enemySnapshot.observedPropulsionRateHz,
    };
    const ownshipObservation = {
      position: { x: state.x, z: state.z },
      courseRad: state.heading,
      speedMps: state.speedMetersPerSecond,
    };
    this.contactTracker.updateMeasurement(
      this.currentContactMeasurement,
      ownshipObservation,
    );
    this.sonar.setActiveTrack(this.contactTracker.activeTrack());
    this.vehicle.updatePassiveSonar(
      this.signal.relativeBearingRad,
      state.heading,
      this.signal.signalQuality,
      isPropulsionStopped(state.throttle) ? 0 : state.speedMetersPerSecond,
      this.sonar.listening && this.signal.perceivable,
      this.sonarEngine.getPlaybackElapsedTime() ?? this.simulationTime,
      deltaSeconds,
    );
    if (!openedContactAnalysis) {
      this.sonar.handleInput(frame);
    }
    this.sonar.update(this.signal);
    this.pingCooldown = Math.max(0, this.pingCooldown - deltaSeconds);
    this.impactCooldown = Math.max(0, this.impactCooldown - deltaSeconds);
    this.collisionFlash = Math.max(0, this.collisionFlash - deltaSeconds);
    if (frame.ping) {
      this.emitPing();
    }
    if (state.collision !== "none" && this.impactCooldown === 0) {
      this.handleImpact(state.collision);
    }

    this.updateMission();
    this.updateHud();
  }

  private startGameplay(): void {
    if (!this.ready || this.started || this.disposed) {
      return;
    }
    this.started = true;
    this.navigationRevealAge = 4;
    this.objectiveRevealAge = 6.5;
    this.controlHintAge = 9;
    void this.audio.startSoundtrack().catch((error: unknown) => {
      console.warn("AKULA soundtrack could not be started.", error);
    });
    void this.audio.startSurfaceEnvironment().catch((error: unknown) => {
      console.warn("AKULA surface environment could not be started.", error);
    });
    void this.sonar.start().catch((error: unknown) => {
      console.warn("AKULA passive sonar could not be started.", error);
    });
  }

  private readonly resumeAudio = (): void => {
    void this.audioSession.resumeFromUserGesture().catch((error: unknown) => {
      if (!(
        error instanceof DOMException && error.name === "NotAllowedError"
      )) {
        console.warn("AKULA audio could not be resumed.", error);
      }
    });
  };

  private readonly focusGameSurface = (): void => {
    if (!this.disposed) {
      this.renderer.domElement.focus({ preventScroll: true });
    }
  };

  private emitPing(): void {
    if (!this.started || this.pingCooldown > 0) {
      return;
    }
    this.pingCooldown = 3.4;
    const state = this.dynamics.state;
    this.world.emitSonarPulse(new Vector3(state.x, state.y, state.z));
    this.audio.ping();
    this.cameraRig.addShake(0.42);
    this.pingFlash.classList.remove("fired");
    void this.pingFlash.offsetWidth;
    this.pingFlash.classList.add("fired");
  }

  private handleImpact(collision: CollisionKind): void {
    this.impactCooldown = 1.15;
    this.collisionFlash = 0.85;
    this.audio.impact();
    this.cameraRig.addShake(collision === "boundary" ? 0.75 : 1.65);
    this.warning.textContent =
      collision === "ice"
        ? "ICE KEEL CONTACT"
        : collision === "floor"
          ? "SEABED CONTACT"
          : "CHART LIMIT — TURNING IN";
  }

  private applyContactHypothesis(
    trackId: string,
    signatureCode: AcousticCode,
  ): ContactTrackSnapshot {
    const track = this.contactTracker.applyIdentification(
      trackId,
      signatureCode,
      this.simulationTime,
    );
    this.missionStage = "tma";
    this.objectiveRevealAge = 5.5;
    return track;
  }

  private selectContactTrack(trackId: string): void {
    const track = this.contactTracker.selectTrack(trackId);
    this.sonar.setActiveTrack(track);
    this.objectiveRevealAge = 3.5;
  }

  private setSonarFocused(focused: boolean): void {
    if (
      focused &&
      (this.contactTracker.activeTrack() === undefined ||
        !this.contactBillboardOnScreen)
    ) {
      return;
    }
    if (focused) {
      this.cameraRig.exitTactical();
      void this.sonar.start();
    }
    this.sonarFocused = focused;
    this.sonar.setFocused(focused);
    this.root.classList.toggle("sonar-focused", focused);
    // Camera-sector listening is restored by the next chase-camera frame.
    // Never let a panel transition bypass the directional acoustic gate.
    this.audio.setSonarQuality(this.signal.signalQuality, false);
  }

  private updateInterfaceActivity(
    frame: ControlFrame,
    deltaSeconds: number,
  ): void {
    const piloting =
      Math.abs(frame.turn) > 0.08 ||
      Math.abs(frame.dive) > 0.08 ||
      Math.abs(frame.ballast) > 0.08 ||
      Math.abs(frame.cameraYaw) > 0.08 ||
      Math.abs(frame.cameraPitch) > 0.08 ||
      frame.throttleStep !== 0;
    this.navigationRevealAge = piloting
      ? 1.8
      : Math.max(0, this.navigationRevealAge - deltaSeconds);
    this.objectiveRevealAge = Math.max(
      0,
      this.objectiveRevealAge - deltaSeconds,
    );
    this.controlHintAge = Math.max(0, this.controlHintAge - deltaSeconds);
  }

  private updateCameraInterface(): void {
    const operational = this.cameraView.operationalAmount;
    this.root.classList.toggle("map-active", operational > 0);
    this.root.classList.toggle("map-readable", operational > 0);
    this.root.classList.toggle(
      "map-overview",
      operational > 0 && this.cameraView.tacticalSpanMeters >= 18_000,
    );
    this.root.style.setProperty("--map-blend", operational.toFixed(3));
    this.root.style.setProperty("--plot-blend", operational.toFixed(3));
    this.root.style.setProperty(
      "--map-yaw",
      `${(-this.cameraView.tacticalYaw).toFixed(4)}rad`,
    );
    this.tacticalOverlay.setAttribute("aria-hidden", String(operational <= 0));
    this.tacticalDistanceValue.textContent = `${formatMapSpan(
      this.cameraView.tacticalSpanMeters,
    )} ACROSS`;
    this.updateMapActionHint();
    this.updateWeaponSelector();
    this.renderer.toneMappingExposure =
      1.13 + this.cameraView.tacticalAmount * 0.16;
    this.updateContactBillboard();
    this.updateEnemyTruthHud();
  }

  /**
   * Bearing-only crew mark: it remains on the last measured source direction
   * through signal loss, while its arbitrary projection distance never reveals
   * true target range.
   */
  private updateContactBillboard(): void {
    const activeTrack = this.contactTracker.activeTrack();
    const latestObservation = activeTrack?.observations.at(-1);
    if (
      activeTrack === undefined ||
      latestObservation === undefined ||
      !crewContactMarkCanProject(
        activeTrack,
        true,
        this.cameraView.tacticalAmount,
      )
    ) {
      this.contactBillboardOnScreen = false;
      this.contactBillboard.classList.remove("visible");
      this.contactBillboard.classList.remove("lost");
      this.contactBillboard.setAttribute("aria-hidden", "true");
      if (this.sonarFocused) {
        this.setSonarFocused(false);
      }
      return;
    }

    const projectionDistance = 1_000;
    this.projectedContactBearing
      .set(
        this.camera.position.x +
          Math.sin(latestObservation.bearingRad) * projectionDistance,
        this.camera.position.y,
        this.camera.position.z -
          Math.cos(latestObservation.bearingRad) * projectionDistance,
      )
      .project(this.camera);
    const visible =
      this.projectedContactBearing.z >= -1 &&
      this.projectedContactBearing.z <= 1 &&
      Math.abs(this.projectedContactBearing.x) <= 1.04 &&
      Math.abs(this.projectedContactBearing.y) <= 1.04;
    this.contactBillboardOnScreen = visible;
    this.contactBillboard.classList.toggle("visible", visible);
    this.contactBillboard.classList.toggle(
      "lost",
      activeTrack.status === "LOST",
    );
    this.contactBillboard.setAttribute("aria-hidden", String(!visible));
    if (!visible) {
      if (this.sonarFocused) {
        this.setSonarFocused(false);
      }
      return;
    }

    const screenX =
      (this.projectedContactBearing.x * 0.5 + 0.5) * this.root.clientWidth;
    const screenY =
      (-this.projectedContactBearing.y * 0.5 + 0.5) * this.root.clientHeight;
    this.contactBillboard.textContent = activeTrack.label;
    this.contactBillboard.style.left = `${screenX.toFixed(1)}px`;
    this.contactBillboard.style.top = `${screenY.toFixed(1)}px`;
    this.sonar.setScreenAnchor(
      screenX,
      screenY,
      this.root.clientWidth,
      this.root.clientHeight,
    );
  }

  private updateEnemyTruthHud(): void {
    if (
      !this.developmentEnemyTruthVisible ||
      this.cameraView.tacticalAmount >= 0.08
    ) {
      this.enemyPositionMarker.classList.remove(
        "visible",
        "offscreen",
        "align-left",
      );
      this.enemyPositionMarker.dataset["state"] = "hidden";
      this.enemyPositionMarker.setAttribute("aria-hidden", "true");
      return;
    }

    const enemy = this.enemySnapshot.state;
    const cameraSpaceZ = this.projectedEnemyTruth
      .set(enemy.x, enemy.y, enemy.z)
      .applyMatrix4(this.camera.matrixWorldInverse).z;
    this.projectedEnemyTruth
      .set(enemy.x, enemy.y, enemy.z)
      .project(this.camera);
    let projectedX = this.projectedEnemyTruth.x;
    let projectedY = this.projectedEnemyTruth.y;
    const behindCamera = cameraSpaceZ >= -this.camera.near;
    if (behindCamera) {
      projectedX *= -1;
      projectedY *= -1;
    }
    if (!Number.isFinite(projectedX) || !Number.isFinite(projectedY)) {
      projectedX = 0;
      projectedY = -1;
    }

    const onScreen =
      !behindCamera &&
      this.projectedEnemyTruth.z >= -1 &&
      this.projectedEnemyTruth.z <= 1 &&
      Math.abs(projectedX) <= 0.94 &&
      Math.abs(projectedY) <= 0.9;
    const width = this.root.clientWidth;
    const height = this.root.clientHeight;
    const horizontalMargin = 54;
    const verticalMargin = 44;
    const unclampedX = (projectedX * 0.5 + 0.5) * width;
    const unclampedY = (-projectedY * 0.5 + 0.5) * height;
    const screenX = Math.min(
      width - horizontalMargin,
      Math.max(horizontalMargin, unclampedX),
    );
    let screenY = Math.min(
      height - verticalMargin,
      Math.max(verticalMargin, unclampedY),
    );
    if (!onScreen && screenX > width - 285 && screenY < 260) {
      screenY = 260;
    }
    if (!onScreen && screenX < 170) {
      const leftHudFloor = this.root.classList.contains("debug-mode")
        ? 420
        : 130;
      screenY = Math.max(screenY, leftHudFloor);
    }
    const state = this.dynamics.state;
    const rangeKilometers =
      Math.hypot(enemy.x - state.x, enemy.z - state.z) / 1_000;

    this.enemyPositionMarker.classList.add("visible");
    this.enemyPositionMarker.classList.toggle("offscreen", !onScreen);
    this.enemyPositionMarker.classList.toggle(
      "align-left",
      screenX > width * 0.62,
    );
    this.enemyPositionMarker.dataset["state"] = onScreen
      ? "onscreen"
      : "offscreen";
    this.enemyPositionMarker.setAttribute("aria-hidden", "false");
    this.enemyPositionMarker.style.left = `${screenX.toFixed(1)}px`;
    this.enemyPositionMarker.style.top = `${screenY.toFixed(1)}px`;
    this.enemyPositionLabel.textContent = `ENEMY POS · ${rangeKilometers.toFixed(1)} KM`;
  }

  private updateMiniMap(): void {
    const state = this.dynamics.state;
    const activeTrack = this.contactTracker.activeTrack();
    const latestObservation = activeTrack?.observations.at(-1);
    const developmentEnemy = this.developmentEnemyTruthVisible
      ? this.developmentEnemyMapTruth()
      : undefined;
    const player = {
      x: state.x,
      z: state.z,
      heading: state.heading,
    };
    this.miniMap.update(
      activeTrack === undefined || latestObservation === undefined
        ? {
            player,
            ...(developmentEnemy === undefined ? {} : { developmentEnemy }),
          }
        : {
            player,
            contact: {
              worldBearing: latestObservation.bearingRad,
              signalQuality: activeTrack.lastSignalQuality,
            },
            ...(developmentEnemy === undefined ? {} : { developmentEnemy }),
          },
      this.renderTime,
    );
  }

  private updateStrategicPlot(): void {
    this.strategicPlot.update(this.currentStrategicPlotFrame());
  }

  private updateTorpedoFireControl(
    frame: ControlFrame,
    deltaSeconds: number,
  ): boolean {
    const mapAvailable =
      this.cameraView.mode === "tactical" &&
      this.cameraView.tacticalAmount > 0.58;
    if (!mapAvailable) {
      this.torpedoPlan = undefined;
      this.clearTorpedoTargetSelection();
      return false;
    }

    this.updateWeaponSelection(frame.digitValueDelta);
    this.torpedoCursorPoint ??= this.initialTorpedoCursorPoint();

    if (frame.torpedoPlan) {
      this.selectedWeaponIndex = 0;
      if (this.torpedoPlan?.status === "placing") {
        this.torpedoPlan = undefined;
        this.clearTorpedoTargetSelection();
      } else {
        this.torpedoPlan = {
          status: "placing",
          enablePoint: this.torpedoCursorPoint,
        };
        this.torpedoTargetSelectionMode = "automatic";
        this.torpedoTargetTrackId = undefined;
        this.updateTorpedoTargetSelection(0);
        this.strategicAutoFrameEnabled = false;
        this.strategicAutoFrameAge = 0;
      }
      return true;
    }

    const selectedWeapon = this.currentWeaponCategory();
    if (selectedWeapon.id !== "torpedo") {
      this.torpedoPlan = undefined;
      this.clearTorpedoTargetSelection();
      if (frame.submit) {
        this.lastUnavailableWeaponFireTime = this.simulationTime;
        return true;
      }
      return false;
    }

    if (frame.submit) {
      this.fireTorpedoSalvo();
      return true;
    }

    if (this.torpedoPlan?.status !== "placing") {
      this.clearTorpedoTargetSelection();
      this.torpedoCursorPoint = this.moveTorpedoCursorPoint(
        this.torpedoCursorPoint,
        frame,
        deltaSeconds,
      );
      return false;
    }

    this.torpedoPlan = {
      ...this.torpedoPlan,
      enablePoint: this.moveTorpedoCursorPoint(
        this.torpedoPlan.enablePoint,
        frame,
        deltaSeconds,
      ),
    };
    this.torpedoCursorPoint = this.torpedoPlan.enablePoint;
    this.updateTorpedoTargetSelection(frame.digitSelectDelta);

    if (frame.cameraMapToggle) {
      this.torpedoPlans = appendTorpedoRunToEnable(
        this.torpedoPlans,
        this.torpedoPlan.enablePoint,
        this.torpedoTargetTrackId,
      );
      return true;
    }
    if (frame.cancel) {
      this.torpedoPlan = undefined;
      this.clearTorpedoTargetSelection();
      return true;
    }
    return true;
  }

  private updateTorpedoTargetSelection(delta: number): void {
    const enablePoint = this.torpedoPlan?.enablePoint;
    if (enablePoint === undefined) {
      this.clearTorpedoTargetSelection();
      return;
    }
    const leads = this.torpedoTargetLeads(enablePoint);
    const automatic = closestTorpedoTargetLead(leads);
    let selected: TorpedoTargetLead | undefined;
    if (delta !== 0 && leads.length > 1) {
      selected = cycleTorpedoTargetLead(
        leads,
        this.torpedoTargetTrackId ?? automatic?.trackId,
        delta,
      );
      this.torpedoTargetSelectionMode = "manual";
    } else if (this.torpedoTargetSelectionMode === "manual") {
      selected = leads.find(
        ({ trackId }) => trackId === this.torpedoTargetTrackId,
      );
    }
    if (selected === undefined) {
      selected = automatic;
      this.torpedoTargetSelectionMode = "automatic";
    }
    if (selected === undefined) {
      this.torpedoTargetTrackId = undefined;
      this.torpedoTargetPrediction = undefined;
      return;
    }
    this.torpedoTargetTrackId = selected.trackId;
    this.torpedoTargetPrediction = {
      ...selected,
      selectionMode: this.torpedoTargetSelectionMode,
      candidateIndex:
        leads.findIndex(({ trackId }) => trackId === selected.trackId) + 1,
      candidateCount: leads.length,
    };
  }

  private torpedoTargetLeads(
    enablePoint: TorpedoRunToEnablePlan["enablePoint"],
  ): readonly TorpedoTargetLead[] {
    const state = this.dynamics.state;
    return this.contactTracker.snapshots().flatMap((track) => {
      if (
        track.identification === undefined ||
        track.solution === undefined ||
        track.solution.best === undefined
      ) {
        return [];
      }
      const history = strategicTrackHistory(
        track.solution,
        track.motionLegs[track.currentMotionLegIndex]?.observations ??
          track.observations,
        this.simulationTime,
      );
      return history === undefined
        ? []
        : [
            torpedoTargetLead(
              {
                trackId: track.id,
                trackLabel: track.label,
                currentPosition: history.currentPosition,
                courseRad: history.courseRad,
                speedMps: history.speedMps,
              },
              { x: state.x, z: state.z },
              enablePoint,
            ),
          ];
    });
  }

  private clearTorpedoTargetSelection(): void {
    this.torpedoTargetTrackId = undefined;
    this.torpedoTargetSelectionMode = "automatic";
    this.torpedoTargetPrediction = undefined;
  }

  private updateWeaponSelection(delta: number): void {
    if (delta === 0) {
      return;
    }
    // D-pad down advances visually to the chamber below; up moves to the one
    // above. InputController reports those directions as -1 and +1.
    this.selectedWeaponIndex = cycleWeaponCategory(
      this.selectedWeaponIndex,
      -delta,
    );
    if (this.currentWeaponCategory().id !== "torpedo") {
      this.torpedoPlan = undefined;
      this.clearTorpedoTargetSelection();
    }
  }

  private currentWeaponCategory(): WeaponCategory {
    const selected = WEAPON_CATEGORIES[this.selectedWeaponIndex];
    const fallback = WEAPON_CATEGORIES[0];
    if (selected !== undefined) {
      return selected;
    }
    if (fallback === undefined) {
      throw new Error("The strategic weapon selector has no categories.");
    }
    return fallback;
  }

  private fireTorpedoSalvo(): void {
    if (this.torpedoPlans.length === 0) {
      this.lastEmptyTorpedoFireTime = this.simulationTime;
      return;
    }
    this.lastTorpedoSalvoSize = this.torpedoPlans.length;
    this.totalTorpedoesLaunched += this.torpedoPlans.length;
    this.lastTorpedoLaunchTime = this.simulationTime;
    this.torpedoPlans = [];
    this.torpedoPlan = undefined;
    this.clearTorpedoTargetSelection();
  }

  private initialTorpedoCursorPoint(): TorpedoRunToEnablePlan["enablePoint"] {
    const state = this.dynamics.state;
    const activeTrack = this.contactTracker.activeTrack();
    const estimatedPoint =
      activeTrack?.solution === undefined
        ? undefined
        : strategicTrackHistory(
            activeTrack.solution,
            activeTrack.motionLegs[activeTrack.currentMotionLegIndex]
              ?.observations ?? activeTrack.observations,
            this.simulationTime,
          )?.currentPosition;
    return initialTorpedoEnablePoint(
      { x: state.x, z: state.z },
      state.heading,
      this.cameraView.tacticalSpanMeters * 0.5,
      estimatedPoint,
    );
  }

  private moveTorpedoCursorPoint(
    point: TorpedoRunToEnablePlan["enablePoint"],
    frame: ControlFrame,
    deltaSeconds: number,
  ): TorpedoRunToEnablePlan["enablePoint"] {
    const state = this.dynamics.state;
    return moveTorpedoEnablePoint(
      point,
      { x: state.x, z: state.z },
      {
        stickX: frame.cameraYaw,
        stickY: frame.cameraPitch,
        viewYawRad: this.cameraView.tacticalYaw,
        viewHalfSpanMeters: this.cameraView.tacticalSpanMeters * 0.5,
        deltaSeconds,
      },
    );
  }

  private updateMapActionHint(): void {
    this.root.classList.toggle(
      "torpedo-plan-active",
      this.torpedoPlan !== undefined || this.torpedoPlans.length > 0,
    );
    this.root.classList.toggle(
      "torpedo-plan-placing",
      this.torpedoPlan?.status === "placing",
    );
    const weapon = this.currentWeaponCategory();
    const salvoCount = this.torpedoPlans.length.toString().padStart(2, "0");
    if (this.gamepadWakePending) {
      this.mapActionHint.textContent =
        "CONTROLLER PAUSED   ·   MOVE STICK OR PRESS ANY BUTTON";
      return;
    }
    if (weapon.id !== "torpedo") {
      this.mapActionHint.textContent = this.gamepadConnected
        ? "D-PAD ↑↓ WEAPON   ·   A FIRE   ·   SYSTEM NOT FITTED"
        : "− / + WEAPON   ·   ENTER FIRE   ·   SYSTEM NOT FITTED";
      return;
    }
    if (this.torpedoPlan?.status === "placing") {
      const targetHint =
        (this.torpedoTargetPrediction?.candidateCount ?? 0) > 1
          ? "   ·   D-PAD ←→ TARGET"
          : "";
      const keyboardTargetHint =
        (this.torpedoTargetPrediction?.candidateCount ?? 0) > 1
          ? "   ·   [ / ] TARGET"
          : "";
      this.mapActionHint.textContent = this.gamepadConnected
        ? `RS MOVE   ·   R3 SET${targetHint}   ·   A FIRE SALVO ${salvoCount}   ·   B CLOSE`
        : `ARROWS MOVE   ·   M SET${keyboardTargetHint}   ·   ENTER FIRE SALVO ${salvoCount}   ·   T CLOSE`;
      return;
    }
    if (this.torpedoPlans.length > 0) {
      this.mapActionHint.textContent = this.gamepadConnected
        ? `B ADD TORPEDO   ·   A FIRE SALVO ${salvoCount}   ·   R3 RETURN`
        : `T ADD TORPEDO   ·   ENTER FIRE SALVO ${salvoCount}   ·   M RETURN`;
      return;
    }
    this.mapActionHint.textContent = this.gamepadConnected
      ? "B PLAN TORPEDO   ·   D-PAD ↑↓ WEAPON   ·   R3 RETURN"
      : "T PLAN TORPEDO   ·   − / + WEAPON   ·   M RETURN";
  }

  private updateWeaponSelector(): void {
    const weapon = this.currentWeaponCategory();
    const launchAge = this.simulationTime - this.lastTorpedoLaunchTime;
    const unavailableFireAge =
      this.simulationTime - this.lastUnavailableWeaponFireTime;
    const emptyFireAge = this.simulationTime - this.lastEmptyTorpedoFireTime;
    this.weaponSelector.dataset["weapon"] = weapon.id;
    this.weaponSelector.classList.toggle("unavailable", !weapon.available);
    this.weaponSelector.classList.toggle(
      "salvo-fired",
      weapon.id === "torpedo" && launchAge < 0.48,
    );
    this.weaponName.textContent = weapon.russianName;
    this.weaponDetail.textContent = weapon.detail;
    this.weaponSalvoCount.textContent =
      weapon.id === "torpedo"
        ? `ЗАЛП ${this.torpedoPlans.length.toString().padStart(2, "0")}`
        : "A · ОГОНЬ";
    this.weaponStatus.textContent =
      weapon.id === "torpedo" && launchAge < 1.5
        ? `ПУСК · ${this.lastTorpedoSalvoSize.toString().padStart(2, "0")}`
        : weapon.id === "torpedo" && emptyFireAge < 1.2
          ? "НЕТ УСТАНОВОК"
          : !weapon.available && unavailableFireAge < 1.2
            ? "ПУСК БЛОКИРОВАН"
            : weapon.available
              ? "ГОТОВО"
              : "СИСТЕМА НЕ УСТАНОВЛЕНА";
    this.weaponSelector.setAttribute(
      "aria-label",
      `${weapon.russianName}; ${this.weaponStatus.textContent}`,
    );
    for (const [index, slot] of this.weaponSlots.entries()) {
      const position = weaponDrumPosition(
        index,
        this.selectedWeaponIndex,
        this.weaponSlots.length,
      );
      slot.dataset["position"] = position;
      slot.setAttribute("aria-hidden", String(position !== "active"));
    }
  }

  private currentStrategicPlotFrame(): StrategicPlotFrame {
    const state = this.dynamics.state;
    return {
      ownship: {
        position: { x: state.x, z: state.z },
        headingRad: state.heading,
      },
      tracks: this.contactTracker.snapshots(),
      timeSeconds: this.simulationTime,
      viewHalfSpanMeters: this.cameraView.tacticalSpanMeters * 0.5,
      viewYawRad: this.cameraView.tacticalYaw,
      ...(this.torpedoPlan === undefined
        ? {}
        : { torpedoPlan: this.torpedoPlan }),
      ...(this.torpedoPlans.length === 0
        ? {}
        : { torpedoPlans: this.torpedoPlans }),
      ...(this.torpedoTargetPrediction === undefined
        ? {}
        : { torpedoTargetPrediction: this.torpedoTargetPrediction }),
      ...(this.developmentEnemyTruthVisible
        ? { developmentEnemy: this.developmentEnemyMapTruth() }
        : {}),
    };
  }

  private recommendedStrategicViewSpanMeters(): number | undefined {
    return strategicRecommendedViewSpanMeters(this.currentStrategicPlotFrame());
  }

  private developmentEnemyMapTruth(): Readonly<{
    position: Readonly<{ x: number; z: number }>;
    headingRad: number;
    speedKt: number;
  }> {
    return {
      position: {
        x: this.enemySnapshot.state.x,
        z: this.enemySnapshot.state.z,
      },
      headingRad: this.enemySnapshot.state.heading,
      speedKt: this.enemySnapshot.source.speedKt,
    };
  }

  private updateMission(): void {
    const activeTrack = this.contactTracker.activeTrack();
    this.missionStage =
      activeTrack === undefined
        ? "search"
        : activeTrack.identification === undefined
          ? "identify"
          : "tma";
  }

  private updateHud(): void {
    const state = this.dynamics.state;
    const speedKnots = Math.abs(
      metersPerSecondToKnots(state.speedMetersPerSecond),
    );
    this.speedValue.textContent = speedKnots.toFixed(1);
    this.depthValue.textContent = Math.round(-state.y)
      .toString()
      .padStart(3, "0");
    this.floorValue.textContent = `${Math.max(0, Math.round(state.floorClearance))} m`;
    this.iceValue.textContent = Number.isFinite(state.iceClearance)
      ? `${Math.max(0, Math.round(state.iceClearance))} m`
      : "OPEN WATER";
    this.telegraphValue.textContent = telegraphLabel(state.throttle);
    const propulsionStopped = isPropulsionStopped(state.throttle);
    this.noiseValue.textContent = propulsionStopped
      ? "ZERO"
      : speedKnots < 10
        ? "QUIET"
        : speedKnots < 20
          ? "FLOW NOISE"
          : "LOUD";
    this.noiseValue.dataset["level"] = propulsionStopped
      ? "quiet"
      : speedKnots < 10
        ? "quiet"
        : speedKnots < 20
          ? "medium"
          : "loud";
    const headingDegrees = ((state.heading * 180) / Math.PI + 360) % 360;
    this.compassValue.textContent = `${Math.round(headingDegrees)
      .toString()
      .padStart(3, "0")}°`;
    const activeTrack = this.contactTracker.activeTrack();
    if (this.gamepadWakePending) {
      this.controlHint.textContent =
        "CONTROLLER PAUSED   ·   MOVE STICK OR PRESS ANY BUTTON";
    } else if (activeTrack?.status === "LOST") {
      this.controlHint.textContent = this.gamepadConnected
        ? this.sonarFocused
          ? "D-PAD CODE   ·   A APPLY   ·   B CLOSE"
          : "A ANALYZE   ·   RS REACQUIRE   ·   R3 LAST SOLUTION"
        : this.sonarFocused
          ? "[ ] SELECT   ·   − + CHANGE   ·   ENTER APPLY   ·   C CLOSE"
          : "ENTER ANALYZE   ·   ARROWS REACQUIRE   ·   M LAST SOLUTION";
    } else {
      this.controlHint.textContent = this.gamepadConnected
        ? activeTrack === undefined
          ? "RS SEARCH   ·   R3 STRATEGIC"
          : this.sonarFocused
            ? "D-PAD CODE   ·   A APPLY   ·   B CLOSE"
            : "A / D-PAD ANALYZE   ·   R3 STRATEGIC"
        : activeTrack === undefined
          ? "ARROWS SEARCH   ·   M STRATEGIC"
          : this.sonarFocused
            ? "[ ] SELECT   ·   − + CHANGE   ·   ENTER APPLY   ·   C CLOSE"
            : "ENTER / [ ] / − + ANALYZE   ·   M STRATEGIC";
    }
    this.root.classList.toggle("nav-active", this.navigationRevealAge > 0);
    this.root.classList.toggle(
      "objective-visible",
      this.objectiveRevealAge > 0,
    );
    this.root.classList.toggle(
      "control-hint-visible",
      this.controlHintAge > 0 || this.gamepadWakePending,
    );
    this.root.classList.toggle(
      "controller-wake-pending",
      this.gamepadWakePending,
    );
    this.root.style.setProperty(
      "--signal-quality",
      this.signal.signalQuality.toFixed(3),
    );

    const iceDanger =
      Number.isFinite(state.iceClearance) && state.iceClearance < 16;
    const clearanceDanger = state.floorClearance < 18 || iceDanger;
    this.root.classList.toggle(
      "danger",
      clearanceDanger || this.collisionFlash > 0,
    );
    if (this.collisionFlash === 0) {
      this.warning.textContent = clearanceDanger
        ? state.floorClearance < state.iceClearance
          ? "PULL UP — SEABED"
          : "DIVE — ICE KEEL"
        : "";
    }

    if (activeTrack?.status === "LOST") {
      const lastContactAge = Math.max(
        0,
        this.simulationTime - activeTrack.lastObservationTimeSeconds,
      );
      this.objective.textContent = `${activeTrack.label} — LOST`;
      this.objectiveDetail.textContent = `Last bearing ${Math.floor(
        lastContactAge / 60,
      )
        .toString()
        .padStart(2, "0")}:${Math.floor(lastContactAge % 60)
        .toString()
        .padStart(
          2,
          "0",
        )} ago. Sweep the camera; the previous solution is only projecting.`;
      this.objectiveProgress.style.width = `${Math.round(contactAcquisitionProgress(this.contactAcquisition) * 100)}%`;
    } else if (this.missionStage === "search") {
      this.objective.textContent = "LOCATE UNKNOWN SOURCE";
      this.objectiveDetail.textContent =
        "Sweep the external camera. Listen for a broken machinery rhythm.";
      this.objectiveProgress.style.width = `${Math.round(contactAcquisitionProgress(this.contactAcquisition) * 100)}%`;
    } else if (this.missionStage === "identify") {
      this.objective.textContent = `${activeTrack?.label ?? "ЦЕЛЬ"} · FORM IDENTITY`;
      this.objectiveDetail.textContent =
        "Keep its bearing label on screen; press A or touch the D-pad to form its acoustic code.";
      this.objectiveProgress.style.width = `${Math.min(92, (activeTrack?.observations.length ?? 1) * 9)}%`;
    } else {
      this.objective.textContent = `${activeTrack?.label ?? "ЦЕЛЬ"} · TMA RUNNING`;
      const crewClassification = activeTrack?.identification?.guessedClassName;
      const tmaInstruction = activeTrack?.possibleManeuver
        ? "New bearings no longer fit the previous motion. Hold geometry while the solution loosens."
        : activeTrack?.status === "WEAK"
          ? "The return is weak. Reduce own noise or improve aspect before the track breaks."
          : "Change course to improve geometry; the computer rebuilds the solution.";
      this.objectiveDetail.textContent =
        crewClassification === undefined
          ? tmaInstruction
          : `Crew classified ${crewClassification}. ${tmaInstruction}`;
      this.objectiveProgress.style.width = "100%";
    }
    this.debugOutput.textContent = JSON.stringify(this.getDebugState());
    this.hapticStatusValue.textContent = `HAPTIC · ${this.input.hapticStatus}`;
  }

  private resize(): void {
    const width = Math.max(1, this.root.clientWidth || globalThis.innerWidth);
    const height = Math.max(
      1,
      this.root.clientHeight || globalThis.innerHeight,
    );
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.miniMap.resize();
    this.strategicPlot.resize();
  }

  private updateDirectionalContactHaptics(frame: ControlFrame): void {
    const measurement = this.currentContactMeasurement;
    if (
      measurement !== undefined &&
      this.contactAcquisition.acquired &&
      this.contactTracker.requiresAcquisition(measurement.sourceEntityId)
    ) {
      this.contactAcquisition = INITIAL_CONTACT_ACQUISITION_STATE;
      this.input.stopDirectionalContactHaptics();
    }
    const alignmentRadians =
      measurement === undefined
        ? Math.PI
        : this.cameraBearingError(measurement.worldBearingRad);

    const sensoryEnabled =
      this.started &&
      this.sonar.listening &&
      !this.sonarFocused &&
      this.cameraView.tacticalAmount < 0.08 &&
      frame.leftTrigger < 0.08 &&
      frame.rightTrigger < 0.08;
    const contactSensorCandidate =
      measurement === undefined
        ? undefined
        : {
            sourceEntityId: measurement.sourceEntityId,
            angularErrorRad: alignmentRadians,
            signalQuality: measurement.signalQuality,
            perceivable: measurement.perceivable,
          };
    this.currentAcquisitionCandidate =
      contactSensorCandidate === undefined
        ? undefined
        : selectAcquisitionCandidate(
            [contactSensorCandidate],
            (sourceEntityId) =>
              !this.contactTracker.requiresAcquisition(sourceEntityId),
          );
    if (
      this.contactAcquisition.candidateSourceEntityId !== undefined &&
      this.currentAcquisitionCandidate !== undefined &&
      this.contactAcquisition.candidateSourceEntityId !==
        this.currentAcquisitionCandidate.sourceEntityId
    ) {
      this.contactAcquisition = INITIAL_CONTACT_ACQUISITION_STATE;
      this.input.stopDirectionalContactHaptics();
    }
    const searchContactCueEnabled = contactSearchCueEnabled(
      sensoryEnabled,
      this.currentAcquisitionCandidate,
    );
    const contactInsideCameraCone =
      measurement?.perceivable === true &&
      contactBearingInsideCameraCone(alignmentRadians);
    const directionalContactCueActive = contactDirectionalCueEnabled(
      sensoryEnabled,
      contactSensorCandidate,
    );
    const contactAnalysisAudioEnabled =
      this.started &&
      this.sonar.listening &&
      this.sonarFocused &&
      this.cameraView.tacticalAmount < 0.08 &&
      contactInsideCameraCone &&
      measurement !== undefined &&
      this.contactTracker.hasSource(measurement.sourceEntityId);
    const contactAudioEnabled =
      directionalContactCueActive || contactAnalysisAudioEnabled;
    this.contactAudioInCameraSector = contactAudioEnabled;
    this.audio.setSonarBearing(alignmentRadians);
    this.audio.setSonarQuality(this.signal.signalQuality, contactAudioEnabled);
    this.directionalContactHaptics = directionalContactHapticProfile({
      enabled: searchContactCueEnabled,
      alignmentRadians,
      signalQuality: this.signal.signalQuality,
      signature: FROSTBITE_CONTACT_SIGNATURE,
      cycleDurationSeconds: this.currentContactCycleDurationSeconds,
    });
    this.input.updateDirectionalContactHaptics(
      this.directionalContactHaptics,
      directionalContactHapticElapsedTime(
        this.sonarEngine.getPlaybackElapsedTime(),
        this.simulationTime,
        this.audio.context.state === "running",
      ),
    );
    const lockState = this.input.directionalContactLockState;
    const previousAcquisition = this.contactAcquisition;
    this.contactAcquisition = updateContactAcquisition(previousAcquisition, {
      enabled: searchContactCueEnabled,
      candidate: this.currentAcquisitionCandidate,
      sequenceStarted: lockState.started,
      sequenceProgress: lockState.progress,
      sequencePulseCount: lockState.pulseCount,
      sequenceComplete: lockState.complete,
    });
    if (!previousAcquisition.acquired && this.contactAcquisition.acquired) {
      this.acquireContact();
    }
  }

  private acquireContact(): void {
    const measurement = this.currentContactMeasurement;
    if (
      measurement === undefined ||
      this.contactAcquisition.candidateSourceEntityId !==
        measurement.sourceEntityId
    ) {
      return;
    }
    const state = this.dynamics.state;
    const assignment = this.contactTracker.acquire(
      measurement,
      {
        position: { x: state.x, z: state.z },
        courseRad: state.heading,
        speedMps: state.speedMetersPerSecond,
      },
      {
        recognizedSignatureCode:
          this.enemySnapshot.classDefinition.signatureCode,
      },
    );
    this.input.stopDirectionalContactHaptics();
    this.sonar.setActiveTrack(this.contactTracker.activeTrack());
    this.missionStage = "tma";
    this.objectiveRevealAge = 6;
    void this.audio.reportSonarContact(
      assignment.bearingRad,
      assignment.contactNumber,
    );
  }

  private cameraBearingError(worldBearingRad: number): number {
    this.camera.getWorldDirection(this.cameraForward);
    const cameraBearing = Math.atan2(
      this.cameraForward.x,
      -this.cameraForward.z,
    );
    return Math.atan2(
      Math.sin(worldBearingRad - cameraBearing),
      Math.cos(worldBearingRad - cameraBearing),
    );
  }

  private getDebugState(): AkulaDebugSnapshot {
    const state = this.dynamics.state;
    const sortedFrameTimes = [...this.frameTimes].sort((a, b) => a - b);
    const meanFrameTime =
      this.frameTimes.length === 0
        ? 0
        : this.frameTimes.reduce((sum, frameTime) => sum + frameTime, 0) /
          this.frameTimes.length;
    const p95Index = Math.min(
      sortedFrameTimes.length - 1,
      Math.floor(sortedFrameTimes.length * 0.95),
    );
    return {
      ready: this.ready,
      started: this.started,
      waterFxEnabled: this.waterFxEnabled,
      enemyPosEnabled: this.developmentEnemyTruthVisible,
      vibrationX100Enabled: this.vibrationX100Enabled,
      sensorsX100Enabled: this.sensorsX100Enabled,
      playerSpeedX10Enabled: this.playerSpeedX10Enabled,
      playerSimulationSpeedMultiplier: this.playerSpeedX10Enabled
        ? DEBUG_PLAYER_SPEED_MULTIPLIER
        : 1,
      hapticMagnitudeMultiplier: this.input.hapticMagnitudeScale,
      sensorRangeMultiplier: this.sensorsX100Enabled
        ? DEBUG_SENSOR_RANGE_MULTIPLIER
        : 1,
      gamepadConnected: this.gamepadConnected,
      gamepadWakePending: this.gamepadWakePending,
      gamepadWakePhase: this.input.gamepadWakePhase,
      haptics: this.input.hapticStatus,
      directionalContactHaptics: {
        active: this.directionalContactHaptics.active,
        intervalMilliseconds:
          this.directionalContactHaptics.intervalMilliseconds,
        durationMilliseconds:
          this.directionalContactHaptics.durationMilliseconds,
        weakMagnitude: this.directionalContactHaptics.weakMagnitude,
        alignmentDegrees: this.directionalContactHaptics.alignmentDegrees,
        alignmentAmount: this.directionalContactHaptics.alignmentAmount,
        signalQuality: this.directionalContactHaptics.signalQuality,
      },
      contactAcquisition: this.contactAcquisition,
      depthMeters: -state.y,
      depthRateMetersPerSecond: state.depthRate,
      speedKnots: Math.abs(metersPerSecondToKnots(state.speedMetersPerSecond)),
      turnRateDegreesPerSecond: this.playerTurnRateDegPerSec,
      throttle: state.throttle,
      propulsionThrottle: state.propulsionThrottle,
      ballastBlowCooldownSeconds: this.ballastBlowCooldown.remainingSeconds,
      headingRadians: state.heading,
      yawPivotOffsetMeters: yawPivotOffsetMeters(state.speedMetersPerSecond),
      propeller: {
        angleRadians: this.vehicle.propellerRotationRadians,
        revolutionsPerMinute: this.vehicle.propellerRevolutionsPerMinute,
        cavitationStrength: this.vehicle.propellerCavitationStrength,
        radiusMeters: this.vehicle.propellerRadiusMeters,
        effectsOrigin: this.vehicle.propellerEffectsOrigin,
      },
      floorClearance: state.floorClearance,
      iceClearance: Number.isFinite(state.iceClearance)
        ? state.iceClearance
        : null,
      seabedLidar: this.seabedLidar.snapshot,
      signalQuality: this.signal.signalQuality,
      contactSignalStage: contactSignalStage(this.signal.signalQuality),
      contactRingReturnActive:
        this.sonar.listening &&
        this.signal.perceivable &&
        contactSignalStage(this.signal.signalQuality) === "audio-haptic-ring" &&
        forwardRingSectorSensitivity(this.signal.relativeBearingRad) > 0,
      contactRangeMeters: this.developmentEnemyTruthVisible
        ? (this.debugTruthRangeMeters ?? null)
        : null,
      sonarListening: this.sonar.listening,
      sonarFocused: this.sonarFocused,
      contactAudioInCameraSector: this.contactAudioInCameraSector,
      audioSessionActive: this.audio.audioSessionActive,
      audioOutputGain: this.audio.outputGain,
      audioContextState: this.audio.context.state,
      soundtrackPlaying: this.audio.soundtrackPlaying,
      soundtrackGain: this.audio.soundtrackGain,
      surfaceEnvironment: this.audio.surfaceEnvironmentSnapshot,
      sonarContactReportsScheduled: this.audio.sonarContactReportsScheduled,
      ownShipNoise: this.audio.ownShipNoiseGains,
      hullStress: this.audio.hullStressSnapshot,
      contactClassified: this.sonar.classified,
      missionStage: this.missionStage,
      huntScenario: this.huntScenario,
      enemy: {
        classId: this.enemySnapshot.classDefinition.id,
        aiState: this.enemySnapshot.aiState,
        speedKt: this.enemySnapshot.source.speedKt,
        headingRad: this.enemySnapshot.state.heading,
        sourceLevel: this.enemySnapshot.sourceLevel,
        cavitating:
          this.enemySnapshot.source.speedKt >=
          this.enemySnapshot.classDefinition.cavitationThresholdKt,
        maneuverId: this.enemySnapshot.maneuverPlan.id,
        maneuverCourseRad:
          this.enemySnapshot.maneuverPlan.order.desiredCourseRad,
        maneuverSpeedKt: this.enemySnapshot.maneuverPlan.order.desiredSpeedKt,
        perceptionState: this.enemySnapshot.perception.state,
        perceivedPlayerBearingRad: this.enemySnapshot.perception.lastBearingRad,
        perceivedPlayerQuality: this.enemySnapshot.perception.bearingQuality,
        receivedPlayerSignal: this.enemySnapshot.lastReceivedPlayerSignal,
      },
      torpedoFireControl: {
        status:
          this.torpedoPlan?.status ??
          (this.torpedoPlans.length > 0 ? "confirmed" : "idle"),
        enablePoint:
          this.torpedoPlan?.enablePoint ??
          this.torpedoPlans.at(-1)?.enablePoint ??
          null,
        cursorPoint: this.torpedoCursorPoint ?? null,
        queuedPoints: this.torpedoPlans.map(({ enablePoint }) => enablePoint),
        queuedTargets: this.torpedoPlans.map(
          ({ targetTrackId }) => targetTrackId ?? null,
        ),
        targetPrediction:
          this.torpedoTargetPrediction === undefined
            ? null
            : {
                trackId: this.torpedoTargetPrediction.trackId,
                trackLabel: this.torpedoTargetPrediction.trackLabel,
                selectionMode: this.torpedoTargetPrediction.selectionMode,
                candidateIndex: this.torpedoTargetPrediction.candidateIndex,
                candidateCount: this.torpedoTargetPrediction.candidateCount,
                travelTimeSeconds:
                  this.torpedoTargetPrediction.travelTimeSeconds,
                markerSeparationMeters:
                  this.torpedoTargetPrediction.markerSeparationMeters,
                predictedPosition:
                  this.torpedoTargetPrediction.predictedPosition,
              },
        lastSalvoSize: this.lastTorpedoSalvoSize,
        totalLaunched: this.totalTorpedoesLaunched,
      },
      weaponSelection: {
        id: this.currentWeaponCategory().id,
        russianName: this.currentWeaponCategory().russianName,
        available: this.currentWeaponCategory().available,
      },
      contacts: this.contactTracker.snapshots().map((track) => ({
        id: track.id,
        number: track.number,
        status: track.status,
        classId: track.identification?.guessedClassId ?? null,
        observations: track.observations.length,
        estimatedSpeedKt: track.identification?.estimatedSpeedKt ?? null,
        hypotheses: track.solution?.hypotheses.length ?? 0,
        spreadMeters: track.solution?.weightedSpreadMeters ?? null,
        fitResidual: Number.isFinite(track.fitResidual)
          ? track.fitResidual
          : null,
        confidence: track.confidence,
        motionLeg: track.currentMotionLegIndex,
        possibleManeuver: track.possibleManeuver,
      })),
      tmaTruth: this.developmentEnemyTruthVisible
        ? {
            classId: this.enemySnapshot.classDefinition.id,
            speedKt: this.enemySnapshot.source.speedKt,
            position: {
              x: this.enemySnapshot.state.x,
              z: this.enemySnapshot.state.z,
            },
          }
        : undefined,
      position: { x: state.x, y: state.y, z: state.z },
      camera: {
        mode: this.cameraView.mode,
        position: {
          x: this.camera.position.x,
          y: this.camera.position.y,
          z: this.camera.position.z,
        },
        tacticalAmount: this.cameraView.tacticalAmount,
        tacticalZoom: this.cameraView.tacticalZoom,
        tacticalDistance: this.cameraView.tacticalDistance,
        tacticalSpanMeters: this.cameraView.tacticalSpanMeters,
        tacticalYaw: this.cameraView.tacticalYaw,
      },
      underwater: {
        active: this.underwaterOptics.amount > 0.5,
        amount: this.underwaterOptics.amount,
        cameraDepthMeters: this.underwaterOptics.cameraDepthMeters,
        visibilityMeters: this.underwaterOptics.visibilityMeters,
      },
      northSeaEnvironment: {
        phase: this.world.environmentSnapshot.phase,
        rain: this.world.environmentSnapshot.rain,
        visibleRain: this.world.visibleRainIntensity,
        squall: this.world.environmentSnapshot.squall,
        saltHaze: this.world.environmentSnapshot.saltHaze,
        surfaceVisibilityMeters:
          this.world.environmentSnapshot.surfaceVisibilityMeters,
        phytoplanktonBloom: this.world.environmentSnapshot.phytoplanktonBloom,
      },
      renderer: {
        calls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
        geometries: this.renderer.info.memory.geometries,
        textures: this.renderer.info.memory.textures,
      },
      performance: {
        averageFps: meanFrameTime > 0 ? 1_000 / meanFrameTime : 0,
        p95FrameMs: sortedFrameTimes[p95Index] ?? 0,
        maximumFrameMs: sortedFrameTimes.at(-1) ?? 0,
      },
    };
  }

  private bindDebugMenu(): void {
    const menu = requireElement<HTMLElement>(this.root, ".debug-menu");
    const trigger = requireElement<HTMLButtonElement>(
      menu,
      '[data-action="toggle-debug-menu"]',
    );
    const panel = requireElement<HTMLElement>(menu, ".debug-menu-panel");
    const waterFxToggle = requireElement<HTMLButtonElement>(
      panel,
      '[data-action="toggle-waterfx"]',
    );
    const waterFxStatus = requireElement<HTMLElement>(
      waterFxToggle,
      '[data-testid="waterfx-status"]',
    );
    const enemyPosToggle = requireElement<HTMLButtonElement>(
      panel,
      '[data-action="toggle-enemypos"]',
    );
    const enemyPosStatus = requireElement<HTMLElement>(
      enemyPosToggle,
      '[data-testid="enemypos-status"]',
    );
    const vibrationToggle = requireElement<HTMLButtonElement>(
      panel,
      '[data-action="toggle-vibration-x100"]',
    );
    const vibrationStatus = requireElement<HTMLElement>(
      vibrationToggle,
      '[data-testid="vibration-x100-status"]',
    );
    const sensorsToggle = requireElement<HTMLButtonElement>(
      panel,
      '[data-action="toggle-sensors-x100"]',
    );
    const sensorsStatus = requireElement<HTMLElement>(
      sensorsToggle,
      '[data-testid="sensors-x100-status"]',
    );
    const playerSpeedToggle = requireElement<HTMLButtonElement>(
      panel,
      '[data-action="toggle-player-speed-x10"]',
    );
    const playerSpeedStatus = requireElement<HTMLElement>(
      playerSpeedToggle,
      '[data-testid="player-speed-x10-status"]',
    );

    const setMenuOpen = (open: boolean): void => {
      panel.hidden = !open;
      trigger.setAttribute("aria-expanded", String(open));
    };
    const renderWaterFxState = (): void => {
      waterFxToggle.setAttribute("aria-pressed", String(this.waterFxEnabled));
      waterFxToggle.dataset["state"] = this.waterFxEnabled ? "on" : "off";
      waterFxStatus.textContent = this.waterFxEnabled ? "ON" : "OFF";
      this.root.classList.toggle("waterfx-disabled", !this.waterFxEnabled);
    };
    const renderEnemyPosState = (): void => {
      enemyPosToggle.setAttribute(
        "aria-pressed",
        String(this.developmentEnemyTruthVisible),
      );
      enemyPosToggle.dataset["state"] = this.developmentEnemyTruthVisible
        ? "on"
        : "off";
      enemyPosStatus.textContent = this.developmentEnemyTruthVisible
        ? "ON"
        : "OFF";
      this.root.classList.toggle(
        "enemypos-enabled",
        this.developmentEnemyTruthVisible,
      );
    };
    const renderVibrationState = (): void => {
      vibrationToggle.setAttribute(
        "aria-pressed",
        String(this.vibrationX100Enabled),
      );
      vibrationToggle.dataset["state"] = this.vibrationX100Enabled
        ? "on"
        : "off";
      vibrationStatus.textContent = this.vibrationX100Enabled ? "ON" : "OFF";
    };
    const renderSensorsState = (): void => {
      sensorsToggle.setAttribute(
        "aria-pressed",
        String(this.sensorsX100Enabled),
      );
      sensorsToggle.dataset["state"] = this.sensorsX100Enabled ? "on" : "off";
      sensorsStatus.textContent = this.sensorsX100Enabled ? "ON" : "OFF";
    };
    const renderPlayerSpeedState = (): void => {
      playerSpeedToggle.setAttribute(
        "aria-pressed",
        String(this.playerSpeedX10Enabled),
      );
      playerSpeedToggle.dataset["state"] = this.playerSpeedX10Enabled
        ? "on"
        : "off";
      playerSpeedStatus.textContent = this.playerSpeedX10Enabled ? "ON" : "OFF";
    };

    trigger.addEventListener(
      "click",
      () => setMenuOpen(panel.hidden !== false),
      { signal: this.abortController.signal },
    );
    waterFxToggle.addEventListener(
      "click",
      () => {
        this.waterFxEnabled = !this.waterFxEnabled;
        this.world.setWaterEffectsEnabled(this.waterFxEnabled);
        renderWaterFxState();
      },
      { signal: this.abortController.signal },
    );
    enemyPosToggle.addEventListener(
      "click",
      () => {
        this.developmentEnemyTruthVisible = !this.developmentEnemyTruthVisible;
        this.world.setTmaDebugContactVisible(this.developmentEnemyTruthVisible);
        renderEnemyPosState();
        this.updateEnemyTruthHud();
      },
      { signal: this.abortController.signal },
    );
    vibrationToggle.addEventListener(
      "click",
      () => {
        this.vibrationX100Enabled = !this.vibrationX100Enabled;
        this.input.setHapticMagnitudeMultiplier(
          this.vibrationX100Enabled ? DEBUG_HAPTIC_MAGNITUDE_MULTIPLIER : 1,
        );
        renderVibrationState();
      },
      { signal: this.abortController.signal },
    );
    sensorsToggle.addEventListener(
      "click",
      () => {
        this.sensorsX100Enabled = !this.sensorsX100Enabled;
        renderSensorsState();
      },
      { signal: this.abortController.signal },
    );
    playerSpeedToggle.addEventListener(
      "click",
      () => {
        this.playerSpeedX10Enabled = !this.playerSpeedX10Enabled;
        renderPlayerSpeedState();
      },
      { signal: this.abortController.signal },
    );
    globalThis.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape" && !panel.hidden) {
          setMenuOpen(false);
          trigger.focus();
        }
      },
      { signal: this.abortController.signal },
    );
    globalThis.addEventListener(
      "pointerdown",
      (event) => {
        if (event.target instanceof Node && !menu.contains(event.target)) {
          setMenuOpen(false);
        }
      },
      { signal: this.abortController.signal },
    );

    this.world.setWaterEffectsEnabled(this.waterFxEnabled);
    this.input.setHapticMagnitudeMultiplier(1);
    renderWaterFxState();
    renderEnemyPosState();
    renderVibrationState();
    renderSensorsState();
    renderPlayerSpeedState();
  }

  private bindDebugControls(): void {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>(
      "[data-debug-control]",
    )) {
      button.addEventListener(
        "click",
        () => {
          const control = button.dataset["debugControl"];
          const value = Number(button.dataset["debugValue"] ?? 0);
          if (control === "throttleStep") {
            this.debugThrottleStep = value;
            button.classList.add("active");
            globalThis.setTimeout(() => button.classList.remove("active"), 180);
            return;
          }
          if (
            control !== "turn" &&
            control !== "dive" &&
            control !== "ballast"
          ) {
            return;
          }
          const nextValue = this.debugControl[control] === value ? 0 : value;
          this.debugControl[control] = nextValue;
          for (const sibling of this.root.querySelectorAll<HTMLButtonElement>(
            `[data-debug-control="${control}"]`,
          )) {
            sibling.classList.toggle(
              "active",
              Number(sibling.dataset["debugValue"] ?? 0) === nextValue,
            );
          }
        },
        { signal: this.abortController.signal },
      );
    }
    requireElement<HTMLButtonElement>(
      this.root,
      '[data-action="debug-neutral"]',
    ).addEventListener(
      "click",
      () => {
        this.debugThrottleStep = 0;
        this.debugControl.turn = 0;
        this.debugControl.dive = 0;
        this.debugControl.ballast = 0;
        for (const button of this.root.querySelectorAll(
          "[data-debug-control]",
        )) {
          button.classList.remove("active");
        }
      },
      { signal: this.abortController.signal },
    );
    requireElement<HTMLButtonElement>(
      this.root,
      '[data-action="debug-test-haptic"]',
    ).addEventListener(
      "click",
      () => this.input.playTelegraphFeedback("arrived"),
      { signal: this.abortController.signal },
    );
    requireElement<HTMLButtonElement>(
      this.root,
      '[data-action="debug-acquire-contact"]',
    ).addEventListener(
      "click",
      () => {
        const measurement = this.currentContactMeasurement;
        if (measurement === undefined) {
          return;
        }
        this.contactAcquisition = {
          candidateSourceEntityId: measurement.sourceEntityId,
          cueStarted: true,
          pulseCount: CONTACT_ACQUISITION_PULSE_OFFSETS_SECONDS.length,
          dwellSeconds: CONTACT_ACQUISITION_DWELL_SECONDS,
          acquired: true,
        };
        this.acquireContact();
      },
      { signal: this.abortController.signal },
    );
    requireElement<HTMLButtonElement>(
      this.root,
      '[data-action="debug-view-ice"]',
    ).addEventListener(
      "click",
      () => {
        const keel = ICE_KEELS[this.debugIcebergViewIndex % ICE_KEELS.length];
        this.debugIcebergViewIndex += 1;
        if (keel === undefined) {
          return;
        }
        const viewDistance = keel.radiusX + 60;
        this.dynamics.teleport({
          x: keel.x + Math.cos(keel.rotation) * viewDistance,
          y: -45,
          z: keel.z - Math.sin(keel.rotation) * viewDistance,
          heading: -Math.PI / 2 - keel.rotation,
          throttle: 0,
          speedMetersPerSecond: 0,
        });
      },
      { signal: this.abortController.signal },
    );
    requireElement<HTMLButtonElement>(
      this.root,
      '[data-action="debug-view-rift"]',
    ).addEventListener(
      "click",
      () => {
        // Survey landmark: a shallow ridge overlooking the western trough.
        const viewX = 1_100;
        const viewZ = 3_000;
        this.dynamics.teleport({
          x: viewX,
          y: terrainHeightAt(viewX, viewZ) + 24,
          z: viewZ,
          heading: -Math.PI / 2,
          throttle: 0,
          speedMetersPerSecond: 0,
        });
        this.strategicAutoFrameEnabled = false;
        this.cameraRig.frameTacticalSpan(2_400);
      },
      { signal: this.abortController.signal },
    );
    const contactViewButton = requireElement<HTMLButtonElement>(
      this.root,
      '[data-action="debug-view-contact"]',
    );
    contactViewButton.hidden = !TMA_DEBUG;
    contactViewButton.addEventListener(
      "click",
      () => {
        if (!TMA_DEBUG) {
          return;
        }
        const contact = this.enemySnapshot.state;
        this.dynamics.teleport({
          x: contact.x,
          y: contact.y,
          z: contact.z + 220,
          heading: 0,
          throttle: 0,
          speedMetersPerSecond: 0,
        });
        this.cameraRig.center();
      },
      { signal: this.abortController.signal },
    );
    requireElement<HTMLButtonElement>(
      this.root,
      '[data-action="debug-view-surface"]',
    ).addEventListener(
      "click",
      () => {
        const viewX = NORTH_SEA_RIG_POSITION.x - 610;
        const viewZ = NORTH_SEA_RIG_POSITION.z + 730;
        const heading = Math.atan2(
          NORTH_SEA_RIG_POSITION.x - viewX,
          -(NORTH_SEA_RIG_POSITION.z - viewZ),
        );
        this.dynamics.teleport({
          x: viewX,
          y: -2.4,
          z: viewZ,
          heading,
          throttle: 0,
          speedMetersPerSecond: 0,
        });
        this.cameraRig.frameSurfaceView();
      },
      { signal: this.abortController.signal },
    );
    requireElement<HTMLButtonElement>(
      this.root,
      '[data-action="debug-view-map"]',
    ).addEventListener(
      "click",
      () => {
        const recommendedSpan = this.recommendedStrategicViewSpanMeters();
        if (recommendedSpan === undefined) {
          this.strategicAutoFrameEnabled = false;
          this.cameraRig.frameTacticalOverview();
        } else {
          this.strategicAutoFrameEnabled = true;
          this.strategicAutoFrameAge = 0;
          this.cameraRig.frameTacticalSpan(recommendedSpan);
        }
      },
      { signal: this.abortController.signal },
    );
  }

  private applyDebugControls(frame: ControlFrame): ControlFrame {
    const throttleStep =
      this.debugThrottleStep === 0
        ? frame.throttleStep
        : this.debugThrottleStep;
    this.debugThrottleStep = 0;
    return {
      ...frame,
      throttleStep,
      turn: this.debugControl.turn === 0 ? frame.turn : this.debugControl.turn,
      dive: this.debugControl.dive === 0 ? frame.dive : this.debugControl.dive,
      ballast:
        this.debugControl.ballast === 0
          ? frame.ballast
          : this.debugControl.ballast,
    };
  }
}

function formatMapSpan(meters: number): string {
  if (meters < 1_000) {
    return `${Math.round(meters / 50) * 50} M`;
  }
  const kilometers = meters / 1_000;
  return kilometers < 10
    ? `${kilometers.toFixed(1)} KM`
    : `${Math.round(kilometers)} KM`;
}

function requireElement<T extends Element = HTMLElement>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing prototype UI element: ${selector}`);
  }
  return element;
}

function createInterfaceMarkup(): string {
  const localChartDimensions = `${((MAP_HALF_WIDTH * 2) / 1_000).toFixed(1)} × ${((MAP_HALF_LENGTH * 2) / 1_000).toFixed(1)} KM`;
  return `
    <div class="game-shell" data-testid="akula-prototype">
      <div class="viewport"></div>
      <div class="grade grade-top"></div>
      <div class="grade grade-bottom"></div>

      <div class="debug-menu" data-testid="debug-menu">
        <button
          class="debug-menu-trigger"
          type="button"
          data-action="toggle-debug-menu"
          aria-controls="debug-menu-panel"
          aria-expanded="false"
        >debug</button>
        <div class="debug-menu-panel" id="debug-menu-panel" hidden>
          <button
            class="debug-menu-option"
            type="button"
            data-action="toggle-waterfx"
            aria-pressed="true"
          ><span>waterfx</span><small data-testid="waterfx-status">ON</small></button>
          <button
            class="debug-menu-option"
            type="button"
            data-action="toggle-enemypos"
            aria-pressed="false"
          ><span>enemypos</span><small data-testid="enemypos-status">OFF</small></button>
          <button
            class="debug-menu-option"
            type="button"
            data-action="toggle-vibration-x100"
            aria-pressed="false"
          ><span>vibrazione ×100</span><small data-testid="vibration-x100-status">OFF</small></button>
          <button
            class="debug-menu-option"
            type="button"
            data-action="toggle-sensors-x100"
            aria-pressed="false"
          ><span>sensors ×100</span><small data-testid="sensors-x100-status">OFF</small></button>
          <button
            class="debug-menu-option"
            type="button"
            data-action="toggle-player-speed-x10"
            aria-pressed="false"
          ><span>sub speed ×10</span><small data-testid="player-speed-x10-status">OFF</small></button>
        </div>
      </div>

      <div class="contact-billboard" data-testid="contact-billboard" aria-hidden="true">ЦЕЛЬ 1</div>
      <div class="enemy-position-marker" data-testid="enemy-position-marker" aria-hidden="true">
        <i></i><span data-testid="enemy-position-label">ENEMY POS</span>
      </div>

      <header class="heading-mark" aria-label="True heading">
        <i></i><strong data-testid="heading">000°</strong><i></i>
      </header>

      <section class="tactical-minimap" data-testid="tactical-minimap" aria-label="Local overhead chart">
        <div class="minimap-heading" aria-hidden="true">
          <span>LOCAL PLOT</span><b>${localChartDimensions}</b>
        </div>
        <canvas
          data-testid="minimap-canvas"
          data-lod="48x40"
          data-update-hz="8"
          role="img"
          aria-label="Low-detail overhead chart of Frostbite Canyon"
        ></canvas>
        <span class="minimap-north" aria-hidden="true"><i></i>N</span>
        <span class="minimap-scale" aria-hidden="true"><i></i>500 M</span>
      </section>

      <section class="mission-pulse" aria-live="polite">
        <strong data-testid="objective">LOCATE UNKNOWN SOURCE</strong>
        <p data-testid="objective-detail">Sweep the external camera. Listen for a broken machinery rhythm.</p>
        <div class="objective-progress"><i class="objective-progress-fill"></i></div>
      </section>

      <section class="drive-readout" aria-label="Speed and telegraph">
        <strong data-testid="telegraph">SILENT</strong>
        <span><b data-testid="speed">08.2</b><em>kt</em></span>
        <small data-testid="noise-state" data-level="quiet">QUIET</small>
      </section>

      <section class="depth-instrument" aria-label="Depth and clearance">
        <span class="depth-value"><b data-testid="depth">076</b><em>m</em></span>
        <div class="clearance-corridor" aria-hidden="true"><i></i></div>
        <div class="clearance-values">
          <span><small>ICE</small><b data-testid="ice-clearance">68 m</b></span>
          <span><small>FLOOR</small><b data-testid="floor-clearance">124 m</b></span>
        </div>
      </section>

      <div class="control-hint" data-testid="control-hint">
        ARROWS SEARCH   ·   M STRATEGIC
      </div>

      <div class="warning" data-testid="warning" role="status"></div>
      <div class="ping-flash" aria-hidden="true"></div>
      <section class="tactical-overlay" aria-label="Strategic bearing-only TMA" aria-hidden="true">
        <canvas
          class="strategic-plot"
          data-testid="strategic-plot-canvas"
          data-update-hz="4"
          role="img"
          aria-label="Strategic plot of historical bearing lines and the estimated contact track"
        ></canvas>
        <div class="map-title">
          <span>STRATEGIC VIEW</span>
          <b>BEARING-ONLY TMA</b>
          <small>BEARING HISTORY&nbsp;&nbsp;·&nbsp;&nbsp;ESTIMATED TRACK&nbsp;&nbsp;·&nbsp;&nbsp;ASSUMED COURSE</small>
        </div>
        <div class="map-north"><i></i><b>N</b></div>
        <div class="map-scale">
          <i></i><span data-testid="tactical-distance">200 M ACROSS</span>
        </div>
        <div class="map-legend"><i></i><span>ESTIMATED TRACK</span></div>
        <section class="weapon-selector" data-testid="weapon-selector" aria-label="ТОРПЕДЫ; ГОТОВО">
          <div class="weapon-drum" aria-hidden="true">
            <i class="weapon-drum-axis"></i>
            <div class="weapon-slot" data-weapon="torpedo" data-position="active">
              <svg viewBox="0 0 180 46" role="img" aria-label="Torpedo schematic">
                <path d="M16 23c6-8 15-12 28-12h89l19 7v10l-19 7H44c-13 0-22-4-28-12Z" />
                <path d="M31 15v16M47 11v24M92 11v24M126 11v24" />
                <path d="m137 17 12-12M137 29l12 12M149 18l15-9M149 28l15 9" />
                <path d="M158 15v16M165 17v12" />
                <circle cx="28" cy="23" r="5" />
                <path class="weapon-detail-line" d="M52 17h34M52 23h34M52 29h34" />
              </svg>
            </div>
            <div class="weapon-slot" data-weapon="missile" data-position="next">
              <svg viewBox="0 0 180 46" role="img" aria-label="Missile schematic">
                <path d="m13 23 24-12h102l19 8v8l-19 8H37L13 23Z" />
                <path d="M45 12v22M124 11v24M140 16l15-13M140 30l15 13" />
                <path d="m82 12 17-10-6 16M82 34l17 10-6-16" />
                <path class="weapon-detail-line" d="M52 18h22M52 23h57M52 28h22" />
              </svg>
            </div>
            <div class="weapon-slot" data-weapon="mine" data-position="previous">
              <svg viewBox="0 0 180 46" role="img" aria-label="Naval mine schematic">
                <circle cx="90" cy="22" r="15" />
                <path d="M90 7V1M90 37v7M75 22h-7M105 22h7M79 11l-5-5M101 11l5-5M79 33l-5 5M101 33l5 5" />
                <path d="M86 37v5h8v-5M90 42v4" />
                <path class="weapon-detail-line" d="M84 16h12M80 22h20M84 28h12" />
              </svg>
            </div>
          </div>
          <div class="weapon-readout">
            <span data-testid="weapon-name">ТОРПЕДЫ</span>
            <small data-testid="weapon-detail">533 ММ</small>
            <b data-testid="weapon-status">ГОТОВО</b>
            <em data-testid="weapon-salvo-count">ЗАЛП 00</em>
          </div>
          <div class="weapon-step-hint" aria-hidden="true"><i>▲</i><span>D-PAD</span><i>▼</i></div>
        </section>
        <div class="map-return" data-testid="map-action-hint">T PLAN TORPEDO&nbsp;&nbsp;·&nbsp;&nbsp;M RETURN</div>
      </section>

      <aside
        class="sonar-panel"
        data-testid="contact-analysis"
        aria-label="Acoustic analysis for the on-screen contact"
      ></aside>

      <div class="debug-controls" aria-label="Debug pilot controls">
        <span>DEV PILOT</span>
        <button type="button" data-debug-control="throttleStep" data-debug-value="1">FASTER</button>
        <button type="button" data-debug-control="throttleStep" data-debug-value="-1">SLOWER</button>
        <button type="button" data-debug-control="turn" data-debug-value="-1">PORT</button>
        <button type="button" data-debug-control="turn" data-debug-value="1">STBD</button>
        <button type="button" data-debug-control="dive" data-debug-value="-1">RISE</button>
        <button type="button" data-debug-control="dive" data-debug-value="1">DIVE</button>
        <button type="button" data-debug-control="ballast" data-debug-value="-1">BLOW</button>
        <button type="button" data-debug-control="ballast" data-debug-value="1">FLOOD</button>
        <button type="button" data-action="debug-neutral">NEUTRAL</button>
        <button type="button" data-action="debug-test-haptic">TEST HAPTIC</button>
        <button type="button" data-action="debug-acquire-contact">ACQUIRE</button>
        <button type="button" data-action="debug-view-ice">ICE VIEW</button>
        <button type="button" data-action="debug-view-rift">MAREANO VIEW</button>
        <button type="button" data-action="debug-view-contact">CONTACT VIEW</button>
        <button type="button" data-action="debug-view-surface">SURFACE VIEW</button>
        <button type="button" data-action="debug-view-map">MAP VIEW</button>
        <output class="debug-haptic-status" data-testid="haptic-status">HAPTIC · NO GAMEPAD · IDLE</output>
      </div>
      <output data-testid="debug-state" hidden></output>

    </div>
  `;
}
