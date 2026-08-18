import { clamp } from "./WorldGeometry";

const HULL_STRESS_ASSET_ROOT = "assets/audio/hull-stress/v1";
const DESCENT_START_METERS_PER_SECOND = 1.35;
const DESCENT_FULL_METERS_PER_SECOND = 5.2;
const MANEUVER_START_METERS_PER_SECOND_SQUARED = 0.34;
const MANEUVER_FULL_METERS_PER_SECOND_SQUARED = 1.35;

export type HullStressKind = "descent" | "maneuver";

export interface HullStressMotion {
  /** Positive values are actual downward motion, not commanded dive-plane input. */
  readonly depthRateMetersPerSecond: number;
  readonly horizontalSpeedMetersPerSecond: number;
  /** Actual heading change measured by the simulation, not rudder input. */
  readonly turnRateDegreesPerSecond: number;
}

export interface HullStressLevels {
  readonly descentIntensity: number;
  readonly maneuverIntensity: number;
  /** Horizontal speed multiplied by yaw rate: a centripetal-load proxy. */
  readonly turnLoadMetersPerSecondSquared: number;
}

export interface HullStressSnapshot extends HullStressLevels {
  readonly buffersReady: boolean;
  readonly activeVoices: number;
  readonly eventCount: number;
  readonly lastEventKind: HullStressKind | null;
  readonly lastClipIndex: number | null;
  readonly lastEventGain: number;
}

export interface HullStressEvent {
  readonly kind: HullStressKind;
  readonly clipIndex: number;
  readonly file: string;
  readonly durationSeconds: number;
  readonly intensity: number;
  readonly gain: number;
  readonly playbackRate: number;
  readonly pan: number;
}

interface HullStressClip {
  readonly file: string;
  readonly durationSeconds: number;
}

const CLIPS: Readonly<Record<HullStressKind, readonly HullStressClip[]>> =
  Object.freeze({
    descent: Object.freeze([
      clip("descent/pressure-01.wav", 2.4),
      clip("descent/pressure-02.wav", 2.7),
      clip("descent/pressure-03.wav", 2.8),
      clip("descent/pressure-04.wav", 2.6),
      clip("descent/pressure-05.wav", 2.75),
      clip("descent/pressure-06.wav", 2.8),
      clip("descent/pressure-07.wav", 2.9),
      clip("descent/pressure-08.wav", 2.25),
    ]),
    maneuver: Object.freeze([
      clip("maneuver/torsion-01.wav", 0.95),
      clip("maneuver/torsion-02.wav", 1.05),
      clip("maneuver/torsion-03.wav", 0.95),
      clip("maneuver/torsion-04.wav", 1.05),
      clip("maneuver/torsion-05.wav", 1.1),
      clip("maneuver/torsion-06.wav", 1),
      clip("maneuver/torsion-07.wav", 1.15),
      clip("maneuver/torsion-08.wav", 1.1),
      clip("maneuver/torsion-09.wav", 1.05),
      clip("maneuver/torsion-10.wav", 1.1),
      clip("maneuver/torsion-11.wav", 1.25),
    ]),
  });

type RandomSource = () => number;

/**
 * Stateful but Web-Audio-independent event selector. Events become closer and
 * more present as real motion load increases, while remaining finite and
 * irregular. A shared voice window prevents a constant layer of overlapping
 * creaks.
 */
export class HullStressScheduler {
  private levels: HullStressLevels = {
    descentIntensity: 0,
    maneuverIntensity: 0,
    turnLoadMetersPerSecondSquared: 0,
  };
  private previousDescentIntensity = 0;
  private previousManeuverIntensity = 0;
  private nextDescentSeconds = Number.POSITIVE_INFINITY;
  private nextManeuverSeconds = Number.POSITIVE_INFINITY;
  private sharedAvailableSeconds = 0;
  private lastDescentClip = -1;
  private lastManeuverClip = -1;
  private eventCount = 0;
  private lastEventKind: HullStressKind | null = null;
  private lastClipIndex: number | null = null;
  private lastEventGain = 0;

  public constructor(private readonly random: RandomSource = Math.random) {}

  public get snapshot(): Omit<
    HullStressSnapshot,
    "buffersReady" | "activeVoices"
  > {
    return {
      ...this.levels,
      eventCount: this.eventCount,
      lastEventKind: this.lastEventKind,
      lastClipIndex: this.lastClipIndex,
      lastEventGain: this.lastEventGain,
    };
  }

  public update(
    nowSeconds: number,
    motion: HullStressMotion,
    allowEvent = true,
  ): HullStressEvent | null {
    this.levels = hullStressLevels(motion);
    this.nextDescentSeconds = this.updateDueTime(
      "descent",
      nowSeconds,
      this.levels.descentIntensity,
      this.previousDescentIntensity,
      this.nextDescentSeconds,
    );
    this.nextManeuverSeconds = this.updateDueTime(
      "maneuver",
      nowSeconds,
      this.levels.maneuverIntensity,
      this.previousManeuverIntensity,
      this.nextManeuverSeconds,
    );
    this.previousDescentIntensity = this.levels.descentIntensity;
    this.previousManeuverIntensity = this.levels.maneuverIntensity;

    if (!allowEvent || nowSeconds < this.sharedAvailableSeconds) {
      return null;
    }

    const descentDue =
      this.levels.descentIntensity > 0 && nowSeconds >= this.nextDescentSeconds;
    const maneuverDue =
      this.levels.maneuverIntensity > 0 &&
      nowSeconds >= this.nextManeuverSeconds;
    if (!descentDue && !maneuverDue) {
      return null;
    }

    const kind = this.chooseDueKind(nowSeconds, descentDue, maneuverDue);
    const intensity =
      kind === "descent"
        ? this.levels.descentIntensity
        : this.levels.maneuverIntensity;
    const clips = CLIPS[kind];
    const previousClip =
      kind === "descent" ? this.lastDescentClip : this.lastManeuverClip;
    const clipIndex = chooseNonRepeatingIndex(
      clips.length,
      previousClip,
      this.random,
    );
    const selectedClip = clips[clipIndex];
    if (selectedClip === undefined) {
      return null;
    }
    const playbackRate =
      kind === "descent"
        ? randomBetween(0.94, 1.02, this.random)
        : randomBetween(0.97, 1.07, this.random);
    const event: HullStressEvent = {
      kind,
      clipIndex,
      file: selectedClip.file,
      durationSeconds: selectedClip.durationSeconds,
      intensity,
      gain:
        kind === "descent"
          ? 0.052 + intensity * 0.118
          : 0.048 + intensity * 0.112,
      playbackRate,
      pan:
        kind === "descent"
          ? randomBetween(-0.16, 0.16, this.random)
          : randomBetween(-0.24, 0.24, this.random),
    };

    if (kind === "descent") {
      this.lastDescentClip = clipIndex;
      this.nextDescentSeconds =
        nowSeconds + this.cadenceSeconds(kind, intensity);
    } else {
      this.lastManeuverClip = clipIndex;
      this.nextManeuverSeconds =
        nowSeconds + this.cadenceSeconds(kind, intensity);
    }
    this.sharedAvailableSeconds =
      nowSeconds +
      selectedClip.durationSeconds / playbackRate +
      randomBetween(0.32, 0.68, this.random);
    this.eventCount += 1;
    this.lastEventKind = kind;
    this.lastClipIndex = clipIndex;
    this.lastEventGain = event.gain;
    return event;
  }

  private updateDueTime(
    kind: HullStressKind,
    nowSeconds: number,
    intensity: number,
    previousIntensity: number,
    currentDueSeconds: number,
  ): number {
    if (intensity <= 0) {
      return Number.POSITIVE_INFINITY;
    }
    const earlyDueSeconds =
      nowSeconds + this.firstEventDelaySeconds(kind, intensity);
    if (previousIntensity <= 0 || !Number.isFinite(currentDueSeconds)) {
      return earlyDueSeconds;
    }
    // A sharply increasing load should be heard promptly, without waiting out
    // a cadence chosen for a gentler maneuver several seconds earlier.
    if (intensity - previousIntensity >= 0.12) {
      return Math.min(currentDueSeconds, earlyDueSeconds);
    }
    return currentDueSeconds;
  }

  private chooseDueKind(
    nowSeconds: number,
    descentDue: boolean,
    maneuverDue: boolean,
  ): HullStressKind {
    if (!descentDue) {
      return "maneuver";
    }
    if (!maneuverDue) {
      return "descent";
    }
    const descentScore =
      this.levels.descentIntensity +
      Math.min(0.35, Math.max(0, nowSeconds - this.nextDescentSeconds) * 0.08);
    const maneuverScore =
      this.levels.maneuverIntensity +
      Math.min(0.35, Math.max(0, nowSeconds - this.nextManeuverSeconds) * 0.08);
    if (Math.abs(descentScore - maneuverScore) < 0.08) {
      return this.lastEventKind === "descent" ? "maneuver" : "descent";
    }
    return descentScore > maneuverScore ? "descent" : "maneuver";
  }

  private firstEventDelaySeconds(
    kind: HullStressKind,
    intensity: number,
  ): number {
    const gentleDelay = kind === "descent" ? 2.45 : 2.05;
    const hardDelay = kind === "descent" ? 0.52 : 0.42;
    return (
      interpolate(gentleDelay, hardDelay, intensity) *
      randomBetween(0.84, 1.18, this.random)
    );
  }

  private cadenceSeconds(kind: HullStressKind, intensity: number): number {
    const gentleCadence = kind === "descent" ? 10.2 : 8.3;
    const hardCadence = kind === "descent" ? 4.25 : 2.75;
    return (
      interpolate(gentleCadence, hardCadence, intensity) *
      randomBetween(0.82, 1.2, this.random)
    );
  }
}

export class HullStressAudio {
  private readonly scheduler: HullStressScheduler;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly activeSources = new Set<AudioBufferSourceNode>();
  private loadPromise: Promise<void> | undefined;
  private disposed = false;

  public constructor(
    private readonly context: AudioContext,
    private readonly destination: AudioNode,
    random: RandomSource = Math.random,
  ) {
    this.scheduler = new HullStressScheduler(random);
  }

  public get snapshot(): HullStressSnapshot {
    return {
      ...this.scheduler.snapshot,
      buffersReady: this.buffers.size === clipCount(),
      activeVoices: this.activeSources.size,
    };
  }

  public prepare(): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new Error("Hull-stress audio has been disposed."));
    }
    if (this.buffers.size === clipCount()) {
      return Promise.resolve();
    }
    this.loadPromise ??= Promise.all(
      (Object.keys(CLIPS) as HullStressKind[]).flatMap((kind) =>
        CLIPS[kind].map(async ({ file }) => {
          const assetPath = `${import.meta.env.BASE_URL}${HULL_STRESS_ASSET_ROOT}/${file}`;
          const response = await fetch(assetPath);
          if (!response.ok) {
            throw new Error(
              `Unable to load hull-stress clip ${file}: HTTP ${String(response.status)}`,
            );
          }
          const encodedAudio = await response.arrayBuffer();
          const buffer = await this.context.decodeAudioData(encodedAudio);
          return [file, buffer] as const;
        }),
      ),
    ).then((entries) => {
      if (this.disposed) {
        return;
      }
      for (const [file, buffer] of entries) {
        this.buffers.set(file, buffer);
      }
    });
    return this.loadPromise;
  }

  public update(motion: HullStressMotion, foregroundSession: boolean): void {
    if (this.disposed) {
      return;
    }
    const event = this.scheduler.update(
      this.context.currentTime,
      motion,
      foregroundSession &&
        this.context.state === "running" &&
        this.buffers.size === clipCount(),
    );
    if (event === null) {
      return;
    }
    const buffer = this.buffers.get(event.file);
    if (buffer === undefined) {
      return;
    }
    this.playEvent(buffer, event);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const source of this.activeSources) {
      source.stop();
      source.disconnect();
    }
    this.activeSources.clear();
    this.buffers.clear();
  }

  private playEvent(buffer: AudioBuffer, event: HullStressEvent): void {
    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    const panner = this.context.createStereoPanner();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = event.playbackRate;
    panner.pan.value = event.pan;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(
      event.gain,
      now + (event.kind === "descent" ? 0.065 : 0.035),
    );
    source.connect(panner).connect(gain).connect(this.destination);
    this.activeSources.add(source);
    source.addEventListener(
      "ended",
      () => {
        source.disconnect();
        panner.disconnect();
        gain.disconnect();
        this.activeSources.delete(source);
      },
      { once: true },
    );
    source.start(now);
  }
}

export function hullStressLevels(motion: HullStressMotion): HullStressLevels {
  const descentRate = Math.max(0, motion.depthRateMetersPerSecond);
  const turnRateRadiansPerSecond =
    (Math.abs(motion.turnRateDegreesPerSecond) * Math.PI) / 180;
  const turnLoadMetersPerSecondSquared =
    Math.abs(motion.horizontalSpeedMetersPerSecond) * turnRateRadiansPerSecond;
  return {
    descentIntensity: smoothstep(
      DESCENT_START_METERS_PER_SECOND,
      DESCENT_FULL_METERS_PER_SECOND,
      descentRate,
    ),
    maneuverIntensity: smoothstep(
      MANEUVER_START_METERS_PER_SECOND_SQUARED,
      MANEUVER_FULL_METERS_PER_SECOND_SQUARED,
      turnLoadMetersPerSecondSquared,
    ),
    turnLoadMetersPerSecondSquared,
  };
}

function clip(file: string, durationSeconds: number): HullStressClip {
  return Object.freeze({ file, durationSeconds });
}

function clipCount(): number {
  return CLIPS.descent.length + CLIPS.maneuver.length;
}

function smoothstep(start: number, end: number, value: number): number {
  const amount = clamp((value - start) / (end - start), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function interpolate(start: number, end: number, amount: number): number {
  return start + (end - start) * clamp(amount, 0, 1);
}

function randomBetween(
  minimum: number,
  maximum: number,
  random: RandomSource,
): number {
  return minimum + (maximum - minimum) * clamp(random(), 0, 1);
}

function chooseNonRepeatingIndex(
  count: number,
  previousIndex: number,
  random: RandomSource,
): number {
  if (count <= 1) {
    return 0;
  }
  if (previousIndex < 0 || previousIndex >= count) {
    return Math.min(count - 1, Math.floor(clamp(random(), 0, 1) * count));
  }
  const candidate = Math.min(
    count - 2,
    Math.floor(clamp(random(), 0, 1) * (count - 1)),
  );
  return candidate >= previousIndex ? candidate + 1 : candidate;
}
