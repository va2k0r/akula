import { validateAcousticSignature } from "../audio/signatureMath";
import type { AcousticCode } from "../audio/types";
import {
  assertSignalQuality,
  sampleAcousticSignatureVisual,
  type AcousticVisualSample,
} from "./signalVisualMath";

export interface AcousticSignatureScopeOptions {
  readonly signalQuality?: number;
  readonly historySeconds?: number;
  readonly samplesPerSecond?: number;
  /** Clears the canvas instead of painting a scope plate behind the trace. */
  readonly transparentBackground?: boolean;
  /** Native audio-clock time keeps the trace aligned with audible modulation. */
  readonly playbackTime?: () => number | undefined;
}

interface ScopePoint extends AcousticVisualSample {
  readonly sampleIndex: number;
}

const DEFAULT_SIGNATURE: AcousticCode = [1, 2, 4];
const DEFAULT_CYCLE_DURATION = 4.5;
const DEFAULT_SIGNAL_QUALITY = 1;
const DEFAULT_HISTORY_SECONDS = 4.8;
const DEFAULT_SAMPLES_PER_SECOND = 48;
const HISTOGRAM_VERTICAL_PADDING = 5;

export interface SymmetricHistogramBarBounds {
  readonly top: number;
  readonly bottom: number;
}

/**
 * New samples enter at the right edge. Adding another sample moves every
 * existing sample one slot to the left.
 */
export function scrollingHistogramX(
  pointIndex: number,
  pointCount: number,
  maximumPoints: number,
  width: number,
): number {
  const slotsFromRight = pointCount - pointIndex - 0.5;
  return width - (slotsFromRight / maximumPoints) * width;
}

/** Equal positive extent above and below the central time axis. */
export function symmetricHistogramBarBounds(
  level: number,
  height: number,
): SymmetricHistogramBarBounds {
  const center = height * 0.5;
  const halfHeight =
    clampUnit(level) * Math.max(0, center - HISTOGRAM_VERTICAL_PADDING);
  return Object.freeze({
    top: center - halfHeight,
    bottom: center + halfHeight,
  });
}

/** A short, right-to-left histogram of the constructive A+B+C envelope. */
export class AcousticSignatureScope {
  private readonly context: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;
  private readonly historySeconds: number;
  private readonly samplesPerSecond: number;
  private readonly transparentBackground: boolean;
  private readonly playbackTime: (() => number | undefined) | undefined;
  private readonly points: ScopePoint[] = [];
  private signature: AcousticCode = DEFAULT_SIGNATURE;
  private cycleDuration = DEFAULT_CYCLE_DURATION;
  private signalQuality: number;
  private cssWidth = 1;
  private cssHeight = 1;
  private playbackStartedAt = 0;
  private lastSampleIndex = -1;
  private animationFrame: number | undefined;
  private playing = false;
  private disposed = false;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    options: AcousticSignatureScopeOptions = {},
  ) {
    const context = canvas.getContext("2d", { alpha: true });
    if (context === null) {
      throw new Error("Canvas 2D is unavailable.");
    }

    this.context = context;
    this.signalQuality = options.signalQuality ?? DEFAULT_SIGNAL_QUALITY;
    assertSignalQuality(this.signalQuality);
    this.historySeconds = assertPositiveFinite(
      options.historySeconds ?? DEFAULT_HISTORY_SECONDS,
      "History duration",
    );
    this.samplesPerSecond = assertPositiveFinite(
      options.samplesPerSecond ?? DEFAULT_SAMPLES_PER_SECOND,
      "Sample rate",
    );
    this.transparentBackground = options.transparentBackground ?? false;
    this.playbackTime = options.playbackTime;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  public setSignature(code: AcousticCode): void {
    this.assertUsable();
    const validated = validateAcousticSignature(code);
    if (codesMatch(this.signature, validated)) {
      return;
    }

    this.signature = validated;
    this.clear();
  }

  public setCycleDuration(seconds: number): void {
    this.assertUsable();
    const duration = assertPositiveFinite(seconds, "Cycle duration");
    if (duration === this.cycleDuration) {
      return;
    }

    this.cycleDuration = duration;
    this.clear();
  }

  public setSignalQuality(signalQuality: number): void {
    this.assertUsable();
    assertSignalQuality(signalQuality);
    this.signalQuality = signalQuality;
  }

  public play(): void {
    this.assertUsable();
    if (this.playing) {
      return;
    }

    this.playing = true;
    this.points.length = 0;
    this.lastSampleIndex = -1;
    this.playbackStartedAt = performance.now();
    this.draw();
    this.animationFrame = requestAnimationFrame(this.tick);
  }

  public pause(): void {
    if (this.disposed || !this.playing) {
      return;
    }

    this.playing = false;
    if (this.animationFrame !== undefined) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = undefined;
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.pause();
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.points.length = 0;
    this.draw();
  }

  private readonly tick = (now: number): void => {
    if (!this.playing || this.disposed) {
      return;
    }

    const elapsedSeconds = Math.max(
      0,
      this.playbackTime?.() ?? (now - this.playbackStartedAt) / 1_000,
    );
    const targetSampleIndex = Math.floor(
      elapsedSeconds * this.samplesPerSecond,
    );
    let addedPoint = false;

    while (this.lastSampleIndex < targetSampleIndex) {
      this.lastSampleIndex += 1;
      const sampleTime = this.lastSampleIndex / this.samplesPerSecond;
      const sample = sampleAcousticSignatureVisual(
        this.signature,
        this.cycleDuration,
        sampleTime,
        this.signalQuality,
        this.lastSampleIndex,
      );
      this.points.push({ ...sample, sampleIndex: this.lastSampleIndex });
      addedPoint = true;
    }

    const maximumPoints = Math.ceil(
      this.historySeconds * this.samplesPerSecond,
    );
    if (this.points.length > maximumPoints) {
      this.points.splice(0, this.points.length - maximumPoints);
    }
    if (addedPoint) {
      this.draw();
    }

    this.animationFrame = requestAnimationFrame(this.tick);
  };

  private resize(): void {
    const bounds = this.canvas.getBoundingClientRect();
    const pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
    this.cssWidth = Math.max(1, bounds.width);
    this.cssHeight = Math.max(1, bounds.height);
    const pixelWidth = Math.round(this.cssWidth * pixelRatio);
    const pixelHeight = Math.round(this.cssHeight * pixelRatio);

    if (
      this.canvas.width !== pixelWidth ||
      this.canvas.height !== pixelHeight
    ) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    this.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    this.draw();
  }

  private clear(): void {
    this.points.length = 0;
    this.lastSampleIndex = -1;
    if (this.playing) {
      this.playbackStartedAt = performance.now();
    }
    this.draw();
  }

  private draw(): void {
    const style = getComputedStyle(this.canvas);
    const background =
      style.getPropertyValue("--scope-background").trim() || "#0b1113";
    const signal = style.getPropertyValue("--scope-signal").trim() || "#b5cbc7";
    const { context, cssWidth: width, cssHeight: height } = this;

    context.globalAlpha = 1;
    if (this.transparentBackground) {
      context.clearRect(0, 0, width, height);
    } else {
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
    }

    const maximumPoints = Math.ceil(
      this.historySeconds * this.samplesPerSecond,
    );
    context.strokeStyle = signal;
    context.lineWidth = 1;
    context.globalAlpha = 0.2 + this.signalQuality * 0.16;
    context.beginPath();
    context.moveTo(0, height * 0.5 + 0.5);
    context.lineTo(width, height * 0.5 + 0.5);
    context.stroke();

    context.globalAlpha = 0.12 + this.signalQuality * 0.08;
    context.beginPath();
    context.moveTo(width - 0.5, 0);
    context.lineTo(width - 0.5, height);
    context.stroke();

    if (this.points.length === 0) {
      context.globalAlpha = 1;
      return;
    }

    const slotWidth = width / maximumPoints;
    const barWidth = Math.max(0.75, slotWidth * 0.72);
    context.fillStyle = signal;

    for (let index = 0; index < this.points.length; index += 1) {
      const point = this.points[index];
      if (point === undefined || point.constructiveEnvelope <= 0.002) {
        continue;
      }

      const x = scrollingHistogramX(
        index,
        this.points.length,
        maximumPoints,
        width,
      );
      const bounds = symmetricHistogramBarBounds(
        point.constructiveEnvelope,
        height,
      );
      context.globalAlpha = 0.18 + point.traceStrength * 0.78;
      context.fillRect(
        x - barWidth * 0.5,
        bounds.top,
        barWidth,
        bounds.bottom - bounds.top,
      );
    }

    context.globalAlpha = 1;
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error("This AcousticSignatureScope has been disposed.");
    }
  }
}

function codesMatch(left: AcousticCode, right: AcousticCode): boolean {
  return left.every((value, index) => value === right[index]);
}

function assertPositiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number.`);
  }
  return value;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}
