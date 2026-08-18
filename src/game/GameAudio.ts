import { clamp } from "./WorldGeometry";
import {
  CONTACT_AUDIO_MINIMUM_SIGNAL_QUALITY,
  CONTACT_HAPTIC_MINIMUM_SIGNAL_QUALITY,
  CONTACT_RING_MINIMUM_SIGNAL_QUALITY,
  contactSignalProgress,
} from "./ContactSensoryProgression";
import { formatCircularBearing } from "./SonarLogic";
import { isPropulsionStopped } from "./SubmarineDynamics";
import { HullStressAudio, type HullStressSnapshot } from "./HullStressAudio";

const RUSSIAN_COMMS_ASSET_ROOT = "assets/audio/comms/ru/denis-new-contact";
const SCORE_ASSET_PATH = "assets/audio/music/north-sea/freight-hop.mp3";
const SURFACE_STORM_ASSET_PATH =
  "assets/audio/environment/north-sea/storm-at-sea-cc0.mp3";
const MASTER_GAIN = 0.72;
const SCORE_GAIN = {
  passiveArrayLive: 0.006,
  firstContactHint: 0.116,
  passiveArrayMuted: 0.13,
} as const;
const CONTACT_OWN_SHIP_DUCK_GAIN = 0.04;
export const CONTACT_COMFORT_MAXIMUM_MIX_GAIN = 0.58;
const COMMS_CLIP_NAMES = [
  "contact-first",
  "contact-repeat",
  "target-one",
  "digit-0-mid",
  "digit-1-mid",
  "digit-2-mid",
  "digit-3-mid",
  "digit-4-mid",
  "digit-5-mid",
  "digit-6-mid",
  "digit-7-mid",
  "digit-8-mid",
  "digit-9-mid",
] as const;

type CommsClipName = (typeof COMMS_CLIP_NAMES)[number];

interface GameAudioOptions {
  readonly spokenCommsEnabled?: boolean;
}

export interface OwnShipNoiseGains {
  readonly machinery: number;
  readonly flow: number;
}

export interface ContactMixTargets {
  readonly contact: number;
  readonly soundtrack: number;
  readonly ownShip: number;
}

export interface CameraMediumMixTargets {
  /** 0 underwater, 1 in air. Kept explicit for debug and regression tests. */
  readonly airExposure: number;
  readonly stormGain: number;
  readonly stormLowpassHz: number;
  readonly stormFilterQ: number;
}

export interface SurfaceEnvironmentSnapshot extends CameraMediumMixTargets {
  readonly loaded: boolean;
  readonly playing: boolean;
  readonly underwaterAmount: number;
}

export class GameAudio {
  public readonly context: AudioContext;
  public readonly sonarBus: GainNode;
  public readonly sonarContactInput: StereoPannerNode;
  private readonly master: GainNode;
  private readonly commsGain: GainNode;
  private readonly scoreGain: GainNode;
  private readonly surfaceStormGain: GainNode;
  private readonly surfaceStormFilter: BiquadFilterNode;
  private readonly ownShipDuckGain: GainNode;
  private readonly hullStress: HullStressAudio;
  private readonly machineryGain: GainNode;
  private readonly flowGain: GainNode;
  private readonly machineryOscillator: OscillatorNode;
  private readonly machineryOvertone: OscillatorNode;
  private readonly flowSource: AudioBufferSourceNode;
  private readonly activeCommsSources = new Set<AudioBufferSourceNode>();
  private commsBuffers: ReadonlyMap<CommsClipName, AudioBuffer> | undefined;
  private commsLoadPromise:
    Promise<ReadonlyMap<CommsClipName, AudioBuffer>> | undefined;
  private scoreBuffer: AudioBuffer | undefined;
  private scoreLoadPromise: Promise<AudioBuffer> | undefined;
  private scoreStartPromise: Promise<void> | undefined;
  private scoreSource: AudioBufferSourceNode | undefined;
  private scoreTargetGain: number = SCORE_GAIN.passiveArrayMuted;
  private surfaceStormBuffer: AudioBuffer | undefined;
  private surfaceStormLoadPromise: Promise<AudioBuffer> | undefined;
  private surfaceStormStartPromise: Promise<void> | undefined;
  private surfaceStormSource: AudioBufferSourceNode | undefined;
  private surfaceEnvironmentSnapshotValue: SurfaceEnvironmentSnapshot = {
    ...cameraMediumMixTargets(1),
    loaded: false,
    playing: false,
    underwaterAmount: 1,
  };
  private readonly spokenCommsEnabled: boolean;
  private sonarContactReportCount = 0;
  private sessionActive = false;
  private disposed = false;

  public constructor(options: GameAudioOptions = {}) {
    this.spokenCommsEnabled = options.spokenCommsEnabled ?? true;
    this.context = new AudioContext({ latencyHint: "interactive" });
    const compressor = this.context.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 10;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.25;

    this.master = this.context.createGain();
    // Stay digitally silent until AudioSessionCoordinator grants this page the
    // foreground lease. This also covers browsers that allow autoplay.
    this.master.gain.value = 0;
    this.master.connect(compressor).connect(this.context.destination);

    this.commsGain = this.context.createGain();
    this.commsGain.gain.value = 0.72;
    const commsHighpass = this.context.createBiquadFilter();
    commsHighpass.type = "highpass";
    commsHighpass.frequency.value = 170;
    commsHighpass.Q.value = 0.6;
    const commsBody = this.context.createBiquadFilter();
    commsBody.type = "peaking";
    commsBody.frequency.value = 360;
    commsBody.Q.value = 0.86;
    commsBody.gain.value = 3.6;
    const commsLowpass = this.context.createBiquadFilter();
    commsLowpass.type = "lowpass";
    commsLowpass.frequency.value = 3_300;
    commsLowpass.Q.value = 0.72;
    const commsCompressor = this.context.createDynamicsCompressor();
    commsCompressor.threshold.value = -24;
    commsCompressor.knee.value = 8;
    commsCompressor.ratio.value = 6;
    commsCompressor.attack.value = 0.004;
    commsCompressor.release.value = 0.16;
    this.commsGain
      .connect(commsHighpass)
      .connect(commsBody)
      .connect(commsLowpass)
      .connect(commsCompressor)
      .connect(this.master);

    this.sonarBus = this.context.createGain();
    const sonarFilter = this.context.createBiquadFilter();
    sonarFilter.type = "lowpass";
    sonarFilter.frequency.value = 1_250;
    sonarFilter.Q.value = 0.7;
    this.sonarBus.gain.value = 0.45;
    this.sonarBus.connect(sonarFilter).connect(this.master);
    this.sonarContactInput = this.context.createStereoPanner();
    this.sonarContactInput.pan.value = 0;
    this.sonarContactInput.connect(this.sonarBus);

    this.scoreGain = this.context.createGain();
    this.scoreGain.gain.value = 0;
    const scoreHighpass = this.context.createBiquadFilter();
    scoreHighpass.type = "highpass";
    scoreHighpass.frequency.value = 58;
    scoreHighpass.Q.value = 0.45;
    this.scoreGain.connect(scoreHighpass).connect(this.master);

    // The diegetic storm is deliberately isolated from sonar/comms. Crossing
    // the moving waterline only closes this bus, preserving the accepted A/B/C
    // contact identities and the internal submarine soundscape below it.
    const initialSurfaceMix = cameraMediumMixTargets(1);
    this.surfaceStormGain = this.context.createGain();
    this.surfaceStormGain.gain.value = initialSurfaceMix.stormGain;
    this.surfaceStormFilter = this.context.createBiquadFilter();
    this.surfaceStormFilter.type = "lowpass";
    this.surfaceStormFilter.frequency.value = initialSurfaceMix.stormLowpassHz;
    this.surfaceStormFilter.Q.value = initialSurfaceMix.stormFilterQ;
    this.surfaceStormFilter.connect(this.surfaceStormGain).connect(this.master);

    this.ownShipDuckGain = this.context.createGain();
    this.ownShipDuckGain.gain.value = 1;
    this.ownShipDuckGain.connect(this.master);
    this.hullStress = new HullStressAudio(this.context, this.ownShipDuckGain);

    this.machineryGain = this.context.createGain();
    this.machineryGain.gain.value = 0.04;
    const machineryFilter = this.context.createBiquadFilter();
    machineryFilter.type = "lowpass";
    machineryFilter.frequency.value = 170;
    this.machineryGain.connect(machineryFilter).connect(this.ownShipDuckGain);

    this.machineryOscillator = this.context.createOscillator();
    this.machineryOscillator.type = "sine";
    this.machineryOscillator.frequency.value = 28;
    this.machineryOscillator.connect(this.machineryGain);
    this.machineryOscillator.start();

    this.machineryOvertone = this.context.createOscillator();
    this.machineryOvertone.type = "triangle";
    this.machineryOvertone.frequency.value = 47;
    const overtoneGain = this.context.createGain();
    overtoneGain.gain.value = 0.17;
    this.machineryOvertone.connect(overtoneGain).connect(this.machineryGain);
    this.machineryOvertone.start();

    this.flowGain = this.context.createGain();
    this.flowGain.gain.value = 0.015;
    const flowFilter = this.context.createBiquadFilter();
    flowFilter.type = "bandpass";
    flowFilter.frequency.value = 420;
    flowFilter.Q.value = 0.38;
    this.flowGain.connect(flowFilter).connect(this.ownShipDuckGain);
    this.flowSource = this.context.createBufferSource();
    this.flowSource.buffer = createNoiseBuffer(this.context, 2.7);
    this.flowSource.loop = true;
    this.flowSource.connect(this.flowGain);
    this.flowSource.start();
  }

  public async resume(): Promise<void> {
    this.assertUsable();
    if (!this.sessionActive) {
      return;
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
  }

  public setSessionActive(active: boolean): void {
    if (this.disposed || this.sessionActive === active) {
      return;
    }
    this.sessionActive = active;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    if (!active) {
      // Ownership loss must be immediate: two AKULA instances must never mix.
      this.master.gain.setValueAtTime(0, now);
      return;
    }
    this.master.gain.setValueAtTime(0, now);
    this.master.gain.linearRampToValueAtTime(MASTER_GAIN, now + 0.025);
  }

  public get audioSessionActive(): boolean {
    return this.sessionActive;
  }

  public get outputGain(): number {
    return this.master.gain.value;
  }

  public get soundtrackPlaying(): boolean {
    return this.scoreSource !== undefined;
  }

  public get soundtrackGain(): number {
    return this.scoreGain.gain.value;
  }

  public get surfaceEnvironmentSnapshot(): SurfaceEnvironmentSnapshot {
    return this.surfaceEnvironmentSnapshotValue;
  }

  public get sonarContactReportsScheduled(): number {
    return this.sonarContactReportCount;
  }

  public get ownShipNoiseGains(): OwnShipNoiseGains {
    const duck = this.ownShipDuckGain.gain.value;
    return {
      machinery: this.machineryGain.gain.value * duck,
      flow: this.flowGain.gain.value * duck,
    };
  }

  public get hullStressSnapshot(): HullStressSnapshot {
    return this.hullStress.snapshot;
  }

  public async prepareSoundtrack(): Promise<void> {
    this.assertUsable();
    await this.loadScoreBuffer();
  }

  public async prepareSonarist(): Promise<void> {
    this.assertUsable();
    if (this.spokenCommsEnabled) {
      await this.loadCommsBuffers();
    }
  }

  public async prepareHullStress(): Promise<void> {
    this.assertUsable();
    await this.hullStress.prepare();
  }

  public async prepareSurfaceEnvironment(): Promise<void> {
    this.assertUsable();
    await this.loadSurfaceStormBuffer();
    this.surfaceEnvironmentSnapshotValue = {
      ...this.surfaceEnvironmentSnapshotValue,
      loaded: true,
    };
  }

  public startSoundtrack(): Promise<void> {
    this.assertUsable();
    if (this.scoreSource !== undefined) {
      return Promise.resolve();
    }
    this.scoreStartPromise ??= this.beginSoundtrack();
    return this.scoreStartPromise;
  }

  public startSurfaceEnvironment(): Promise<void> {
    this.assertUsable();
    if (this.surfaceStormSource !== undefined) {
      return Promise.resolve();
    }
    this.surfaceStormStartPromise ??= this.beginSurfaceEnvironment();
    return this.surfaceStormStartPromise;
  }

  /**
   * Opens the real storm recording in air and collapses it to a near-silent,
   * low-frequency pressure trace below the local wave surface.
   */
  public setCameraMedium(underwaterAmount: number): void {
    if (this.disposed) {
      return;
    }
    const previousAirExposure =
      this.surfaceEnvironmentSnapshotValue.airExposure;
    const targets = cameraMediumMixTargets(underwaterAmount);
    const emerging = targets.airExposure > previousAirExposure;
    const now = this.context.currentTime;

    this.surfaceStormGain.gain.setTargetAtTime(
      targets.stormGain,
      now,
      emerging ? 0.025 : 0.048,
    );
    this.surfaceStormFilter.frequency.setTargetAtTime(
      targets.stormLowpassHz,
      now,
      emerging ? 0.018 : 0.04,
    );
    this.surfaceStormFilter.Q.setTargetAtTime(targets.stormFilterQ, now, 0.035);
    this.surfaceEnvironmentSnapshotValue = {
      ...targets,
      loaded: this.surfaceStormBuffer !== undefined,
      playing: this.surfaceStormSource !== undefined,
      underwaterAmount: clamp(underwaterAmount, 0, 1),
    };
  }

  public setMotion(
    speedMetersPerSecond: number,
    rudder: number,
    depthRate: number,
    throttle: number,
    turnRateDegreesPerSecond = 0,
  ): void {
    if (this.disposed) {
      return;
    }
    const now = this.context.currentTime;
    const speed = clamp(Math.abs(speedMetersPerSecond) / 15.8, 0, 1);
    const noise = ownShipNoiseGains(speedMetersPerSecond, rudder, throttle);
    if (isPropulsionStopped(throttle)) {
      // STOP is intentionally absolute: cancel any previous ramp and make the
      // two continuous own-ship sources digitally silent immediately.
      this.machineryGain.gain.cancelScheduledValues(now);
      this.flowGain.gain.cancelScheduledValues(now);
      this.machineryGain.gain.setValueAtTime(0, now);
      this.flowGain.gain.setValueAtTime(0, now);
    } else {
      this.machineryGain.gain.setTargetAtTime(noise.machinery, now, 0.18);
      this.flowGain.gain.setTargetAtTime(noise.flow, now, 0.16);
    }
    this.machineryOscillator.frequency.setTargetAtTime(
      27 + speed * 9 + Math.abs(depthRate) * 0.7,
      now,
      0.2,
    );
    this.machineryOvertone.frequency.setTargetAtTime(46 + speed * 15, now, 0.2);
    this.hullStress.update(
      {
        depthRateMetersPerSecond: depthRate,
        horizontalSpeedMetersPerSecond: speedMetersPerSecond,
        turnRateDegreesPerSecond,
      },
      this.sessionActive,
    );
  }

  public setSonarQuality(signalQuality: number, listening: boolean): void {
    if (this.disposed) {
      return;
    }
    const now = this.context.currentTime;
    const mix = contactMixTargets(signalQuality, listening);
    this.sonarBus.gain.setTargetAtTime(
      mix.contact,
      now,
      listening ? 0.035 : 0.12,
    );
    this.ownShipDuckGain.gain.setTargetAtTime(
      mix.ownShip,
      now,
      listening ? 0.03 : 0.45,
    );
    this.scoreTargetGain = mix.soundtrack;
    if (this.scoreSource !== undefined) {
      this.scoreGain.gain.setTargetAtTime(
        this.scoreTargetGain,
        now,
        listening ? 0.04 : 0.65,
      );
    }
  }

  /** Headphone direction follows camera-relative bearing without retuning A/B/C. */
  public setSonarBearing(cameraRelativeBearingRad: number): void {
    if (this.disposed) {
      return;
    }
    const pan = clamp(Math.sin(cameraRelativeBearingRad) * 0.88, -0.88, 0.88);
    this.sonarContactInput.pan.setTargetAtTime(
      pan,
      this.context.currentTime,
      0.045,
    );
  }

  public async reportSonarContact(
    worldBearingRadians: number,
    contactNumber = 1,
  ): Promise<void> {
    if (
      !this.spokenCommsEnabled ||
      this.disposed ||
      this.context.state === "closed"
    ) {
      return;
    }

    try {
      const buffers = await this.loadCommsBuffers();
      if (this.disposed) {
        return;
      }

      const bearing = formatCircularBearing(worldBearingRadians);
      const reportVariant = sonarContactReportVariant(
        this.sonarContactReportCount,
      );
      const clipNames: CommsClipName[] = [
        reportVariant === "full" ? "contact-first" : "contact-repeat",
        ...Array.from(
          bearing,
          (digit) => `digit-${digit}-mid` as CommsClipName,
        ),
        ...(contactNumber === 1 ? (["target-one"] as const) : []),
      ];
      let startTime = this.context.currentTime + 0.04;
      for (const clipName of clipNames) {
        const buffer = buffers.get(clipName);
        if (buffer === undefined) {
          throw new Error(`Missing decoded communications clip: ${clipName}`);
        }
        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.connect(this.commsGain);
        this.activeCommsSources.add(source);
        source.addEventListener(
          "ended",
          () => {
            source.disconnect();
            this.activeCommsSources.delete(source);
          },
          { once: true },
        );
        source.start(startTime);
        startTime +=
          buffer.duration +
          (clipName === "contact-first" || clipName === "contact-repeat"
            ? 0.12
            : clipName === "target-one"
              ? 0
              : 0.1);
      }
      this.sonarContactReportCount += 1;
    } catch (error) {
      console.warn("AKULA communications report could not be played.", error);
    }
  }

  public ping(): void {
    if (this.disposed || this.context.state !== "running") {
      return;
    }
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const delay = this.context.createDelay(1.2);
    const echoGain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(790, now);
    oscillator.frequency.exponentialRampToValueAtTime(515, now + 0.72);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.28, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
    delay.delayTime.value = 0.62;
    echoGain.gain.value = 0.17;
    oscillator.connect(gain).connect(this.master);
    gain.connect(delay).connect(echoGain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 1.55);
    oscillator.addEventListener(
      "ended",
      () => {
        oscillator.disconnect();
        gain.disconnect();
        delay.disconnect();
        echoGain.disconnect();
      },
      { once: true },
    );
  }

  public ballastBurst(): void {
    if (this.disposed || this.context.state !== "running") {
      return;
    }
    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = createNoiseBuffer(this.context, 1.35);
    filter.type = "bandpass";
    filter.frequency.value = 310;
    filter.Q.value = 0.48;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.2, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + 1.2);
    source.addEventListener(
      "ended",
      () => {
        source.disconnect();
        filter.disconnect();
        gain.disconnect();
      },
      { once: true },
    );
  }

  public impact(): void {
    if (this.disposed || this.context.state !== "running") {
      return;
    }
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(56, now);
    oscillator.frequency.exponentialRampToValueAtTime(22, now + 0.5);
    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.62);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.65);
    oscillator.addEventListener(
      "ended",
      () => {
        oscillator.disconnect();
        gain.disconnect();
      },
      { once: true },
    );
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.machineryOscillator.stop();
    this.machineryOvertone.stop();
    this.flowSource.stop();
    this.hullStress.dispose();
    this.surfaceStormSource?.stop();
    this.surfaceStormSource?.disconnect();
    this.surfaceStormSource = undefined;
    this.scoreSource?.stop();
    this.scoreSource?.disconnect();
    this.scoreSource = undefined;
    for (const source of this.activeCommsSources) {
      source.stop();
      source.disconnect();
    }
    this.activeCommsSources.clear();
    this.machineryOscillator.disconnect();
    this.machineryOvertone.disconnect();
    this.flowSource.disconnect();
    this.machineryGain.disconnect();
    this.flowGain.disconnect();
    this.ownShipDuckGain.disconnect();
    this.sonarContactInput.disconnect();
    this.sonarBus.disconnect();
    this.scoreGain.disconnect();
    this.surfaceStormFilter.disconnect();
    this.surfaceStormGain.disconnect();
    this.commsGain.disconnect();
    this.master.disconnect();
    void this.context.close();
  }

  private loadCommsBuffers(): Promise<ReadonlyMap<CommsClipName, AudioBuffer>> {
    if (this.commsBuffers !== undefined) {
      return Promise.resolve(this.commsBuffers);
    }
    if (this.commsLoadPromise !== undefined) {
      return this.commsLoadPromise;
    }

    this.commsLoadPromise = Promise.all(
      COMMS_CLIP_NAMES.map(async (clipName) => {
        const assetPath = `${import.meta.env.BASE_URL}${RUSSIAN_COMMS_ASSET_ROOT}/${clipName}.m4a`;
        const response = await fetch(assetPath);
        if (!response.ok) {
          throw new Error(
            `Unable to load ${clipName}: HTTP ${String(response.status)}`,
          );
        }
        const encodedAudio = await response.arrayBuffer();
        const buffer = await this.context.decodeAudioData(encodedAudio);
        return [clipName, buffer] as const;
      }),
    ).then((entries) => {
      const buffers = new Map<CommsClipName, AudioBuffer>(entries);
      this.commsBuffers = buffers;
      return buffers;
    });
    return this.commsLoadPromise;
  }

  private async beginSoundtrack(): Promise<void> {
    const buffer = await this.loadScoreBuffer();
    if (this.disposed || this.context.state === "closed") {
      return;
    }

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(this.scoreGain);
    this.scoreSource = source;

    const startTime = this.context.currentTime + 0.04;
    this.scoreGain.gain.cancelScheduledValues(startTime);
    this.scoreGain.gain.setValueAtTime(0.0001, startTime);
    this.scoreGain.gain.setTargetAtTime(this.scoreTargetGain, startTime, 0.9);
    source.start(startTime);
  }

  private async beginSurfaceEnvironment(): Promise<void> {
    const buffer = await this.loadSurfaceStormBuffer();
    if (this.disposed || this.context.state === "closed") {
      return;
    }

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(this.surfaceStormFilter);
    this.surfaceStormSource = source;
    this.surfaceEnvironmentSnapshotValue = {
      ...this.surfaceEnvironmentSnapshotValue,
      loaded: true,
      playing: true,
    };

    // Avoid always entering on the recording's opening transient. The source
    // is over three minutes long, so its loop boundary remains out of the
    // normal surface inspection path.
    const startOffsetSeconds = buffer.duration > 24 ? 11.3 : 0;
    source.start(this.context.currentTime + 0.04, startOffsetSeconds);
  }

  private loadScoreBuffer(): Promise<AudioBuffer> {
    if (this.scoreBuffer !== undefined) {
      return Promise.resolve(this.scoreBuffer);
    }
    if (this.scoreLoadPromise !== undefined) {
      return this.scoreLoadPromise;
    }

    const assetPath = `${import.meta.env.BASE_URL}${SCORE_ASSET_PATH}`;
    this.scoreLoadPromise = fetch(assetPath)
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            `Unable to load soundtrack: HTTP ${String(response.status)}`,
          );
        }
        return response.arrayBuffer();
      })
      .then((encodedAudio) => this.context.decodeAudioData(encodedAudio))
      .then((buffer) => {
        this.scoreBuffer = buffer;
        return buffer;
      });
    return this.scoreLoadPromise;
  }

  private loadSurfaceStormBuffer(): Promise<AudioBuffer> {
    if (this.surfaceStormBuffer !== undefined) {
      return Promise.resolve(this.surfaceStormBuffer);
    }
    if (this.surfaceStormLoadPromise !== undefined) {
      return this.surfaceStormLoadPromise;
    }

    const assetPath = `${import.meta.env.BASE_URL}${SURFACE_STORM_ASSET_PATH}`;
    this.surfaceStormLoadPromise = fetch(assetPath)
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            `Unable to load surface storm: HTTP ${String(response.status)}`,
          );
        }
        return response.arrayBuffer();
      })
      .then((encodedAudio) => this.context.decodeAudioData(encodedAudio))
      .then((buffer) => {
        this.surfaceStormBuffer = buffer;
        return buffer;
      });
    return this.surfaceStormLoadPromise;
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error("The game audio system has been disposed.");
    }
  }
}

export function ownShipNoiseGains(
  speedMetersPerSecond: number,
  rudder: number,
  throttle: number,
): OwnShipNoiseGains {
  if (isPropulsionStopped(throttle)) {
    return { machinery: 0, flow: 0 };
  }
  const speed = clamp(Math.abs(speedMetersPerSecond) / 15.8, 0, 1);
  return {
    machinery: 0.035 + speed * 0.095,
    flow: 0.012 + speed * speed * 0.16 + Math.abs(rudder) * 0.025,
  };
}

export function contactMixTargets(
  signalQuality: number,
  listening: boolean,
): ContactMixTargets {
  const quality = clamp(signalQuality, 0, 1);
  if (!listening || quality < CONTACT_AUDIO_MINIMUM_SIGNAL_QUALITY) {
    return {
      contact: 0,
      soundtrack: SCORE_GAIN.passiveArrayMuted,
      ownShip: 1,
    };
  }
  const audibleProgress = contactSignalProgress(
    quality,
    CONTACT_AUDIO_MINIMUM_SIGNAL_QUALITY,
    CONTACT_RING_MINIMUM_SIGNAL_QUALITY,
  );
  const audioOnlyProgress = contactSignalProgress(
    quality,
    CONTACT_AUDIO_MINIMUM_SIGNAL_QUALITY,
    CONTACT_HAPTIC_MINIMUM_SIGNAL_QUALITY,
  );
  const maskingClearance = contactSignalProgress(
    quality,
    CONTACT_HAPTIC_MINIMUM_SIGNAL_QUALITY,
    CONTACT_RING_MINIMUM_SIGNAL_QUALITY,
  );
  const audioOnlySoundtrackGain = lerp(
    SCORE_GAIN.firstContactHint,
    0.104,
    audioOnlyProgress,
  );
  return {
    // The first directional return must remain faint instead of arriving at
    // nearly full gain. The 0.58 ceiling leaves about 12.6 dB nominal headroom
    // after the contact-output and master gains, before both compressors catch
    // coincident A/B/C peaks. Actual SPL still belongs to the listener's device.
    contact: Math.min(
      CONTACT_COMFORT_MAXIMUM_MIX_GAIN,
      lerp(0.06, CONTACT_COMFORT_MAXIMUM_MIX_GAIN, audibleProgress),
    ),
    // The score gives the ear a roughly 1 dB hint as soon as the propeller is
    // audible. Own-ship masking remains intact until the later haptic stage.
    soundtrack: lerp(
      audioOnlySoundtrackGain,
      SCORE_GAIN.passiveArrayLive,
      maskingClearance,
    ),
    ownShip: lerp(1, CONTACT_OWN_SHIP_DUCK_GAIN, maskingClearance),
  };
}

/**
 * A deliberately cinematic waterline transfer curve: broad and masking in
 * air, almost silent and pressure-only below the surface. It affects only the
 * diegetic storm bus.
 */
export function cameraMediumMixTargets(
  underwaterAmount: number,
): CameraMediumMixTargets {
  const underwater = clamp(underwaterAmount, 0, 1);
  const airExposure = smootherstep(0.12, 0.82, 1 - underwater);
  const spectralOpening = Math.pow(airExposure, 0.72);
  return {
    airExposure,
    stormGain: lerp(0.0025, 0.43, Math.pow(airExposure, 1.28)),
    stormLowpassHz: Math.exp(
      lerp(Math.log(145), Math.log(15_500), spectralOpening),
    ),
    stormFilterQ: lerp(1.08, 0.68, airExposure),
  };
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function smootherstep(edge0: number, edge1: number, value: number): number {
  const normalized = clamp(
    (value - edge0) / Math.max(edge1 - edge0, Number.EPSILON),
    0,
    1,
  );
  return (
    normalized *
    normalized *
    normalized *
    (normalized * (normalized * 6 - 15) + 10)
  );
}

export type SonarContactReportVariant = "full" | "short";

/** The first call is complete; later calls are short four times out of five. */
export function sonarContactReportVariant(
  reportIndex: number,
): SonarContactReportVariant {
  if (!Number.isSafeInteger(reportIndex) || reportIndex <= 0) {
    return "full";
  }
  return reportIndex % 5 === 0 ? "full" : "short";
}

function createNoiseBuffer(
  context: AudioContext,
  duration: number,
): AudioBuffer {
  const frameCount = Math.ceil(context.sampleRate * duration);
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const channel = buffer.getChannelData(0);
  let brown = 0;
  for (let index = 0; index < frameCount; index += 1) {
    const white = Math.random() * 2 - 1;
    brown = brown * 0.965 + white * 0.035;
    channel[index] = brown * 3.1;
  }
  return buffer;
}
