import { samplePulseEnvelope } from "./perceptualEncoding";
import {
  PROPELLER_PRESET,
  type MechanicalPulsePreset,
  type PropellerNoiseColor,
} from "./propellerPreset";
import { validateAcousticSignature } from "./signatureMath";
import type { AcousticCode, AcousticSignatureEngineOptions } from "./types";

type ContinuousSource = AudioBufferSourceNode | OscillatorNode;

interface OutputStage {
  readonly input: GainNode;
  readonly compressor: DynamicsCompressorNode;
  readonly outputGain: GainNode;
}

interface NoiseBank {
  readonly brown: AudioBuffer;
  readonly pink: AudioBuffer;
  readonly white: AudioBuffer;
}

interface HydrophoneBed {
  readonly gain: GainNode;
  readonly lowpass: BiquadFilterNode;
}

interface VoiceGraph {
  readonly masterGain: GainNode;
  readonly nodes: readonly AudioNode[];
  readonly sources: readonly ContinuousSource[];
  readonly startedAtContextTime: number;
  retiring: boolean;
  cleaned: boolean;
}

const DEFAULT_SIGNATURE: AcousticCode = [1, 2, 4];
const DEFAULT_CYCLE_DURATION_SECONDS = 4.5;

/** Synthesizes three ordered, independent, phase-locked propeller components. */
export class AcousticSignatureEngine {
  private context: AudioContext | undefined;
  private readonly ownsContext: boolean;
  private readonly externalOutput: AudioNode | undefined;
  private signature: AcousticCode;
  private cycleDurationSeconds: number;
  private outputStage: OutputStage | undefined;
  private noiseBank: NoiseBank | undefined;
  private activeVoice: VoiceGraph | undefined;
  private readonly retiringVoices = new Set<VoiceGraph>();
  private wantsPlayback = false;
  private disposed = false;

  public constructor(options: AcousticSignatureEngineOptions = {}) {
    if (options.output !== undefined && options.audioContext === undefined) {
      throw new TypeError("An output node requires its AudioContext.");
    }
    if (
      options.output !== undefined &&
      options.audioContext !== undefined &&
      options.output.context !== options.audioContext
    ) {
      throw new TypeError(
        "The output node must belong to the supplied context.",
      );
    }

    this.context = options.audioContext;
    this.ownsContext = options.audioContext === undefined;
    this.externalOutput = options.output;
    this.signature = validateAcousticSignature(
      options.signature ?? DEFAULT_SIGNATURE,
    );
    this.cycleDurationSeconds = validateCycleDuration(
      options.cycleDuration ?? DEFAULT_CYCLE_DURATION_SECONDS,
    );
  }

  public setSignature(code: AcousticCode): void {
    this.assertUsable();
    const validated = validateAcousticSignature(code);
    if (codesMatch(this.signature, validated)) {
      return;
    }

    this.signature = validated;
    this.replaceActiveVoice();
  }

  public setCycleDuration(seconds: number): void {
    this.assertUsable();
    const duration = validateCycleDuration(seconds);
    if (duration === this.cycleDurationSeconds) {
      return;
    }

    this.cycleDurationSeconds = duration;
    this.replaceActiveVoice();
  }

  /** Elapsed time on the audible Web Audio clock, used by synchronized views. */
  public getPlaybackElapsedTime(): number | undefined {
    const context = this.context;
    const voice = this.activeVoice;
    if (context === undefined || voice === undefined) {
      return undefined;
    }

    return Math.max(
      0,
      estimateAudibleContextTime(context) - voice.startedAtContextTime,
    );
  }

  public async play(): Promise<void> {
    this.assertUsable();
    this.wantsPlayback = true;

    const context = this.ensureRuntime();
    if (context.state === "closed") {
      throw new Error("The supplied AudioContext is closed.");
    }
    if (context.state === "suspended") {
      await context.resume();
    }
    if (
      !this.wantsPlayback ||
      this.disposed ||
      this.activeVoice !== undefined
    ) {
      return;
    }

    const startTime =
      context.currentTime + PROPELLER_PRESET.timing.lookAheadSeconds;
    const voice = this.createVoice(startTime);
    this.activeVoice = voice;
    fadeIn(
      voice.masterGain.gain,
      startTime,
      PROPELLER_PRESET.timing.fadeInSeconds,
    );
  }

  public pause(): void {
    if (this.disposed) {
      return;
    }

    this.wantsPlayback = false;
    const voice = this.activeVoice;
    this.activeVoice = undefined;
    if (voice !== undefined) {
      this.retireVoice(voice, PROPELLER_PRESET.timing.fadeOutSeconds);
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.wantsPlayback = false;
    this.disposed = true;
    const voice = this.activeVoice;
    this.activeVoice = undefined;
    if (voice !== undefined) {
      this.retireVoice(voice, PROPELLER_PRESET.timing.fadeOutSeconds);
    }
    if (this.retiringVoices.size === 0) {
      this.finalizeDisposal();
    }
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error("This AcousticSignatureEngine has been disposed.");
    }
  }

  private ensureRuntime(): AudioContext {
    if (this.context === undefined) {
      if (globalThis.AudioContext === undefined) {
        throw new Error("Web Audio API is not available in this environment.");
      }
      this.context = new AudioContext({ latencyHint: "interactive" });
    }
    if (this.outputStage === undefined) {
      this.outputStage = createOutputStage(
        this.context,
        this.externalOutput ?? this.context.destination,
      );
    }
    if (this.noiseBank === undefined) {
      this.noiseBank = createNoiseBank(this.context);
    }
    return this.context;
  }

  private createVoice(startTime: number): VoiceGraph {
    if (
      this.context === undefined ||
      this.outputStage === undefined ||
      this.noiseBank === undefined
    ) {
      throw new Error("The audio runtime has not been initialized.");
    }
    return buildVoice(
      this.context,
      this.outputStage.input,
      this.noiseBank,
      this.signature,
      this.cycleDurationSeconds,
      startTime,
    );
  }

  private replaceActiveVoice(): void {
    const context = this.context;
    const previousVoice = this.activeVoice;
    if (
      !this.wantsPlayback ||
      previousVoice === undefined ||
      context === undefined ||
      context.state !== "running"
    ) {
      return;
    }

    const startTime =
      context.currentTime + PROPELLER_PRESET.timing.lookAheadSeconds;
    const nextVoice = this.createVoice(startTime);
    this.activeVoice = nextVoice;
    fadeIn(
      nextVoice.masterGain.gain,
      startTime,
      PROPELLER_PRESET.timing.transitionSeconds,
    );
    this.retireVoice(
      previousVoice,
      PROPELLER_PRESET.timing.transitionSeconds,
      startTime,
    );
  }

  private retireVoice(
    voice: VoiceGraph,
    fadeSeconds: number,
    requestedStartTime?: number,
  ): void {
    if (voice.retiring || voice.cleaned) {
      return;
    }

    voice.retiring = true;
    this.retiringVoices.add(voice);
    const context = this.context;
    if (context === undefined || context.state !== "running") {
      stopSources(voice.sources, context?.currentTime ?? 0);
      this.cleanupVoice(voice);
      return;
    }

    const fadeStart = Math.max(
      context.currentTime,
      requestedStartTime ?? context.currentTime,
    );
    const stopTime =
      fadeStart + fadeSeconds + PROPELLER_PRESET.timing.cleanupMarginSeconds;
    holdParameter(voice.masterGain.gain, fadeStart);
    voice.masterGain.gain.linearRampToValueAtTime(0, fadeStart + fadeSeconds);

    let sourcesRemaining = voice.sources.length;
    if (sourcesRemaining === 0) {
      this.cleanupVoice(voice);
      return;
    }
    const markSourceEnded = (): void => {
      sourcesRemaining -= 1;
      if (sourcesRemaining === 0) {
        this.cleanupVoice(voice);
      }
    };
    for (const source of voice.sources) {
      source.addEventListener("ended", markSourceEnded, { once: true });
    }
    stopSources(voice.sources, stopTime);
  }

  private cleanupVoice(voice: VoiceGraph): void {
    if (voice.cleaned) {
      return;
    }
    voice.cleaned = true;
    for (const node of voice.nodes) {
      node.disconnect();
    }
    this.retiringVoices.delete(voice);
    if (this.disposed && this.retiringVoices.size === 0) {
      this.finalizeDisposal();
    }
  }

  private finalizeDisposal(): void {
    this.outputStage?.input.disconnect();
    this.outputStage?.compressor.disconnect();
    this.outputStage?.outputGain.disconnect();
    this.outputStage = undefined;
    this.noiseBank = undefined;

    const context = this.context;
    this.context = undefined;
    if (
      this.ownsContext &&
      context !== undefined &&
      context.state !== "closed"
    ) {
      void context.close();
    }
  }
}

function createOutputStage(
  context: AudioContext,
  destination: AudioNode,
): OutputStage {
  const input = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const outputGain = context.createGain();
  const now = context.currentTime;

  compressor.threshold.setValueAtTime(
    PROPELLER_PRESET.output.compressorThreshold,
    now,
  );
  compressor.knee.setValueAtTime(PROPELLER_PRESET.output.compressorKnee, now);
  compressor.ratio.setValueAtTime(PROPELLER_PRESET.output.compressorRatio, now);
  compressor.attack.setValueAtTime(
    PROPELLER_PRESET.output.compressorAttack,
    now,
  );
  compressor.release.setValueAtTime(
    PROPELLER_PRESET.output.compressorRelease,
    now,
  );
  outputGain.gain.setValueAtTime(PROPELLER_PRESET.output.gain, now);

  input.connect(compressor);
  compressor.connect(outputGain);
  outputGain.connect(destination);
  return { input, compressor, outputGain };
}

function buildVoice(
  context: AudioContext,
  destination: AudioNode,
  noiseBank: NoiseBank,
  signature: AcousticCode,
  cycleDurationSeconds: number,
  startTime: number,
): VoiceGraph {
  const nodes: AudioNode[] = [];
  const sources: ContinuousSource[] = [];
  const track = <Node extends AudioNode>(node: Node): Node => {
    nodes.push(node);
    return node;
  };
  const trackSource = <Source extends ContinuousSource>(
    source: Source,
  ): Source => {
    track(source);
    sources.push(source);
    return source;
  };

  const masterGain = track(context.createGain());
  const voiceMix = track(context.createGain());
  masterGain.gain.setValueAtTime(0, startTime);
  voiceMix.gain.setValueAtTime(1, startTime);
  voiceMix.connect(masterGain);
  masterGain.connect(destination);

  const hasActiveComponent = signature.some((count) => count > 0);
  const bed = hasActiveComponent
    ? createHydrophoneBed(
        context,
        voiceMix,
        noiseBank,
        signature[0] > 0,
        startTime,
        track,
        trackSource,
      )
    : undefined;

  if (signature[0] > 0) {
    createHullComponent(
      context,
      voiceMix,
      noiseBank,
      bed,
      signature[0],
      cycleDurationSeconds,
      startTime,
      track,
      trackSource,
    );
  }
  if (signature[1] > 0) {
    createMechanicalPulseComponent(
      context,
      voiceMix,
      noiseBank.pink,
      PROPELLER_PRESET.pump,
      signature[1],
      cycleDurationSeconds,
      PROPELLER_PRESET.modulation.componentB.pulseShapePower,
      startTime,
      track,
      trackSource,
    );
  }
  if (signature[2] > 0) {
    createMechanicalPulseComponent(
      context,
      voiceMix,
      noiseBank.pink,
      PROPELLER_PRESET.blade,
      signature[2],
      cycleDurationSeconds,
      PROPELLER_PRESET.modulation.componentC.pulseShapePower,
      startTime,
      track,
      trackSource,
    );
  }

  for (const source of sources) {
    source.start(startTime);
  }

  return {
    masterGain,
    nodes,
    sources,
    startedAtContextTime: startTime,
    retiring: false,
    cleaned: false,
  };
}

function createHydrophoneBed(
  context: AudioContext,
  destination: AudioNode,
  noiseBank: NoiseBank,
  componentAIsActive: boolean,
  startTime: number,
  track: <Node extends AudioNode>(node: Node) => Node,
  trackSource: <Source extends ContinuousSource>(source: Source) => Source,
): HydrophoneBed {
  const source = trackSource(createNoiseSource(context, noiseBank.brown));
  const highpass = track(createFilter(context, "highpass"));
  const lowpass = track(createFilter(context, "lowpass"));
  const gain = track(context.createGain());
  const componentA = PROPELLER_PRESET.modulation.componentA;

  highpass.frequency.setValueAtTime(PROPELLER_PRESET.bed.highpassHz, startTime);
  lowpass.frequency.setValueAtTime(
    componentAIsActive
      ? componentA.bedLowpassFloorHz
      : PROPELLER_PRESET.bed.lowpassHz,
    startTime,
  );
  lowpass.Q.setValueAtTime(PROPELLER_PRESET.bed.lowpassQ, startTime);
  gain.gain.setValueAtTime(
    componentAIsActive
      ? PROPELLER_PRESET.bed.gain * componentA.bedFloorScale
      : PROPELLER_PRESET.bed.gain,
    startTime,
  );

  source.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(gain);
  gain.connect(destination);

  createSineModulator(
    context,
    PROPELLER_PRESET.modulation.organicRateHz,
    [[lowpass.frequency, PROPELLER_PRESET.modulation.organicBedFilterDepthHz]],
    startTime,
    track,
    trackSource,
  );

  return { gain, lowpass };
}

function createHullComponent(
  context: AudioContext,
  destination: AudioNode,
  noiseBank: NoiseBank,
  bed: HydrophoneBed | undefined,
  repetitions: number,
  cycleDurationSeconds: number,
  startTime: number,
  track: <Node extends AudioNode>(node: Node) => Node,
  trackSource: <Source extends ContinuousSource>(source: Source) => Source,
): void {
  const preset = PROPELLER_PRESET.hull;
  const modulation = PROPELLER_PRESET.modulation.componentA;
  const fundamental = trackSource(context.createOscillator());
  const overtone = trackSource(context.createOscillator());
  const overtoneGain = track(context.createGain());
  const gain = track(context.createGain());
  const lowpass = track(createFilter(context, "lowpass"));
  const flow = trackSource(createNoiseSource(context, noiseBank.pink));
  const flowHighpass = track(createFilter(context, "highpass"));
  const flowLowpass = track(createFilter(context, "lowpass"));
  const flowGain = track(context.createGain());

  fundamental.type = "sine";
  fundamental.frequency.setValueAtTime(preset.fundamentalHz, startTime);
  overtone.type = "triangle";
  overtone.frequency.setValueAtTime(preset.overtoneHz, startTime);
  overtoneGain.gain.setValueAtTime(preset.overtoneGain, startTime);
  gain.gain.setValueAtTime(preset.gain - modulation.gainDepth, startTime);
  lowpass.frequency.setValueAtTime(
    preset.lowpassHz - modulation.filterDepthHz,
    startTime,
  );
  flowHighpass.frequency.setValueAtTime(preset.flowHighpassHz, startTime);
  flowLowpass.frequency.setValueAtTime(preset.flowLowpassFloorHz, startTime);
  flowLowpass.Q.setValueAtTime(preset.flowLowpassQ, startTime);
  flowGain.gain.setValueAtTime(
    preset.flowGain * preset.flowFloorScale,
    startTime,
  );

  fundamental.connect(gain);
  overtone.connect(overtoneGain);
  overtoneGain.connect(gain);
  gain.connect(lowpass);
  lowpass.connect(destination);
  flow.connect(flowHighpass);
  flowHighpass.connect(flowLowpass);
  flowLowpass.connect(flowGain);
  flowGain.connect(destination);

  const targets: (readonly [AudioParam, number])[] = [
    [gain.gain, modulation.gainDepth * 2],
    [lowpass.frequency, modulation.filterDepthHz * 2],
    [flowGain.gain, preset.flowGain * (1 - preset.flowFloorScale)],
    [flowLowpass.frequency, preset.flowLowpassHz - preset.flowLowpassFloorHz],
  ];
  if (bed !== undefined) {
    targets.push([
      bed.gain.gain,
      PROPELLER_PRESET.bed.gain * (1 - modulation.bedFloorScale),
    ]);
    targets.push([
      bed.lowpass.frequency,
      PROPELLER_PRESET.bed.lowpassHz - modulation.bedLowpassFloorHz,
    ]);
  }

  createEnvelopeModulator(
    context,
    repetitions,
    cycleDurationSeconds,
    modulation.pulseShapePower,
    targets,
    startTime,
    track,
    trackSource,
  );
}

function createMechanicalPulseComponent(
  context: AudioContext,
  destination: AudioNode,
  noiseBuffer: AudioBuffer,
  preset: MechanicalPulsePreset,
  repetitions: number,
  cycleDurationSeconds: number,
  pulseShapePower: number,
  startTime: number,
  track: <Node extends AudioNode>(node: Node) => Node,
  trackSource: <Source extends ContinuousSource>(source: Source) => Source,
): void {
  const source = trackSource(createNoiseSource(context, noiseBuffer));
  const highpass = track(createFilter(context, "highpass"));
  const lowpass = track(createFilter(context, "lowpass"));
  const fundamental = trackSource(context.createOscillator());
  const fundamentalGain = track(context.createGain());
  const overtone = trackSource(context.createOscillator());
  const overtoneGain = track(context.createGain());
  const componentGain = track(context.createGain());

  highpass.frequency.setValueAtTime(preset.highpassHz, startTime);
  lowpass.frequency.setValueAtTime(preset.lowpassFloorHz, startTime);
  lowpass.Q.setValueAtTime(preset.lowpassQ, startTime);
  fundamental.type = "triangle";
  fundamental.frequency.setValueAtTime(preset.fundamentalHz, startTime);
  fundamentalGain.gain.setValueAtTime(preset.fundamentalGain, startTime);
  overtone.type = "sine";
  overtone.frequency.setValueAtTime(preset.overtoneHz, startTime);
  overtoneGain.gain.setValueAtTime(preset.overtoneGain, startTime);
  componentGain.gain.setValueAtTime(preset.gain * preset.floorScale, startTime);

  source.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(componentGain);
  fundamental.connect(fundamentalGain);
  fundamentalGain.connect(componentGain);
  overtone.connect(overtoneGain);
  overtoneGain.connect(componentGain);
  componentGain.connect(destination);

  createEnvelopeModulator(
    context,
    repetitions,
    cycleDurationSeconds,
    pulseShapePower,
    [
      [componentGain.gain, preset.gain * (1 - preset.floorScale)],
      [lowpass.frequency, preset.lowpassHz - preset.lowpassFloorHz],
    ],
    startTime,
    track,
    trackSource,
  );
}

function createEnvelopeModulator(
  context: AudioContext,
  repetitions: number,
  cycleDurationSeconds: number,
  pulseShapePower: number,
  targets: readonly (readonly [AudioParam, number])[],
  startTime: number,
  track: <Node extends AudioNode>(node: Node) => Node,
  trackSource: <Source extends ContinuousSource>(source: Source) => Source,
): void {
  const source = trackSource(context.createBufferSource());
  source.buffer = createEnvelopeBuffer(context, repetitions, pulseShapePower);
  source.loop = true;
  source.playbackRate.setValueAtTime(1 / cycleDurationSeconds, startTime);

  for (const [parameter, depth] of targets) {
    const depthGain = track(context.createGain());
    depthGain.gain.setValueAtTime(depth, startTime);
    source.connect(depthGain);
    depthGain.connect(parameter);
  }
}

function createEnvelopeBuffer(
  context: AudioContext,
  repetitions: number,
  pulseShapePower: number,
): AudioBuffer {
  const length = Math.round(context.sampleRate);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = samplePulseEnvelope(
      repetitions,
      1,
      index / samples.length,
      pulseShapePower,
    );
  }
  return buffer;
}

function createSineModulator(
  context: AudioContext,
  rateHz: number,
  targets: readonly (readonly [AudioParam, number])[],
  startTime: number,
  track: <Node extends AudioNode>(node: Node) => Node,
  trackSource: <Source extends ContinuousSource>(source: Source) => Source,
): void {
  const oscillator = trackSource(context.createOscillator());
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(rateHz, startTime);
  for (const [parameter, depth] of targets) {
    const depthGain = track(context.createGain());
    depthGain.gain.setValueAtTime(depth, startTime);
    oscillator.connect(depthGain);
    depthGain.connect(parameter);
  }
}

function createFilter(
  context: AudioContext,
  type: BiquadFilterType,
): BiquadFilterNode {
  const filter = context.createBiquadFilter();
  filter.type = type;
  return filter;
}

function createNoiseBank(context: AudioContext): NoiseBank {
  return {
    brown: createNoiseBuffer(context, "brown"),
    pink: createNoiseBuffer(context, "pink"),
    white: createNoiseBuffer(context, "white"),
  };
}

function createNoiseSource(
  context: AudioContext,
  buffer: AudioBuffer,
): AudioBufferSourceNode {
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.loopEnd = buffer.duration;
  return source;
}

function createNoiseBuffer(
  context: AudioContext,
  color: PropellerNoiseColor,
): AudioBuffer {
  const sampleCount = Math.ceil(
    context.sampleRate * PROPELLER_PRESET.noise.loopSeconds,
  );
  const buffer = context.createBuffer(2, sampleCount, context.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    fillNoise(samples, color);
    closeLoopSeam(samples);
    normalizePeak(samples, PROPELLER_PRESET.noise.peak);
  }
  return buffer;
}

function fillNoise(samples: Float32Array, color: PropellerNoiseColor): void {
  let brown = 0;
  let pink0 = 0;
  let pink1 = 0;
  let pink2 = 0;
  let pink3 = 0;
  let pink4 = 0;
  let pink5 = 0;
  let pink6 = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const white = Math.random() * 2 - 1;
    let sample = white;
    if (color === "brown") {
      brown = (brown + 0.02 * white) / 1.02;
      sample = brown * 3.5;
    } else if (color === "pink") {
      pink0 = 0.99886 * pink0 + white * 0.0555179;
      pink1 = 0.99332 * pink1 + white * 0.0750759;
      pink2 = 0.969 * pink2 + white * 0.153852;
      pink3 = 0.8665 * pink3 + white * 0.3104856;
      pink4 = 0.55 * pink4 + white * 0.5329522;
      pink5 = -0.7616 * pink5 - white * 0.016898;
      sample =
        (pink0 +
          pink1 +
          pink2 +
          pink3 +
          pink4 +
          pink5 +
          pink6 +
          white * 0.5362) *
        0.11;
      pink6 = white * 0.115926;
    }
    samples[index] = sample;
  }
}

function closeLoopSeam(samples: Float32Array): void {
  const first = samples.at(0);
  const last = samples.at(-1);
  if (first === undefined || last === undefined || samples.length < 2) {
    return;
  }

  const difference = last - first;
  const denominator = samples.length - 1;
  for (let index = 0; index < samples.length; index += 1) {
    const position = index / denominator;
    const smoothPosition = position * position * (3 - 2 * position);
    samples[index] = (samples[index] ?? 0) - difference * smoothPosition;
  }
}

function normalizePeak(samples: Float32Array, targetPeak: number): void {
  let currentPeak = 0;
  for (const sample of samples) {
    currentPeak = Math.max(currentPeak, Math.abs(sample));
  }
  if (currentPeak === 0) {
    return;
  }

  const scale = targetPeak / currentPeak;
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = (samples[index] ?? 0) * scale;
  }
}

function estimateAudibleContextTime(context: AudioContext): number {
  try {
    const timestamp = context.getOutputTimestamp();
    const { contextTime, performanceTime } = timestamp;
    if (
      typeof performanceTime === "number" &&
      typeof contextTime === "number" &&
      performanceTime > 0 &&
      Number.isFinite(performanceTime) &&
      Number.isFinite(contextTime)
    ) {
      const secondsSinceTimestamp = Math.max(
        0,
        (performance.now() - performanceTime) / 1_000,
      );
      return contextTime + secondsSinceTimestamp;
    }
  } catch {
    // Some browsers expose getOutputTimestamp before it is ready.
  }
  return context.currentTime;
}

function fadeIn(
  parameter: AudioParam,
  startTime: number,
  seconds: number,
): void {
  parameter.cancelScheduledValues(startTime);
  parameter.setValueAtTime(0, startTime);
  parameter.linearRampToValueAtTime(1, startTime + seconds);
}

function holdParameter(parameter: AudioParam, atTime: number): void {
  parameter.cancelAndHoldAtTime(atTime);
}

function stopSources(
  sources: readonly ContinuousSource[],
  stopTime: number,
): void {
  for (const source of sources) {
    source.stop(stopTime);
  }
}

function validateCycleDuration(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new RangeError("Cycle duration must be a positive finite number.");
  }
  return seconds;
}

function codesMatch(left: AcousticCode, right: AcousticCode): boolean {
  return left.every((value, index) => value === right[index]);
}
