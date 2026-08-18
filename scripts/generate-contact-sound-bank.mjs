/* global Buffer, console */

import { OggVorbisDecoder } from "@wasm-audio-decoders/ogg-vorbis";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLE_RATE = 48_000;
const OUTPUT_PEAK = 0.72;
const GENERATOR_VERSION = 3;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const sourceRoot = path.join(projectRoot, "assets/source/contact-recordings");
const outputRoot = path.join(
  projectRoot,
  "public/assets/audio/contacts/countable/v1",
);

const sourceRecordings = Object.freeze([
  Object.freeze({
    id: "freight-ship-cavitation",
    fileName: "frachter-i-cavitation.ogg",
    originalFileName: "Frachter I.ogg",
    description: "Hydroacoustic cavitation noise from a freight ship",
    author: "L. Ginkey",
    institution:
      "Forschungsanstalt der Bundeswehr fuer Wasserschall und Geophysik",
    sourcePage: "https://commons.wikimedia.org/wiki/File:Frachter_I.ogg",
    license: "CC BY 2.5",
    licenseUrl: "https://creativecommons.org/licenses/by/2.5/",
    sha256: "0f9863b34e4c121dcb86a1af43fe84826e107382fef4523d072069c37412ea82",
  }),
  Object.freeze({
    id: "icebreaker-kuna-engine-room",
    fileName: "icebreaker-kuna-engine-room.ogg",
    originalFileName: "WWS IcebreakerKunashipsengine.ogg",
    description:
      "Combustion engine operating in the engine room of icebreaker Kuna",
    author: "Monika Widzicka / Work With Sounds",
    institution: "Museum of Municipal Engineering",
    sourcePage:
      "https://commons.wikimedia.org/wiki/File:WWS_IcebreakerKunashipsengine.ogg",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    sha256: "a9ae970fc4571fb57fa2487f374fa01b5a7e04c0cff8db5ccb9abb9d8376651b",
  }),
  Object.freeze({
    id: "maudslay-pump-engine",
    fileName: "maudslay-pump-engine.ogg",
    originalFileName: "WWS Maudslayengine.ogg",
    description: "Maudslay beam engine directly driving a water pump",
    author: "Ben Minto / Soundkids / Work With Sounds",
    institution: "Wikimedia Sverige partnership",
    sourcePage:
      "https://commons.wikimedia.org/wiki/File:WWS_Maudslayengine.ogg",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    sha256: "a21d491c6c0c4a21033177c1defee8c0dc4e8490d37e47787a2a7b23109b6f4e",
  }),
  Object.freeze({
    id: "valve-feeding-machine",
    fileName: "valve-feeding-machine.ogg",
    originalFileName: "WWS Valvefeedingmachine.ogg",
    description: "Rotating industrial valve feeding machine",
    author: "Maasa Jaervinen / Work With Sounds",
    institution: "Werstas",
    sourcePage:
      "https://commons.wikimedia.org/wiki/File:WWS_Valvefeedingmachine.ogg",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    sha256: "e3399162e1f631686c626a18afa2165a01e4966eb71133c150f702bf3bf3757b",
  }),
  Object.freeze({
    id: "hot-bulb-boat-engine",
    fileName: "hot-bulb-boat-engine.ogg",
    originalFileName: "WWS ModelAhotbulbboatengine.ogg",
    description:
      "1930s hot-bulb boat engine operating a chain-link scoop mechanism",
    author: "Torsten Nilsson / Work With Sounds",
    institution: "Wikimedia Sverige partnership",
    sourcePage:
      "https://commons.wikimedia.org/wiki/File:WWS_ModelAhotbulbboatengine.ogg",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    sha256: "90c1c873d9142d56b6d89163eeb9dc4cd30d407f4db2f94ab2a61884d2971237",
  }),
]);

const profiles = [
  {
    id: "frostbite-victor-iii",
    components: [
      component(
        "a-propeller-pressure.wav",
        "propeller",
        "freight-ship-cavitation",
        7.48,
        0.42,
        0.075,
        0.86,
        24,
        820,
      ),
      component(
        "b-coolant-pump.wav",
        "machinery",
        "maudslay-pump-engine",
        47.46,
        0.43,
        0.07,
        0.92,
        45,
        1_300,
        0,
      ),
      component(
        "c-blade-pass.wav",
        "blade",
        "freight-ship-cavitation",
        19.29,
        0.31,
        0.05,
        1.15,
        80,
        1_800,
      ),
    ],
  },
  {
    id: "sierra-i-machinery",
    components: [
      component(
        "a-skewed-propeller.wav",
        "propeller",
        "freight-ship-cavitation",
        10.2,
        0.39,
        0.065,
        0.94,
        26,
        900,
      ),
      component(
        "b-reduction-gear.wav",
        "machinery",
        "icebreaker-kuna-engine-room",
        81.64,
        0.39,
        0.06,
        1,
        55,
        1_500,
        0,
      ),
      component(
        "c-blade-tip-pass.wav",
        "blade",
        "freight-ship-cavitation",
        18.47,
        0.29,
        0.045,
        1.22,
        90,
        1_900,
      ),
    ],
  },
  {
    id: "sturgeon-machinery",
    components: [
      component(
        "a-seven-blade-pressure.wav",
        "propeller",
        "freight-ship-cavitation",
        13.61,
        0.36,
        0.06,
        1.02,
        30,
        980,
      ),
      component(
        "b-circulation-pump.wav",
        "machinery",
        "maudslay-pump-engine",
        59.28,
        0.38,
        0.06,
        1.05,
        60,
        1_550,
        1,
      ),
      component(
        "c-shaft-blade-tick.wav",
        "blade",
        "valve-feeding-machine",
        32.22,
        0.27,
        0.04,
        1.12,
        100,
        2_200,
      ),
    ],
  },
  {
    id: "los-angeles-machinery",
    components: [
      component(
        "a-high-speed-propeller.wav",
        "propeller",
        "freight-ship-cavitation",
        15.97,
        0.32,
        0.05,
        1.12,
        34,
        1_080,
      ),
      component(
        "b-turbine-coupling.wav",
        "machinery",
        "icebreaker-kuna-engine-room",
        103.59,
        0.34,
        0.05,
        1.12,
        70,
        1_700,
        1,
      ),
      component(
        "c-fast-blade-pass.wav",
        "blade",
        "freight-ship-cavitation",
        28.56,
        0.24,
        0.04,
        1.35,
        110,
        2_100,
      ),
    ],
  },
  {
    id: "merchant-slow-diesel",
    components: [
      component(
        "a-heavy-propeller.wav",
        "propeller",
        "freight-ship-cavitation",
        25.47,
        0.46,
        0.085,
        0.78,
        22,
        760,
      ),
      component(
        "b-diesel-crankcase.wav",
        "diesel",
        "hot-bulb-boat-engine",
        67.44,
        0.48,
        0.075,
        0.82,
        40,
        1_250,
      ),
      component(
        "c-valve-train.wav",
        "machinery",
        "valve-feeding-machine",
        41.09,
        0.3,
        0.05,
        0.95,
        90,
        1_950,
      ),
    ],
  },
];

const decodedSources = await decodeAndVerifySources();
const manifestProfiles = [];
for (const profile of profiles) {
  const profileDirectory = path.join(outputRoot, profile.id);
  await mkdir(profileDirectory, { recursive: true });
  const manifestComponents = [];

  for (const recipe of profile.components) {
    const decoded = decodedSources.get(recipe.sourceId);
    if (decoded === undefined) {
      throw new Error(`Missing decoded source: ${recipe.sourceId}`);
    }
    const samples = extractRecordedEvent(decoded, recipe);
    applyOnePoleHighpass(samples, recipe.highpassHz, SAMPLE_RATE);
    applyOnePoleLowpass(samples, recipe.lowpassHz, SAMPLE_RATE, 2);
    applyCosineFades(samples, 0.004, recipe.kind === "blade" ? 0.055 : 0.08);
    closeWithDigitalSilence(samples, 0.012, 0.003);
    normalize(samples, OUTPUT_PEAK);
    const wav = encodeMonoPcm16Wav(samples, SAMPLE_RATE);
    const targetPath = path.join(profileDirectory, recipe.fileName);
    await writeFile(targetPath, wav);

    const source = sourceById(recipe.sourceId);
    const sourceStartSeconds =
      recipe.sourceOnsetSeconds - recipe.preRollSeconds * recipe.playbackRate;
    const sourceEndSeconds =
      sourceStartSeconds + recipe.durationSeconds * recipe.playbackRate;
    manifestComponents.push({
      file: `${profile.id}/${recipe.fileName}`,
      kind: recipe.kind,
      provenance: "authentic-recording-excerpt",
      sourceId: source.id,
      sourceFile: source.fileName,
      sourceOnsetSeconds: recipe.sourceOnsetSeconds,
      sourceStartSeconds: rounded(sourceStartSeconds),
      sourceEndSeconds: rounded(sourceEndSeconds),
      onsetSecondsWithinEvent: recipe.preRollSeconds,
      playbackRate: recipe.playbackRate,
      sourceChannel: recipe.sourceChannel,
      transformations: [
        "mono extraction",
        `playback-rate ${String(recipe.playbackRate)}`,
        `high-pass ${String(recipe.highpassHz)} Hz`,
        `low-pass ${String(recipe.lowpassHz)} Hz`,
        "4 ms anti-click fade-in",
        `${recipe.kind === "blade" ? "55" : "80"} ms tail fade`,
        "peak normalization",
        "3 ms digital-silence tail",
      ],
      durationSeconds: samples.length / SAMPLE_RATE,
      sampleRate: SAMPLE_RATE,
      peakDbfs: decibels(peak(samples)),
      rmsDbfs: decibels(rms(samples)),
      sha256: sha256(wav),
    });
  }

  manifestProfiles.push({
    id: profile.id,
    components: manifestComponents,
  });
}

const manifest = {
  format: "AKULA countable contact one-shot bank",
  generatorVersion: GENERATOR_VERSION,
  sampleRate: SAMPLE_RATE,
  channels: 1,
  encoding: "PCM signed 16-bit little-endian",
  provenance:
    "Derived exclusively from documented authentic field recordings; no procedural sound synthesis",
  thirdPartyMaterial: true,
  editingPolicy:
    "Natural mechanical onsets are extracted with pre-roll; edits are limited to channel selection, resampling, light filtering, anti-click/tail fades, normalization, and digital silence.",
  sourceRecordings,
  profiles: manifestProfiles,
};
await writeFile(
  path.join(outputRoot, "MANIFEST.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

console.log(
  `Generated ${String(profiles.length * 3)} authentic-recording one-shots in ${outputRoot}`,
);

function component(
  fileName,
  kind,
  sourceId,
  sourceOnsetSeconds,
  durationSeconds,
  preRollSeconds,
  playbackRate,
  highpassHz,
  lowpassHz,
  sourceChannel = "mono",
) {
  return {
    fileName,
    kind,
    sourceId,
    sourceOnsetSeconds,
    durationSeconds,
    preRollSeconds,
    playbackRate,
    highpassHz,
    lowpassHz,
    sourceChannel,
  };
}

async function decodeAndVerifySources() {
  const decoder = new OggVorbisDecoder();
  await decoder.ready;
  const decoded = new Map();
  try {
    for (const source of sourceRecordings) {
      const bytes = await readFile(path.join(sourceRoot, source.fileName));
      const actualHash = sha256(bytes);
      if (actualHash !== source.sha256) {
        throw new Error(
          `Source hash mismatch for ${source.fileName}: ${actualHash}`,
        );
      }
      const audio = await decoder.decodeFile(bytes);
      if (
        audio.samplesDecoded < 1 ||
        audio.sampleRate < 1 ||
        audio.channelData.length < 1
      ) {
        throw new Error(
          `Unable to decode source recording: ${source.fileName}`,
        );
      }
      decoded.set(source.id, {
        sampleRate: audio.sampleRate,
        channelData: audio.channelData.map((channel) =>
          Float32Array.from(channel),
        ),
      });
      await decoder.reset();
    }
  } finally {
    decoder.free();
  }
  return decoded;
}

function extractRecordedEvent(decoded, recipe) {
  const frameCount = Math.round(recipe.durationSeconds * SAMPLE_RATE);
  const samples = new Float32Array(frameCount);
  const sourceStartSeconds =
    recipe.sourceOnsetSeconds - recipe.preRollSeconds * recipe.playbackRate;
  const sourceStartFrame = sourceStartSeconds * decoded.sampleRate;
  const sourceStep = (decoded.sampleRate * recipe.playbackRate) / SAMPLE_RATE;

  for (let outputFrame = 0; outputFrame < frameCount; outputFrame += 1) {
    const sourceFrame = sourceStartFrame + outputFrame * sourceStep;
    const leftFrame = Math.floor(sourceFrame);
    const fraction = sourceFrame - leftFrame;
    if (leftFrame < 0 || leftFrame + 1 >= decoded.channelData[0].length) {
      throw new RangeError(
        `Excerpt ${recipe.fileName} falls outside ${recipe.sourceId}`,
      );
    }
    samples[outputFrame] = interpolateSourceChannels(
      decoded.channelData,
      leftFrame,
      fraction,
      recipe.sourceChannel,
    );
  }
  return samples;
}

function interpolateSourceChannels(
  channelData,
  leftFrame,
  fraction,
  sourceChannel,
) {
  if (sourceChannel !== "mono") {
    const channel =
      channelData[Math.min(sourceChannel, channelData.length - 1)];
    return interpolate(channel, leftFrame, fraction);
  }
  let sum = 0;
  for (const channel of channelData) {
    sum += interpolate(channel, leftFrame, fraction);
  }
  return sum / channelData.length;
}

function interpolate(samples, leftFrame, fraction) {
  const left = samples[leftFrame] ?? 0;
  const right = samples[leftFrame + 1] ?? left;
  return left + (right - left) * fraction;
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
    const gain = Math.cos((progress * Math.PI) / 2) ** 2;
    samples[index] = (samples[index] ?? 0) * gain;
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
  return Math.sqrt(squareSum / samples.length);
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
