import {
  loadContactSoundBuffers,
  type ContactSoundProfile,
} from "../audio/contactSoundBank";
import { PROPELLER_PRESET } from "../audio/propellerPreset";
import type { AcousticCode } from "../audio/types";
import {
  contactAnalysisComponentIsActive,
  renderContactVolumeHistogram,
  sampleContactModulationTrace,
  type ContactAnalysisMode,
} from "../visualization/contactProfileAnalysis";

const HISTOGRAM_BIN_COUNT = 96;
const COMPONENT_COLORS = ["#dff0dc", "#d9c68b", "#84bec7"] as const;

export class ContactProfileAnalysisVisual {
  private readonly traceCanvas: HTMLCanvasElement;
  private readonly histogramCanvas: HTMLCanvasElement;
  private readonly modeLabel: HTMLOutputElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly histograms = new Map<ContactAnalysisMode, Float32Array>();
  private mode: ContactAnalysisMode = "mix";
  private playbackTime: (() => number | undefined) | undefined;
  private animationFrame: number | undefined;
  private disposed = false;

  public constructor(
    private readonly root: HTMLElement,
    private readonly context: BaseAudioContext,
    private readonly soundProfile: ContactSoundProfile,
    private readonly signature: AcousticCode,
    private readonly cycleDurationSeconds: number,
  ) {
    this.traceCanvas = requireElement(
      root,
      '[data-analysis-canvas="modulation"]',
    );
    this.histogramCanvas = requireElement(
      root,
      '[data-analysis-canvas="volume"]',
    );
    this.modeLabel = requireElement(root, "[data-analysis-mode]");
    this.resizeObserver = new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(root);
    this.draw();
  }

  public async prepare(): Promise<void> {
    const buffers = await loadContactSoundBuffers(
      this.context,
      this.soundProfile,
    );
    if (this.disposed) {
      return;
    }
    const samples = {
      sampleRate: this.context.sampleRate,
      components: [
        buffers[0].getChannelData(0),
        buffers[1].getChannelData(0),
        buffers[2].getChannelData(0),
      ],
    } as const;
    for (const mode of ["mix", "a", "b", "c"] as const) {
      this.histograms.set(
        mode,
        renderContactVolumeHistogram(
          samples,
          this.soundProfile,
          this.signature,
          this.cycleDurationSeconds,
          mode,
          HISTOGRAM_BIN_COUNT,
        ),
      );
    }
    this.draw();
  }

  public play(
    mode: ContactAnalysisMode,
    playbackTime: () => number | undefined,
  ): void {
    this.mode = mode;
    this.playbackTime = playbackTime;
    this.root.dataset["mode"] = mode;
    this.root.classList.add("active");
    this.modeLabel.value = `${modeDisplayName(mode)} · RMS / ${this.cycleDurationSeconds.toFixed(1)} S`;
    this.cancelAnimation();
    this.tick();
  }

  public stop(): void {
    this.mode = "mix";
    this.playbackTime = undefined;
    this.root.dataset["mode"] = "mix";
    this.root.classList.remove("active");
    this.modeLabel.value = `MIX · RMS / ${this.cycleDurationSeconds.toFixed(1)} S`;
    this.cancelAnimation();
    this.draw();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cancelAnimation();
    this.resizeObserver.disconnect();
    this.histograms.clear();
  }

  private readonly tick = (): void => {
    if (this.disposed || this.playbackTime === undefined) {
      return;
    }
    this.draw();
    this.animationFrame = requestAnimationFrame(this.tick);
  };

  private draw(): void {
    if (this.disposed) {
      return;
    }
    const playbackSeconds = this.playbackTime?.();
    const playbackPhase =
      playbackSeconds === undefined
        ? undefined
        : (playbackSeconds % this.cycleDurationSeconds) /
          this.cycleDurationSeconds;
    this.drawModulationTrace(playbackPhase);
    this.drawVolumeHistogram(playbackPhase);
  }

  private drawModulationTrace(playbackPhase: number | undefined): void {
    const { context, width, height } = prepareCanvas(this.traceCanvas);
    drawAnalysisGrid(context, width, height);
    const phaseOffsets = this.soundProfile.components.map((component) =>
      this.mode === "mix" ? 0 : component.phaseOffset,
    );
    const shapePowers = [
      PROPELLER_PRESET.modulation.componentA.pulseShapePower,
      PROPELLER_PRESET.modulation.componentB.pulseShapePower,
      PROPELLER_PRESET.modulation.componentC.pulseShapePower,
    ] as const;

    for (const componentIndex of [0, 1, 2] as const) {
      const repetitions = this.signature[componentIndex];
      const active = contactAnalysisComponentIsActive(
        this.mode,
        componentIndex,
      );
      context.beginPath();
      for (let pixel = 0; pixel <= Math.ceil(width); pixel += 1) {
        const cyclePhase = pixel / Math.max(1, width);
        const carrier = sampleContactModulationTrace(
          repetitions,
          cyclePhase,
          phaseOffsets[componentIndex] ?? 0,
        );
        const positiveEnvelope =
          ((carrier + 1) / 2) ** shapePowers[componentIndex];
        const y = height * (0.84 - positiveEnvelope * 0.68);
        if (pixel === 0) {
          context.moveTo(0, y);
        } else {
          context.lineTo(pixel, y);
        }
      }
      context.strokeStyle = COMPONENT_COLORS[componentIndex];
      context.lineWidth = 1.55 - componentIndex * 0.18;
      context.globalAlpha = active ? 0.88 : 0.09;
      context.stroke();
    }
    context.globalAlpha = 1;
    drawPlayhead(context, width, height, playbackPhase);
  }

  private drawVolumeHistogram(playbackPhase: number | undefined): void {
    const { context, width, height } = prepareCanvas(this.histogramCanvas);
    drawAnalysisGrid(context, width, height);
    const levels = this.histograms.get(this.mode);
    if (levels === undefined) {
      context.fillStyle = "rgba(204, 226, 207, 0.34)";
      context.font = '7px "SFMono-Regular", Consolas, monospace';
      context.letterSpacing = "0.12em";
      context.fillText("DECODING RECORDED WAVS", 8, height * 0.56);
      return;
    }

    const slotWidth = width / levels.length;
    const barWidth = Math.max(1, slotWidth - 0.7);
    const activeBin =
      playbackPhase === undefined
        ? -1
        : Math.min(
            levels.length - 1,
            Math.floor(playbackPhase * levels.length),
          );
    for (let bin = 0; bin < levels.length; bin += 1) {
      const level = levels[bin] ?? 0;
      const barHeight = Math.max(1, level * (height - 8));
      context.fillStyle =
        bin === activeBin
          ? "rgba(231, 246, 229, 0.96)"
          : "rgba(177, 215, 184, 0.58)";
      context.fillRect(
        bin * slotWidth,
        height - barHeight,
        barWidth,
        barHeight,
      );
    }
    drawPlayhead(context, width, height, playbackPhase);
  }

  private cancelAnimation(): void {
    if (this.animationFrame !== undefined) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = undefined;
    }
  }
}

function prepareCanvas(canvas: HTMLCanvasElement): {
  readonly context: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
} {
  const context = canvas.getContext("2d", { alpha: false });
  if (context === null) {
    throw new Error("Canvas 2D is unavailable for contact analysis.");
  }
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
  const pixelWidth = Math.round(width * pixelRatio);
  const pixelHeight = Math.round(height * pixelRatio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  return { context, width, height };
}

function drawAnalysisGrid(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  context.globalAlpha = 1;
  context.fillStyle = "#07100f";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(190, 219, 195, 0.075)";
  context.lineWidth = 1;
  for (let division = 1; division < 4; division += 1) {
    const x = (division / 4) * width;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  context.beginPath();
  context.moveTo(0, height * 0.5);
  context.lineTo(width, height * 0.5);
  context.stroke();
}

function drawPlayhead(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  playbackPhase: number | undefined,
): void {
  if (playbackPhase === undefined) {
    return;
  }
  const x = playbackPhase * width;
  context.strokeStyle = "rgba(238, 248, 235, 0.72)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(x, 0);
  context.lineTo(x, height);
  context.stroke();
}

function modeDisplayName(mode: ContactAnalysisMode): string {
  return mode === "mix" ? "MIX" : `${mode.toUpperCase()} ONLY`;
}

function requireElement<ElementType extends Element>(
  root: ParentNode,
  selector: string,
): ElementType {
  const element = root.querySelector<ElementType>(selector);
  if (element === null) {
    throw new Error(`Missing contact analysis element: ${selector}`);
  }
  return element;
}
