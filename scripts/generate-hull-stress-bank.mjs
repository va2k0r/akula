/* global Buffer, console */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLE_RATE = 48_000;
const GENERATOR_VERSION = 1;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const researchRoot = path.join(
  projectRoot,
  "assets/research/submarine-sfx-2026-08-17/masters/usc-sound-effect-archive/hull-stress",
);
const outputRoot = path.join(projectRoot, "public/assets/audio/hull-stress/v1");

const sourceRecordings = Object.freeze([
  Object.freeze({
    id: "usc-metal-crusher",
    fileName: "metal-car-crusher-leaks-moans.wav",
    catalogNumber: 27,
    description: "Car body crushed by machine; short leaks and metal moans",
    collection: "USC Optical Sound Effects Library / SSE Library Metal",
    license: "CC0 1.0 Universal",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sha256: "c0e18e0ab464efbd2fa902bf33e6e1863c61d7ea31477e865e3343058eb64a73",
  }),
  Object.freeze({
    id: "usc-metal-girders",
    fileName: "metal-steel-girders-wrench-tear.wav",
    catalogNumber: 28,
    description: "Steel girders wrench and tear; long creaking metal",
    collection: "USC Optical Sound Effects Library / SSE Library Metal",
    license: "CC0 1.0 Universal",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sha256: "1068d8af03371a3d59ac554428e59a0703d9e73892fa2a4299eb3e71e57a36f3",
  }),
]);

// Each entry was selected as an individual, finite steel event. The pressure
// bank favours longer low groans; the maneuver bank favours short torsional
// bites. Runtime never loops these files.
const banks = Object.freeze([
  Object.freeze({
    id: "descent",
    role: "pressure load during fast actual descent",
    clips: Object.freeze([
      clip(
        "pressure-01.wav",
        "usc-metal-girders",
        1.55,
        2.4,
        0.92,
        28,
        1_050,
        0.6,
        0.09,
        0.12,
      ),
      clip(
        "pressure-02.wav",
        "usc-metal-girders",
        7.15,
        2.7,
        0.9,
        30,
        980,
        0.6,
        0.1,
        0.13,
      ),
      clip(
        "pressure-03.wav",
        "usc-metal-girders",
        16.2,
        2.8,
        0.92,
        26,
        1_100,
        0.6,
        0.09,
        0.14,
      ),
      clip(
        "pressure-04.wav",
        "usc-metal-girders",
        23.1,
        2.6,
        0.9,
        30,
        1_000,
        0.6,
        0.1,
        0.13,
      ),
      clip(
        "pressure-05.wav",
        "usc-metal-girders",
        34.2,
        2.75,
        0.92,
        28,
        1_080,
        0.6,
        0.09,
        0.14,
      ),
      clip(
        "pressure-06.wav",
        "usc-metal-girders",
        40.3,
        2.8,
        0.9,
        26,
        1_020,
        0.6,
        0.1,
        0.14,
      ),
      clip(
        "pressure-07.wav",
        "usc-metal-girders",
        48.1,
        2.9,
        0.92,
        30,
        1_100,
        0.6,
        0.09,
        0.15,
      ),
      clip(
        "pressure-08.wav",
        "usc-metal-crusher",
        3.8,
        2.25,
        0.88,
        28,
        950,
        0.58,
        0.1,
        0.13,
      ),
    ]),
  }),
  Object.freeze({
    id: "maneuver",
    role: "torsional load from actual horizontal speed and yaw rate",
    clips: Object.freeze([
      clip(
        "torsion-01.wav",
        "usc-metal-crusher",
        1.55,
        0.95,
        1.03,
        62,
        2_100,
        0.6,
        0.035,
        0.065,
      ),
      clip(
        "torsion-02.wav",
        "usc-metal-crusher",
        3,
        1.05,
        1.02,
        58,
        2_000,
        0.6,
        0.04,
        0.07,
      ),
      clip(
        "torsion-03.wav",
        "usc-metal-crusher",
        4.25,
        0.95,
        1.05,
        72,
        2_300,
        0.6,
        0.035,
        0.065,
      ),
      clip(
        "torsion-04.wav",
        "usc-metal-crusher",
        5.1,
        1.05,
        1.04,
        66,
        2_200,
        0.6,
        0.04,
        0.07,
      ),
      clip(
        "torsion-05.wav",
        "usc-metal-crusher",
        8.55,
        1.1,
        1.03,
        58,
        2_000,
        0.6,
        0.04,
        0.075,
      ),
      clip(
        "torsion-06.wav",
        "usc-metal-crusher",
        11.95,
        1,
        1.05,
        75,
        2_400,
        0.6,
        0.035,
        0.065,
      ),
      clip(
        "torsion-07.wav",
        "usc-metal-crusher",
        16.35,
        1.15,
        1.03,
        62,
        2_100,
        0.6,
        0.04,
        0.075,
      ),
      clip(
        "torsion-08.wav",
        "usc-metal-crusher",
        18.55,
        1.1,
        1.04,
        70,
        2_300,
        0.6,
        0.04,
        0.07,
      ),
      clip(
        "torsion-09.wav",
        "usc-metal-crusher",
        19.95,
        1.05,
        1.05,
        75,
        2_400,
        0.6,
        0.035,
        0.07,
      ),
      clip(
        "torsion-10.wav",
        "usc-metal-crusher",
        22.55,
        1.1,
        1.04,
        65,
        2_200,
        0.6,
        0.04,
        0.075,
      ),
      clip(
        "torsion-11.wav",
        "usc-metal-girders",
        29.85,
        1.25,
        1.05,
        58,
        1_900,
        0.58,
        0.045,
        0.085,
      ),
    ]),
  }),
]);

const decodedSources = await decodeAndVerifySources();
const manifestBanks = [];

for (const bank of banks) {
  const bankDirectory = path.join(outputRoot, bank.id);
  await mkdir(bankDirectory, { recursive: true });
  const manifestClips = [];

  for (const recipe of bank.clips) {
    const decoded = decodedSources.get(recipe.sourceId);
    if (decoded === undefined) {
      throw new Error(`Missing decoded source: ${recipe.sourceId}`);
    }
    const samples = extractRecordedEvent(decoded, recipe);
    applyOnePoleHighpass(samples, recipe.highpassHz, SAMPLE_RATE);
    applyOnePoleLowpass(samples, recipe.lowpassHz, SAMPLE_RATE, 2);
    applyCosineFades(samples, recipe.fadeInSeconds, recipe.fadeOutSeconds);
    closeWithDigitalSilence(samples, 0.012, 0.004);
    normalize(samples, recipe.outputPeak);

    const wav = encodeMonoPcm16Wav(samples, SAMPLE_RATE);
    await writeFile(path.join(bankDirectory, recipe.fileName), wav);
    const source = sourceById(recipe.sourceId);
    manifestClips.push({
      file: `${bank.id}/${recipe.fileName}`,
      role: bank.role,
      provenance: "recorded-steel-excerpt",
      sourceId: source.id,
      sourceCatalogNumber: source.catalogNumber,
      sourceFile: source.fileName,
      sourceStartSeconds: recipe.sourceStartSeconds,
      sourceEndSeconds: rounded(
        recipe.sourceStartSeconds +
          recipe.durationSeconds * recipe.playbackRate,
      ),
      playbackRateDuringExtraction: recipe.playbackRate,
      transformations: [
        `playback-rate ${String(recipe.playbackRate)}`,
        `high-pass ${String(recipe.highpassHz)} Hz`,
        `low-pass ${String(recipe.lowpassHz)} Hz, two passes`,
        `${String(Math.round(recipe.fadeInSeconds * 1_000))} ms anti-click fade-in`,
        `${String(Math.round(recipe.fadeOutSeconds * 1_000))} ms tail fade`,
        `peak normalization to ${String(recipe.outputPeak)}`,
        "4 ms digital-silence tail",
        "mono PCM 16-bit export",
      ],
      durationSeconds: rounded(samples.length / SAMPLE_RATE),
      sampleRate: SAMPLE_RATE,
      channels: 1,
      peakDbfs: decibels(peak(samples)),
      rmsDbfs: decibels(rms(samples)),
      sha256: sha256(wav),
    });
  }

  manifestBanks.push({
    id: bank.id,
    role: bank.role,
    clips: manifestClips,
  });
}

await mkdir(outputRoot, { recursive: true });
const manifest = {
  format: "AKULA recorded hull-stress micro-event bank",
  generatorVersion: GENERATOR_VERSION,
  sampleRate: SAMPLE_RATE,
  channels: 1,
  encoding: "PCM signed 16-bit little-endian",
  provenance:
    "Derived exclusively from USC Optical Sound Effects Library recordings 27 and 28; no procedural synthesis",
  playbackPolicy:
    "Finite one-shots only. Descent events respond to actual positive depth rate; maneuver events respond to actual horizontal speed multiplied by actual yaw rate. Neither bank responds directly to controller amplitude.",
  sourceRecordings,
  banks: manifestBanks,
};
await writeFile(
  path.join(outputRoot, "MANIFEST.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

const clipCount = banks.reduce((sum, bank) => sum + bank.clips.length, 0);
console.log(
  `Generated ${String(clipCount)} recorded hull-stress one-shots in ${outputRoot}`,
);

function clip(
  fileName,
  sourceId,
  sourceStartSeconds,
  durationSeconds,
  playbackRate,
  highpassHz,
  lowpassHz,
  outputPeak,
  fadeInSeconds,
  fadeOutSeconds,
) {
  return Object.freeze({
    fileName,
    sourceId,
    sourceStartSeconds,
    durationSeconds,
    playbackRate,
    highpassHz,
    lowpassHz,
    outputPeak,
    fadeInSeconds,
    fadeOutSeconds,
  });
}

async function decodeAndVerifySources() {
  const decoded = new Map();
  for (const source of sourceRecordings) {
    const bytes = await readFile(path.join(researchRoot, source.fileName));
    const actualHash = sha256(bytes);
    if (actualHash !== source.sha256) {
      throw new Error(
        `Source hash mismatch for ${source.fileName}: ${actualHash}`,
      );
    }
    decoded.set(source.id, decodeMonoPcmWav(bytes, source.fileName));
  }
  return decoded;
}

function decodeMonoPcmWav(bytes, fileName) {
  if (
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error(`Not a RIFF/WAVE file: ${fileName}`);
  }
  let format;
  let dataOffset;
  let dataLength;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkId = bytes.toString("ascii", offset, offset + 4);
    const chunkLength = bytes.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;
    if (chunkId === "fmt ") {
      format = {
        encoding: bytes.readUInt16LE(chunkDataOffset),
        channels: bytes.readUInt16LE(chunkDataOffset + 2),
        sampleRate: bytes.readUInt32LE(chunkDataOffset + 4),
        blockAlign: bytes.readUInt16LE(chunkDataOffset + 12),
        bitsPerSample: bytes.readUInt16LE(chunkDataOffset + 14),
      };
    } else if (chunkId === "data") {
      dataOffset = chunkDataOffset;
      dataLength = chunkLength;
    }
    offset = chunkDataOffset + chunkLength + (chunkLength % 2);
  }
  if (
    format === undefined ||
    dataOffset === undefined ||
    dataLength === undefined
  ) {
    throw new Error(`Missing fmt or data chunk: ${fileName}`);
  }
  if (
    format.encoding !== 1 ||
    format.channels !== 1 ||
    format.sampleRate !== SAMPLE_RATE ||
    format.bitsPerSample !== 24 ||
    format.blockAlign !== 3
  ) {
    throw new Error(
      `Expected mono 48 kHz PCM24 source, received ${JSON.stringify(format)} in ${fileName}`,
    );
  }
  const frameCount = Math.floor(dataLength / format.blockAlign);
  const samples = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    samples[frame] = bytes.readIntLE(dataOffset + frame * 3, 3) / 8_388_608;
  }
  return { sampleRate: format.sampleRate, samples };
}

function extractRecordedEvent(decoded, recipe) {
  const frameCount = Math.round(recipe.durationSeconds * SAMPLE_RATE);
  const samples = new Float32Array(frameCount);
  const sourceStartFrame = recipe.sourceStartSeconds * decoded.sampleRate;
  const sourceStep = (decoded.sampleRate * recipe.playbackRate) / SAMPLE_RATE;
  for (let outputFrame = 0; outputFrame < frameCount; outputFrame += 1) {
    const sourceFrame = sourceStartFrame + outputFrame * sourceStep;
    const leftFrame = Math.floor(sourceFrame);
    const fraction = sourceFrame - leftFrame;
    if (leftFrame < 0 || leftFrame + 1 >= decoded.samples.length) {
      throw new RangeError(
        `Excerpt ${recipe.fileName} falls outside ${recipe.sourceId}`,
      );
    }
    const left = decoded.samples[leftFrame] ?? 0;
    const right = decoded.samples[leftFrame + 1] ?? left;
    samples[outputFrame] = left + (right - left) * fraction;
  }
  return samples;
}

function applyOnePoleHighpass(samples, cutoffHz, sampleRate) {
  const timeStep = 1 / sampleRate;
  const resistanceCapacitance = 1 / (Math.PI * 2 * cutoffHz);
  const alpha = resistanceCapacitance / (resistanceCapacitance + timeStep);
  let previousInput = samples[0] ?? 0;
  let previousOutput = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const input = samples[index] ?? 0;
    const output = alpha * (previousOutput + input - previousInput);
    samples[index] = output;
    previousInput = input;
    previousOutput = output;
  }
}

function applyOnePoleLowpass(samples, cutoffHz, sampleRate, passes) {
  const timeStep = 1 / sampleRate;
  const resistanceCapacitance = 1 / (Math.PI * 2 * cutoffHz);
  const alpha = timeStep / (resistanceCapacitance + timeStep);
  for (let pass = 0; pass < passes; pass += 1) {
    let state = samples[0] ?? 0;
    for (let index = 0; index < samples.length; index += 1) {
      state += alpha * ((samples[index] ?? 0) - state);
      samples[index] = state;
    }
  }
}

function applyCosineFades(samples, fadeInSeconds, fadeOutSeconds) {
  const fadeInFrames = Math.min(
    samples.length,
    Math.round(fadeInSeconds * SAMPLE_RATE),
  );
  const fadeOutFrames = Math.min(
    samples.length,
    Math.round(fadeOutSeconds * SAMPLE_RATE),
  );
  for (let index = 0; index < fadeInFrames; index += 1) {
    const progress = index / Math.max(1, fadeInFrames - 1);
    samples[index] =
      (samples[index] ?? 0) * Math.sin((progress * Math.PI) / 2) ** 2;
  }
  const fadeOutStart = samples.length - fadeOutFrames;
  for (let index = fadeOutStart; index < samples.length; index += 1) {
    const progress = (index - fadeOutStart) / Math.max(1, fadeOutFrames - 1);
    samples[index] =
      (samples[index] ?? 0) * Math.cos((progress * Math.PI) / 2) ** 2;
  }
}

function closeWithDigitalSilence(samples, fadeSeconds, silenceSeconds) {
  const silenceFrames = Math.round(silenceSeconds * SAMPLE_RATE);
  const fadeFrames = Math.round(fadeSeconds * SAMPLE_RATE);
  const fadeStart = Math.max(0, samples.length - silenceFrames - fadeFrames);
  const silenceStart = Math.max(0, samples.length - silenceFrames);
  for (let index = fadeStart; index < silenceStart; index += 1) {
    const progress = (index - fadeStart) / Math.max(1, fadeFrames - 1);
    samples[index] =
      (samples[index] ?? 0) * Math.cos((progress * Math.PI) / 2) ** 2;
  }
  samples.fill(0, silenceStart);
}

function normalize(samples, targetPeak) {
  const sourcePeak = peak(samples);
  const scale = sourcePeak > 0 ? targetPeak / sourcePeak : 1;
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = (samples[index] ?? 0) * scale;
  }
}

function encodeMonoPcm16Wav(samples, sampleRate) {
  const bytesPerSample = 2;
  const dataLength = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataLength, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    buffer.writeInt16LE(Math.round(sample * 32_767), 44 + index * 2);
  }
  return buffer;
}

function peak(samples) {
  let value = 0;
  for (const sample of samples) {
    value = Math.max(value, Math.abs(sample));
  }
  return value;
}

function rms(samples) {
  let squareSum = 0;
  for (const sample of samples) {
    squareSum += sample * sample;
  }
  return Math.sqrt(squareSum / Math.max(1, samples.length));
}

function decibels(amplitude) {
  return Number((20 * Math.log10(Math.max(amplitude, 1e-9))).toFixed(2));
}

function sourceById(sourceId) {
  const source = sourceRecordings.find(
    (candidate) => candidate.id === sourceId,
  );
  if (source === undefined) {
    throw new Error(`Unknown source recording: ${sourceId}`);
  }
  return source;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function rounded(value) {
  return Number(value.toFixed(6));
}
