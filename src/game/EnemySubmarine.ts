import {
  GAMEPLAY_MOVEMENT_SCALE,
  FROSTBITE_TEST_CONTACT,
  knotsToMetersPerSecond,
  observedPropulsionRateFromSpeed,
  vesselClassById,
  type Vec2,
  type VesselClassDefinition,
} from "./NavalContactCatalog";
import {
  simulateVesselPassiveSonar,
  vesselSourceLevel,
  type VesselAcousticState,
} from "./SonarLogic";
import {
  SubmarineDynamics,
  isPropulsionStopped,
  metersPerSecondToKnots,
  type SubmarineControlInput,
  type SubmarineControlProfile,
  type SubmarineDynamicsEnvironment,
  type SubmarineState,
} from "./SubmarineDynamics";

const TAU = Math.PI * 2;
const SENSOR_UPDATE_HZ = 8;
const DECISION_UPDATE_HZ = 1;

export type HuntScenarioPreset = "TMA_TEST_SCRIPTED" | "HUNT_SANDBOX";

export const DEFAULT_HUNT_SCENARIO: HuntScenarioPreset = "HUNT_SANDBOX";

export enum EnemySubmarineState {
  PATROL = "PATROL",
  QUIET_LISTEN = "QUIET_LISTEN",
  BAFFLE_CLEAR = "BAFFLE_CLEAR",
  SUSPICIOUS = "SUSPICIOUS",
  TRACKING = "TRACKING",
  BREAK_CONTACT = "BREAK_CONTACT",
}

export interface ManeuverOrder {
  readonly desiredCourseRad: number;
  readonly desiredSpeedKt: number;
  readonly desiredDepthM: number;
}

export interface ManeuverPlan {
  readonly id: string;
  readonly state: EnemySubmarineState;
  readonly order: ManeuverOrder;
  readonly startedAtSeconds: number;
  readonly minimumEndTimeSeconds: number;
}

export interface EnemyBehaviorConfig {
  readonly seed: number;
  readonly patrolLegDurationMinSec: number;
  readonly patrolLegDurationMaxSec: number;
  readonly baffleClearIntervalMinSec: number;
  readonly baffleClearIntervalMaxSec: number;
  readonly quietListenDurationMinSec: number;
  readonly quietListenDurationMaxSec: number;
  readonly suspiciousSignalThreshold: number;
  readonly trackingSignalThreshold: number;
  readonly contactHoldTimeSec: number;
  readonly contactLostTimeSec: number;
}

export interface ScriptedHuntConfig {
  readonly stableLegEndSec: number;
  readonly turnEndSec: number;
  readonly secondLegEndSec: number;
  readonly sprintEndSec: number;
  readonly quietRunEndSec: number;
  readonly firstCourseRad: number;
  readonly secondCourseRad: number;
  readonly sprintCourseRad: number;
  readonly reacquisitionCourseRad: number;
  readonly depthM: number;
}

export type EnemyAcousticContactState =
  "UNDETECTED" | "FAINT" | "HELD" | "LOST";

export interface EnemyAcousticContact {
  readonly state: EnemyAcousticContactState;
  readonly lastBearingRad: number | null;
  readonly bearingQuality: number;
  readonly firstDetectionTime: number | null;
  readonly lastDetectionTime: number | null;
  readonly bearingHistory: readonly Readonly<{
    timeSeconds: number;
    ownshipPosition: Vec2;
    bearingRad: number;
    quality: number;
  }>[];
}

export interface AcousticPlatformState extends VesselAcousticState {
  readonly propulsionStopped: boolean;
  readonly classDefinition: VesselClassDefinition;
}

export interface EnemySubmarineSnapshot {
  readonly entityId: string;
  readonly classDefinition: VesselClassDefinition;
  readonly state: SubmarineState;
  readonly aiState: EnemySubmarineState;
  readonly maneuverPlan: ManeuverPlan;
  readonly controlInput: SubmarineControlInput;
  readonly perception: EnemyAcousticContact;
  readonly source: VesselAcousticState;
  readonly sourceLevel: number;
  readonly observedPropulsionRateHz: number;
  readonly cycleDurationSeconds: number;
  readonly lastReceivedPlayerSignal: number;
  readonly lastPlayerSignalQuality: number;
  readonly maneuverStartedAtSeconds: number;
}

export const DEFAULT_ENEMY_BEHAVIOR_CONFIG: EnemyBehaviorConfig = Object.freeze(
  {
    seed: 971_1984,
    patrolLegDurationMinSec: 72,
    patrolLegDurationMaxSec: 118,
    baffleClearIntervalMinSec: 95,
    baffleClearIntervalMaxSec: 155,
    quietListenDurationMinSec: 28,
    quietListenDurationMaxSec: 52,
    suspiciousSignalThreshold: 0.28,
    trackingSignalThreshold: 0.43,
    contactHoldTimeSec: 4,
    contactLostTimeSec: 7,
  },
);

export const DEFAULT_SCRIPTED_HUNT_CONFIG: ScriptedHuntConfig = Object.freeze({
  stableLegEndSec: 120,
  turnEndSec: 165,
  secondLegEndSec: 270,
  sprintEndSec: 305,
  quietRunEndSec: 420,
  firstCourseRad: radians(315),
  secondCourseRad: radians(75),
  sprintCourseRad: radians(118),
  reacquisitionCourseRad: radians(248),
  depthM: 180,
});

/** The strategic ocean surrounding the compact rendered Frostbite volume. */
export const HUNT_ENEMY_ENVIRONMENT: SubmarineDynamicsEnvironment =
  Object.freeze({
    halfWidthMeters: 30_000,
    halfLengthMeters: 30_000,
    marginMeters: 300,
    terrainHeightAt: deepOceanFloorAt,
    iceCeilingAt: () => Number.POSITIVE_INFINITY,
  });

/** Acoustic source definition for the player boat; never used for UI identity. */
export const AKULA_PLAYER_ACOUSTIC_CLASS: VesselClassDefinition = Object.freeze(
  {
    id: "project-971-akula-player",
    displayName: "Project 971 Akula",
    faction: "USSR",
    signatureCode: [2, 4, 7] as const,
    audioProfileId: "sierra-i-machinery",
    propulsionRatePerKnot: 0.026,
    minOperationalSpeedKt: 3,
    maxOperationalSpeedKt: 31,
    quietSpeedKt: 5,
    patrolSpeedKt: 9,
    sprintSpeedKt: 27,
    accelerationKtPerSec: 0.2,
    decelerationKtPerSec: 0.25,
    maxTurnRateDegPerSec: 2,
    baseRadiatedNoise: 0.34,
    cavitationThresholdKt: 19,
  },
);

export class SubmarineAutopilot {
  private orderValue: ManeuverOrder;
  private controlValue: SubmarineControlInput = {
    rudder: 0,
    throttle: 0,
    divePlanes: 0,
  };
  private commandedSpeedKt: number;

  public constructor(
    private readonly vesselClass: VesselClassDefinition,
    private readonly environment: SubmarineDynamicsEnvironment,
    initialOrder: ManeuverOrder,
  ) {
    this.orderValue = normalizeOrder(initialOrder, vesselClass);
    this.commandedSpeedKt = this.orderValue.desiredSpeedKt;
  }

  public get order(): ManeuverOrder {
    return this.orderValue;
  }

  public get controlInput(): SubmarineControlInput {
    return this.controlValue;
  }

  public setOrder(order: ManeuverOrder): void {
    this.orderValue = normalizeOrder(order, this.vesselClass);
  }

  public cancel(state: SubmarineState): void {
    this.orderValue = {
      desiredCourseRad: state.heading,
      desiredSpeedKt: Math.abs(
        metersPerSecondToKnots(state.speedMetersPerSecond),
      ),
      desiredDepthM: Math.max(0, -state.y),
    };
  }

  public update(
    state: SubmarineState,
    elapsedSeconds: number,
  ): SubmarineControlInput {
    const desiredSpeed = this.orderValue.desiredSpeedKt;
    const speedStep =
      desiredSpeed >= this.commandedSpeedKt
        ? this.vesselClass.accelerationKtPerSec
        : this.vesselClass.decelerationKtPerSec;
    this.commandedSpeedKt = moveTowards(
      this.commandedSpeedKt,
      desiredSpeed,
      speedStep * Math.max(0, elapsedSeconds),
    );

    const avoidance = obstacleAvoidance(
      state,
      this.orderValue.desiredDepthM,
      this.environment,
    );
    const desiredCourse = normalizePositiveAngle(
      this.orderValue.desiredCourseRad + avoidance.courseOffsetRad,
    );
    const courseError = wrapAngle(desiredCourse - state.heading);
    const rudderLimit = clamp(
      this.vesselClass.maxTurnRateDegPerSec / 5.7,
      0.18,
      1,
    );
    const rudder = clamp(courseError / radians(32), -1, 1) * rudderLimit;
    const depthMeters = Math.max(0, -state.y);
    const depthError = this.orderValue.desiredDepthM - depthMeters;
    const divePlanes = clamp(
      depthError / 42 - state.depthRate * 0.16 + avoidance.diveBias,
      -1,
      1,
    );
    const throttle = clamp(
      this.commandedSpeedKt / this.vesselClass.maxOperationalSpeedKt,
      0,
      1,
    );
    this.controlValue = { rudder, throttle, divePlanes };
    return this.controlValue;
  }
}

export class EnemyPassiveSensor {
  private stateValue: EnemyAcousticContactState = "UNDETECTED";
  private lastBearingRad: number | null = null;
  private bearingQuality = 0;
  private firstDetectionTime: number | null = null;
  private lastDetectionTime: number | null = null;
  private readonly bearingHistory: Array<{
    timeSeconds: number;
    ownshipPosition: Vec2;
    bearingRad: number;
    quality: number;
  }> = [];
  private aboveFaintSeconds = 0;
  private aboveHeldSeconds = 0;
  private belowFaintSeconds = 0;
  private accumulatorSeconds = 0;
  private lastReceivedSignal = Number.NEGATIVE_INFINITY;
  private lastSignalQuality = 0;

  public constructor(
    private readonly config: EnemyBehaviorConfig,
    private readonly logger: HuntLogger,
  ) {}

  public get snapshot(): EnemyAcousticContact {
    return {
      state: this.stateValue,
      lastBearingRad: this.lastBearingRad,
      bearingQuality: this.bearingQuality,
      firstDetectionTime: this.firstDetectionTime,
      lastDetectionTime: this.lastDetectionTime,
      bearingHistory: this.bearingHistory.map((sample) => ({ ...sample })),
    };
  }

  public get receivedSignal(): number {
    return this.lastReceivedSignal;
  }

  public get signalQuality(): number {
    return this.lastSignalQuality;
  }

  public update(
    elapsedSeconds: number,
    timeSeconds: number,
    ownship: SubmarineState,
    source: AcousticPlatformState,
  ): void {
    this.accumulatorSeconds += Math.max(0, elapsedSeconds);
    const interval = 1 / SENSOR_UPDATE_HZ;
    if (this.accumulatorSeconds + 1e-8 < interval) {
      return;
    }
    const sensorElapsed = this.accumulatorSeconds;
    this.accumulatorSeconds %= interval;
    const result = simulateVesselPassiveSonar(
      { x: ownship.x, y: ownship.y, z: ownship.z },
      ownship.heading,
      ownship.speedMetersPerSecond,
      source,
      source.classDefinition,
      isPropulsionStopped(ownship.throttle),
    );
    const quality = result.measurement.signalQuality;
    this.lastReceivedSignal = result.acoustics.receivedSignal;
    this.lastSignalQuality = quality;
    const aboveFaint =
      result.measurement.perceivable &&
      quality >= this.config.suspiciousSignalThreshold;
    const aboveHeld =
      result.measurement.perceivable &&
      quality >= this.config.trackingSignalThreshold;
    this.aboveFaintSeconds = aboveFaint
      ? this.aboveFaintSeconds + sensorElapsed
      : 0;
    this.aboveHeldSeconds = aboveHeld
      ? this.aboveHeldSeconds + sensorElapsed
      : 0;
    this.belowFaintSeconds = aboveFaint
      ? 0
      : this.belowFaintSeconds + sensorElapsed;

    if (aboveFaint) {
      const sigmaRad = radians(0.35 + (1 - quality) * 3.2);
      const deterministicError =
        Math.sin(timeSeconds * 0.73 + this.config.seed * 0.001) * sigmaRad;
      this.lastBearingRad = normalizePositiveAngle(
        result.measurement.worldBearingRad + deterministicError,
      );
      this.bearingQuality = quality;
      this.firstDetectionTime ??= timeSeconds;
      this.lastDetectionTime = timeSeconds;
    } else {
      this.bearingQuality = Math.max(
        0,
        this.bearingQuality - sensorElapsed * 0.08,
      );
    }

    const previous = this.stateValue;
    if (
      (previous === "UNDETECTED" || previous === "LOST") &&
      this.aboveFaintSeconds >= this.config.contactHoldTimeSec * 0.5
    ) {
      this.stateValue = "FAINT";
    } else if (
      previous === "FAINT" &&
      this.aboveHeldSeconds >= this.config.contactHoldTimeSec
    ) {
      this.stateValue = "HELD";
    } else if (previous === "HELD" && !aboveHeld) {
      this.stateValue = "FAINT";
    } else if (
      previous === "FAINT" &&
      this.belowFaintSeconds >= this.config.contactLostTimeSec
    ) {
      this.stateValue = "LOST";
    }
    if (previous !== this.stateValue) {
      this.logger(`[ENEMY_SENSOR] ${previous} -> ${this.stateValue}`);
    }
    if (this.stateValue === "FAINT" || this.stateValue === "HELD") {
      const bearing = this.lastBearingRad;
      if (bearing !== null) {
        this.bearingHistory.push({
          timeSeconds,
          ownshipPosition: { x: ownship.x, z: ownship.z },
          bearingRad: bearing,
          quality,
        });
        if (this.bearingHistory.length > 160) {
          this.bearingHistory.shift();
        }
      }
    }
  }
}

class EnemyBehaviorPlanner {
  private readonly random: SeededRandom;
  private planValue: ManeuverPlan;
  private nextRoutineAtSeconds: number;
  private trackingStartedAtSeconds = 0;
  private planSequence = 0;

  public constructor(
    private readonly scenario: HuntScenarioPreset,
    private readonly vesselClass: VesselClassDefinition,
    private readonly config: EnemyBehaviorConfig,
    initialCourseRad: number,
    initialDepthM: number,
    private readonly logger: HuntLogger,
    private readonly scriptedConfig: ScriptedHuntConfig,
  ) {
    this.random = new SeededRandom(config.seed);
    this.planValue = this.createPlan(
      EnemySubmarineState.PATROL,
      {
        desiredCourseRad: initialCourseRad,
        desiredSpeedKt: vesselClass.patrolSpeedKt,
        desiredDepthM: initialDepthM,
      },
      0,
      config.patrolLegDurationMinSec,
    );
    this.nextRoutineAtSeconds = this.random.range(
      config.baffleClearIntervalMinSec,
      config.baffleClearIntervalMaxSec,
    );
  }

  public get plan(): ManeuverPlan {
    return this.planValue;
  }

  public update(
    timeSeconds: number,
    submarine: SubmarineState,
    perception: EnemyAcousticContact,
  ): ManeuverPlan {
    if (this.scenario === "TMA_TEST_SCRIPTED") {
      return this.updateScripted(timeSeconds);
    }
    const current = this.planValue.state;
    if (
      perception.state === "HELD" &&
      current !== EnemySubmarineState.TRACKING &&
      current !== EnemySubmarineState.BREAK_CONTACT
    ) {
      this.trackingStartedAtSeconds = timeSeconds;
      return this.transition(
        EnemySubmarineState.TRACKING,
        transverseOrder(
          perception.lastBearingRad,
          submarine,
          this.vesselClass.patrolSpeedKt,
          this.config.seed,
        ),
        timeSeconds,
        46,
      );
    }
    if (
      perception.state === "FAINT" &&
      current !== EnemySubmarineState.SUSPICIOUS &&
      current !== EnemySubmarineState.TRACKING &&
      current !== EnemySubmarineState.BREAK_CONTACT
    ) {
      return this.transition(
        EnemySubmarineState.SUSPICIOUS,
        suspiciousOrder(
          perception.lastBearingRad,
          submarine,
          this.vesselClass.quietSpeedKt,
          this.config.seed,
        ),
        timeSeconds,
        this.random.range(28, 46),
      );
    }
    if (
      current === EnemySubmarineState.TRACKING &&
      (timeSeconds - this.trackingStartedAtSeconds >= 58 ||
        perception.bearingQuality >= 0.78)
    ) {
      return this.transition(
        EnemySubmarineState.BREAK_CONTACT,
        breakContactOrder(
          perception.lastBearingRad,
          submarine,
          this.vesselClass.sprintSpeedKt,
          this.config.seed,
        ),
        timeSeconds,
        34,
      );
    }
    if (
      current === EnemySubmarineState.BREAK_CONTACT &&
      timeSeconds >= this.planValue.minimumEndTimeSeconds
    ) {
      return this.transition(
        EnemySubmarineState.QUIET_LISTEN,
        {
          desiredCourseRad: submarine.heading,
          desiredSpeedKt: this.vesselClass.quietSpeedKt,
          desiredDepthM: -submarine.y,
        },
        timeSeconds,
        this.random.range(
          this.config.quietListenDurationMinSec,
          this.config.quietListenDurationMaxSec,
        ),
      );
    }
    if (
      (current === EnemySubmarineState.QUIET_LISTEN ||
        current === EnemySubmarineState.SUSPICIOUS) &&
      timeSeconds >= this.planValue.minimumEndTimeSeconds
    ) {
      return this.transition(
        EnemySubmarineState.PATROL,
        {
          desiredCourseRad: submarine.heading,
          desiredSpeedKt: this.vesselClass.patrolSpeedKt,
          desiredDepthM: -submarine.y,
        },
        timeSeconds,
        this.random.range(
          this.config.patrolLegDurationMinSec,
          this.config.patrolLegDurationMaxSec,
        ),
      );
    }
    if (
      current === EnemySubmarineState.BAFFLE_CLEAR &&
      timeSeconds >= this.planValue.minimumEndTimeSeconds &&
      Math.abs(
        wrapAngle(this.planValue.order.desiredCourseRad - submarine.heading),
      ) < radians(7)
    ) {
      this.nextRoutineAtSeconds =
        timeSeconds +
        this.random.range(
          this.config.baffleClearIntervalMinSec,
          this.config.baffleClearIntervalMaxSec,
        );
      return this.transition(
        EnemySubmarineState.QUIET_LISTEN,
        {
          desiredCourseRad: submarine.heading,
          desiredSpeedKt: this.vesselClass.quietSpeedKt,
          desiredDepthM: -submarine.y,
        },
        timeSeconds,
        this.random.range(
          this.config.quietListenDurationMinSec,
          this.config.quietListenDurationMaxSec,
        ),
      );
    }
    if (
      current === EnemySubmarineState.PATROL &&
      timeSeconds >= this.nextRoutineAtSeconds
    ) {
      const angle = radians(this.random.range(78, 148));
      const side = this.random.next() < 0.5 ? -1 : 1;
      return this.transition(
        EnemySubmarineState.BAFFLE_CLEAR,
        {
          desiredCourseRad: normalizePositiveAngle(
            submarine.heading + angle * side,
          ),
          desiredSpeedKt: this.vesselClass.patrolSpeedKt,
          desiredDepthM: -submarine.y,
        },
        timeSeconds,
        20,
      );
    }
    return this.planValue;
  }

  private updateScripted(timeSeconds: number): ManeuverPlan {
    const scripted = this.scriptedConfig;
    const depth = scripted.depthM;
    const phase =
      timeSeconds < scripted.stableLegEndSec
        ? {
            state: EnemySubmarineState.PATROL,
            course: scripted.firstCourseRad,
            speed: this.vesselClass.patrolSpeedKt,
            end: scripted.stableLegEndSec,
          }
        : timeSeconds < scripted.turnEndSec
          ? {
              state: EnemySubmarineState.BAFFLE_CLEAR,
              course: scripted.secondCourseRad,
              speed: this.vesselClass.patrolSpeedKt,
              end: scripted.turnEndSec,
            }
          : timeSeconds < scripted.secondLegEndSec
            ? {
                state: EnemySubmarineState.PATROL,
                course: scripted.secondCourseRad,
                speed: this.vesselClass.patrolSpeedKt,
                end: scripted.secondLegEndSec,
              }
            : timeSeconds < scripted.sprintEndSec
              ? {
                  state: EnemySubmarineState.BREAK_CONTACT,
                  course: scripted.sprintCourseRad,
                  speed: this.vesselClass.sprintSpeedKt,
                  end: scripted.sprintEndSec,
                }
              : timeSeconds < scripted.quietRunEndSec
                ? {
                    state: EnemySubmarineState.QUIET_LISTEN,
                    course: scripted.sprintCourseRad,
                    speed: this.vesselClass.quietSpeedKt,
                    end: scripted.quietRunEndSec,
                  }
                : {
                    state: EnemySubmarineState.PATROL,
                    course: scripted.reacquisitionCourseRad,
                    speed: this.vesselClass.patrolSpeedKt,
                    end: 900,
                  };
    if (phase.state !== this.planValue.state) {
      return this.transition(
        phase.state,
        {
          desiredCourseRad: phase.course,
          desiredSpeedKt: phase.speed,
          desiredDepthM: depth,
        },
        timeSeconds,
        Math.max(0, phase.end - timeSeconds),
      );
    }
    return this.planValue;
  }

  private transition(
    state: EnemySubmarineState,
    order: ManeuverOrder,
    timeSeconds: number,
    minimumDurationSeconds: number,
  ): ManeuverPlan {
    const previous = this.planValue;
    this.planValue = this.createPlan(
      state,
      order,
      timeSeconds,
      minimumDurationSeconds,
    );
    this.logger(`[ENEMY_AI] ${previous.state} -> ${state}`);
    this.logger(
      `[ENEMY_AI] desired course ${formatDegrees(previous.order.desiredCourseRad)} -> ${formatDegrees(order.desiredCourseRad)}`,
    );
    return this.planValue;
  }

  private createPlan(
    state: EnemySubmarineState,
    order: ManeuverOrder,
    timeSeconds: number,
    minimumDurationSeconds: number,
  ): ManeuverPlan {
    this.planSequence += 1;
    return {
      id: `maneuver-${String(this.planSequence)}`,
      state,
      order: normalizeOrder(order, this.vesselClass),
      startedAtSeconds: timeSeconds,
      minimumEndTimeSeconds: timeSeconds + minimumDurationSeconds,
    };
  }
}

export class EnemySubmarine {
  private readonly vesselClass = vesselClassById(
    FROSTBITE_TEST_CONTACT.classId,
  );
  private readonly controlProfile: SubmarineControlProfile = Object.freeze({
    maxAheadSpeedKt: this.vesselClass.maxOperationalSpeedKt,
    maxAsternSpeedKt: this.vesselClass.minOperationalSpeedKt,
    accelerationKtPerSec: this.vesselClass.accelerationKtPerSec,
    decelerationKtPerSec: this.vesselClass.decelerationKtPerSec,
    maxTurnRateDegPerSec: this.vesselClass.maxTurnRateDegPerSec,
  });
  private readonly dynamics: SubmarineDynamics;
  private readonly sensor: EnemyPassiveSensor;
  private readonly behavior: EnemyBehaviorPlanner;
  private readonly autopilot: SubmarineAutopilot;
  private decisionAccumulatorSeconds = 0;
  private speedKt = FROSTBITE_TEST_CONTACT.trueSpeedKt;
  private accelerationKtPerSec = 0;
  private turnRateDegPerSec = 0;
  private controlInputValue: SubmarineControlInput = {
    rudder: 0,
    throttle: 0.2,
    divePlanes: 0,
  };

  public constructor(
    private readonly scenario: HuntScenarioPreset = DEFAULT_HUNT_SCENARIO,
    private readonly config: EnemyBehaviorConfig = DEFAULT_ENEMY_BEHAVIOR_CONFIG,
    loggingEnabled = false,
    scriptedConfig: ScriptedHuntConfig = DEFAULT_SCRIPTED_HUNT_CONFIG,
  ) {
    const logger: HuntLogger = loggingEnabled
      ? (message) => console.warn(message)
      : () => undefined;
    const initialDepthM = 180;
    this.dynamics = new SubmarineDynamics(
      {
        x: FROSTBITE_TEST_CONTACT.truePosition.x,
        y: -initialDepthM,
        z: FROSTBITE_TEST_CONTACT.truePosition.z,
        heading: FROSTBITE_TEST_CONTACT.trueCourseRad,
        speedMetersPerSecond: knotsToMetersPerSecond(
          FROSTBITE_TEST_CONTACT.trueSpeedKt,
        ),
        throttle: 0.16,
      },
      HUNT_ENEMY_ENVIRONMENT,
    );
    this.sensor = new EnemyPassiveSensor(config, logger);
    this.behavior = new EnemyBehaviorPlanner(
      scenario,
      this.vesselClass,
      config,
      FROSTBITE_TEST_CONTACT.trueCourseRad,
      initialDepthM,
      logger,
      scriptedConfig,
    );
    this.autopilot = new SubmarineAutopilot(
      this.vesselClass,
      HUNT_ENEMY_ENVIRONMENT,
      this.behavior.plan.order,
    );
  }

  public get snapshot(): EnemySubmarineSnapshot {
    const state = this.dynamics.state;
    const source = this.sourceState(state);
    const observedPropulsionRateHz = observedPropulsionRateFromSpeed(
      this.speedKt,
      this.vesselClass,
    );
    return {
      entityId: FROSTBITE_TEST_CONTACT.entityId,
      classDefinition: this.vesselClass,
      state,
      aiState: this.behavior.plan.state,
      maneuverPlan: this.behavior.plan,
      controlInput: this.controlInputValue,
      perception: this.sensor.snapshot,
      source,
      sourceLevel: vesselSourceLevel(source, this.vesselClass),
      observedPropulsionRateHz,
      cycleDurationSeconds:
        observedPropulsionRateHz > 1e-5 ? 1 / observedPropulsionRateHz : 12,
      lastReceivedPlayerSignal: this.sensor.receivedSignal,
      lastPlayerSignalQuality: this.sensor.signalQuality,
      maneuverStartedAtSeconds: this.behavior.plan.startedAtSeconds,
    };
  }

  public update(
    timeSeconds: number,
    elapsedSeconds: number,
    player: AcousticPlatformState,
  ): EnemySubmarineSnapshot {
    const previous = this.dynamics.state;
    this.sensor.update(elapsedSeconds, timeSeconds, previous, player);
    this.decisionAccumulatorSeconds += Math.max(0, elapsedSeconds);
    if (this.decisionAccumulatorSeconds + 1e-8 >= 1 / DECISION_UPDATE_HZ) {
      this.decisionAccumulatorSeconds %= 1 / DECISION_UPDATE_HZ;
      const plan = this.behavior.update(
        timeSeconds,
        previous,
        this.sensor.snapshot,
      );
      this.autopilot.setOrder(plan.order);
    }
    this.controlInputValue = this.autopilot.update(previous, elapsedSeconds);
    const next = this.dynamics.updateControl(
      this.controlInputValue,
      elapsedSeconds,
      this.controlProfile,
    );
    const nextSpeedKt = Math.abs(
      metersPerSecondToKnots(next.speedMetersPerSecond),
    );
    const safeElapsed = Math.max(1e-4, elapsedSeconds);
    this.accelerationKtPerSec = clamp(
      (nextSpeedKt - this.speedKt) / safeElapsed,
      -3,
      3,
    );
    this.turnRateDegPerSec =
      (wrapAngle(next.heading - previous.heading) * 180) /
      Math.PI /
      safeElapsed;
    this.speedKt = nextSpeedKt;
    return this.snapshot;
  }

  private sourceState(state: SubmarineState): VesselAcousticState {
    return {
      position: { x: state.x, y: state.y, z: state.z },
      headingRad: state.heading,
      speedKt: this.speedKt,
      accelerationKtPerSec: this.accelerationKtPerSec,
      turnRateDegPerSec: this.turnRateDegPerSec,
    };
  }
}

export function huntScenarioFromSearch(search: string): HuntScenarioPreset {
  const requested = new URLSearchParams(search).get("scenario");
  return requested === "TMA_TEST_SCRIPTED" || requested === "scripted"
    ? "TMA_TEST_SCRIPTED"
    : "HUNT_SANDBOX";
}

export function deterministicManeuverPlan(
  seed: number,
  sampleCount = 8,
): readonly number[] {
  const random = new SeededRandom(seed);
  return Array.from({ length: Math.max(0, sampleCount) }, () =>
    Number(random.next().toFixed(9)),
  );
}

function obstacleAvoidance(
  state: SubmarineState,
  desiredDepthM: number,
  environment: SubmarineDynamicsEnvironment,
): Readonly<{ courseOffsetRad: number; diveBias: number }> {
  const speedMps = Math.abs(state.speedMetersPerSecond);
  const probeDistance = clamp(
    speedMps * GAMEPLAY_MOVEMENT_SCALE * 34,
    260,
    760,
  );
  const probeX = state.x + Math.sin(state.heading) * probeDistance;
  const probeZ = state.z - Math.cos(state.heading) * probeDistance;
  const probeFloor = environment.terrainHeightAt(probeX, probeZ);
  const desiredY = -Math.max(0, desiredDepthM);
  const floorClearance = desiredY - probeFloor;
  const nearBoundary =
    Math.abs(probeX) >=
      environment.halfWidthMeters - environment.marginMeters * 1.8 ||
    Math.abs(probeZ) >=
      environment.halfLengthMeters - environment.marginMeters * 1.8;
  if (floorClearance >= 52 && !nearBoundary) {
    return { courseOffsetRad: 0, diveBias: 0 };
  }
  const deterministicSide =
    Math.sin(state.x * 0.0017 + state.z * 0.0023) >= 0 ? 1 : -1;
  return {
    courseOffsetRad: radians(48) * deterministicSide,
    diveBias: floorClearance < 34 ? -0.55 : -0.18,
  };
}

function deepOceanFloorAt(x: number, z: number): number {
  return (
    -520 +
    Math.sin(x * 0.00042 + z * 0.00017) * 34 +
    Math.cos(z * 0.00031 - x * 0.00011) * 22
  );
}

function transverseOrder(
  bearingRad: number | null,
  submarine: SubmarineState,
  speedKt: number,
  seed: number,
): ManeuverOrder {
  const bearing = bearingRad ?? submarine.heading;
  const side = Math.sin(seed * 0.017 + bearing) >= 0 ? 1 : -1;
  return {
    desiredCourseRad: normalizePositiveAngle(bearing + side * Math.PI * 0.5),
    desiredSpeedKt: speedKt,
    desiredDepthM: -submarine.y,
  };
}

function suspiciousOrder(
  bearingRad: number | null,
  submarine: SubmarineState,
  speedKt: number,
  seed: number,
): ManeuverOrder {
  const bearing = bearingRad ?? submarine.heading;
  const side = Math.sin(seed * 0.013 + bearing * 1.7) >= 0 ? 1 : -1;
  return {
    desiredCourseRad: normalizePositiveAngle(bearing + side * radians(42)),
    desiredSpeedKt: speedKt,
    desiredDepthM: -submarine.y,
  };
}

function breakContactOrder(
  bearingRad: number | null,
  submarine: SubmarineState,
  speedKt: number,
  seed: number,
): ManeuverOrder {
  const bearing = bearingRad ?? submarine.heading;
  const side = Math.sin(seed * 0.029 + bearing * 0.8) >= 0 ? 1 : -1;
  return {
    desiredCourseRad: normalizePositiveAngle(
      bearing + Math.PI + side * radians(36),
    ),
    desiredSpeedKt: speedKt,
    desiredDepthM: -submarine.y,
  };
}

function normalizeOrder(
  order: ManeuverOrder,
  vesselClass: VesselClassDefinition,
): ManeuverOrder {
  return {
    desiredCourseRad: normalizePositiveAngle(order.desiredCourseRad),
    desiredSpeedKt: clamp(
      order.desiredSpeedKt,
      0,
      vesselClass.maxOperationalSpeedKt,
    ),
    desiredDepthM: clamp(order.desiredDepthM, 20, 430),
  };
}

class SeededRandom {
  private state: number;

  public constructor(seed: number) {
    this.state = seed >>> 0;
  }

  public next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }

  public range(minimum: number, maximum: number): number {
    return minimum + (maximum - minimum) * this.next();
  }
}

type HuntLogger = (message: string) => void;

function moveTowards(
  current: number,
  target: number,
  maximumDelta: number,
): number {
  if (Math.abs(target - current) <= maximumDelta) {
    return target;
  }
  return current + Math.sign(target - current) * maximumDelta;
}

function formatDegrees(radiansValue: number): string {
  return String(
    Math.round((normalizePositiveAngle(radiansValue) * 180) / Math.PI),
  );
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function normalizePositiveAngle(angle: number): number {
  return ((angle % TAU) + TAU) % TAU;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
