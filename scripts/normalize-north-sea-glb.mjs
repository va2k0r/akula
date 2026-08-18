/* global Buffer, process */

import { readFile, writeFile } from "node:fs/promises";

const [, , inputPath, outputPath] = process.argv;
if (inputPath === undefined || outputPath === undefined) {
  throw new Error(
    "Usage: node normalize-north-sea-glb.mjs input.glb output.glb",
  );
}

const source = await readFile(inputPath);
if (source.toString("ascii", 0, 4) !== "glTF") {
  throw new Error(`Not a binary glTF: ${inputPath}`);
}

const chunks = [];
let offset = 12;
while (offset < source.length) {
  const length = source.readUInt32LE(offset);
  const type = source.readUInt32LE(offset + 4);
  chunks.push({ type, data: source.subarray(offset + 8, offset + 8 + length) });
  offset += 8 + length;
}

const JSON_CHUNK_TYPE = 0x4e4f534a;
const jsonChunk = chunks.find(({ type }) => type === JSON_CHUNK_TYPE);
if (jsonChunk === undefined) {
  throw new Error(`Missing JSON chunk: ${inputPath}`);
}
const document = JSON.parse(jsonChunk.data.toString("utf8"));
const extensionName = "KHR_materials_pbrSpecularGlossiness";

for (const material of document.materials ?? []) {
  const legacy = material.extensions?.[extensionName];
  if (legacy === undefined) {
    continue;
  }
  material.pbrMetallicRoughness = {
    baseColorFactor: legacy.diffuseFactor ?? [1, 1, 1, 1],
    baseColorTexture: legacy.diffuseTexture,
    metallicFactor: 0.04,
    roughnessFactor: Math.max(0.18, 1 - (legacy.glossinessFactor ?? 0.5)),
  };
  delete material.extensions.KHR_materials_pbrSpecularGlossiness;
  if (Object.keys(material.extensions).length === 0) {
    delete material.extensions;
  }
}

if (Array.isArray(document.extensionsUsed)) {
  document.extensionsUsed = document.extensionsUsed.filter(
    (name) => name !== extensionName,
  );
  if (document.extensionsUsed.length === 0) {
    delete document.extensionsUsed;
  }
}
if (Array.isArray(document.extensionsRequired)) {
  document.extensionsRequired = document.extensionsRequired.filter(
    (name) => name !== extensionName,
  );
  if (document.extensionsRequired.length === 0) {
    delete document.extensionsRequired;
  }
}

const jsonBytes = Buffer.from(JSON.stringify(document), "utf8");
const paddedJsonLength = Math.ceil(jsonBytes.length / 4) * 4;
const paddedJson = Buffer.alloc(paddedJsonLength, 0x20);
jsonBytes.copy(paddedJson);
jsonChunk.data = paddedJson;

const totalLength =
  12 + chunks.reduce((total, chunk) => total + 8 + chunk.data.length, 0);
const output = Buffer.alloc(totalLength);
output.write("glTF", 0, 4, "ascii");
output.writeUInt32LE(2, 4);
output.writeUInt32LE(totalLength, 8);
offset = 12;
for (const chunk of chunks) {
  output.writeUInt32LE(chunk.data.length, offset);
  output.writeUInt32LE(chunk.type, offset + 4);
  chunk.data.copy(output, offset + 8);
  offset += 8 + chunk.data.length;
}

await writeFile(outputPath, output);
