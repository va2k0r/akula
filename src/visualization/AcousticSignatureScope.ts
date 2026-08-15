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

/** A short, scrolling trace of the inseparable combined modulation envelope. */
export class AcousticSignatureScope {
  private readonly context: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;
  private readonly historySeconds: number;
  private readonly samplesPerSecond: number;
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
    const context = canvas.getContext("2d", { alpha: false });
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
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    if (this.points.length < 2) {
      return;
    }

    const maximumPoints = Math.ceil(
      this.historySeconds * this.samplesPerSecond,
    );
    const horizontalOffset =
      width - (this.points.length / maximumPoints) * width;
    const lineWidth = 1.25 + (1 - this.signalQuality) * 2.2;
    context.strokeStyle = signal;
    context.lineWidth = lineWidth;
    context.lineCap = "round";
    context.lineJoin = "round";

    for (let index = 1; index < this.points.length; index += 1) {
      const previous = this.points[index - 1];
      const current = this.points[index];
      if (previous === undefined || current === undefined) {
        continue;
      }

      const previousX =
        horizontalOffset + ((index - 1) / maximumPoints) * width;
      const currentX = horizontalOffset + (index / maximumPoints) * width;
      const previousY = envelopeToY(previous.combinedEnvelope, height);
      const currentY = envelopeToY(current.combinedEnvelope, height);
      context.globalAlpha =
        0.22 + ((previous.traceStrength + current.traceStrength) / 2) * 0.7;
      context.beginPath();
      context.moveTo(previousX, previousY);
      context.lineTo(currentX, currentY);
      context.stroke();
    }

    context.globalAlpha = 1;
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error("This AcousticSignatureScope has been disposed.");
    }
  }
}

function envelopeToY(envelope: number, height: number): number {
  return height * (0.82 - envelope * 0.64);
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
