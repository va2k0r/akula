import {
  closeSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatSfxAuditionReport,
  SFX_APPROVED_ITEM_NUMBERS,
  SFX_AUDITION_DECISIONS,
  SFX_AUDITION_ITEMS,
  SFX_REJECTED_ITEM_NUMBERS,
  type SfxAuditionDecision,
} from "../src/ui/sfxAuditionCatalog";

const RESEARCH_DIRECTORY = "assets/research/submarine-sfx-2026-08-17";

describe("numbered research SFX audition catalog", () => {
  it("maps all 37 manifest masters to stable numbers and unique paths", () => {
    const manifest = readManifest();

    expect(SFX_AUDITION_ITEMS).toHaveLength(37);
    expect(SFX_AUDITION_ITEMS.map(({ number }) => number)).toEqual(
      Array.from({ length: 37 }, (_, index) => index + 1),
    );
    expect(new Set(SFX_AUDITION_ITEMS.map(({ id }) => id)).size).toBe(37);
    expect(
      new Set(SFX_AUDITION_ITEMS.map(({ assetPath }) => assetPath)).size,
    ).toBe(37);

    for (const item of SFX_AUDITION_ITEMS) {
      const source = manifest.get(item.id);
      expect(source).toBeDefined();
      expect(item.assetPath).toBe(
        `/${RESEARCH_DIRECTORY}/${source?.localPath ?? "missing"}`,
      );
    }
  });

  it("points only to verified mono 48 kHz 24-bit PCM WAV masters", () => {
    for (const item of SFX_AUDITION_ITEMS) {
      const filePath = join(process.cwd(), item.assetPath.slice(1));
      const wave = readWaveHeader(filePath);

      expect(wave.fileBytes).toBeGreaterThan(0);
      expect(wave.format).toBe(1);
      expect(wave.channels).toBe(1);
      expect(wave.sampleRate).toBe(48_000);
      expect(wave.bitDepth).toBe(24);
      expect(wave.durationSeconds).toBeCloseTo(item.durationSeconds, 3);
    }
  });

  it("creates a numbered report with keep, reject, and undecided sections", () => {
    const decisions: Record<string, SfxAuditionDecision> = {
      "usc-g45-10": "keep",
      "usc-g45-11": "reject",
    };
    const report = formatSfxAuditionReport(decisions);

    expect(report).toContain("TIENI\n01 — Battaglia a bordo del sommergibile");
    expect(report).toContain("SCARTA\n02 — Carica di profondità");
    expect(report).toContain("INCERTI\n03 — Esplosioni da missile");
    expect(report).toContain("37 — Accensione razzo V2");
  });

  it("locks the completed 28 keep / 9 reject listening decision", () => {
    const selection = readSelection();

    expect(SFX_APPROVED_ITEM_NUMBERS).toHaveLength(28);
    expect(SFX_REJECTED_ITEM_NUMBERS).toHaveLength(9);
    expect(selection).toHaveLength(37);
    expect(
      Object.values(SFX_AUDITION_DECISIONS).filter(
        (decision) => decision === "undecided",
      ),
    ).toHaveLength(0);

    for (const item of SFX_AUDITION_ITEMS) {
      const selectionRow = selection.find(({ assetId }) => assetId === item.id);
      expect(selectionRow).toEqual({
        number: item.number,
        assetId: item.id,
        decision: SFX_AUDITION_DECISIONS[item.id],
        title: item.title,
      });
    }

    const report = formatSfxAuditionReport(SFX_AUDITION_DECISIONS);
    expect(report).toContain("TIENI\n02 — Carica di profondità");
    expect(report).toContain("SCARTA\n01 — Battaglia a bordo del sommergibile");
    expect(report).toContain("INCERTI\n—");
  });
});

interface ManifestEntry {
  readonly localPath: string;
}

interface SelectionEntry {
  readonly number: number;
  readonly assetId: string;
  readonly decision: SfxAuditionDecision;
  readonly title: string;
}

function readManifest(): ReadonlyMap<string, ManifestEntry> {
  const manifestPath = join(process.cwd(), RESEARCH_DIRECTORY, "MANIFEST.tsv");
  const [headerLine, ...lines] = readFileSync(manifestPath, "utf8")
    .trim()
    .split("\n");
  const headers = headerLine?.split("\t") ?? [];
  const idIndex = headers.indexOf("asset_id");
  const localPathIndex = headers.indexOf("local_path");
  expect(idIndex).toBeGreaterThanOrEqual(0);
  expect(localPathIndex).toBeGreaterThanOrEqual(0);

  return new Map(
    lines.map((line) => {
      const fields = line.split("\t");
      const id = fields[idIndex];
      const localPath = fields[localPathIndex];
      if (id === undefined || localPath === undefined) {
        throw new Error(`Malformed SFX manifest row: ${line}`);
      }
      return [id, { localPath }] as const;
    }),
  );
}

function readSelection(): readonly SelectionEntry[] {
  const selectionPath = join(
    process.cwd(),
    RESEARCH_DIRECTORY,
    "SELECTION.tsv",
  );
  const [headerLine, ...lines] = readFileSync(selectionPath, "utf8")
    .trim()
    .split("\n");
  expect(headerLine).toBe("number\tasset_id\tdecision\ttitle");
  return lines.map((line) => {
    const [number, assetId, decision, title] = line.split("\t");
    if (
      number === undefined ||
      assetId === undefined ||
      decision === undefined ||
      title === undefined ||
      (decision !== "keep" && decision !== "reject")
    ) {
      throw new Error(`Malformed SFX selection row: ${line}`);
    }
    return {
      number: Number(number),
      assetId,
      decision,
      title,
    };
  });
}

interface WaveHeader {
  readonly fileBytes: number;
  readonly format: number;
  readonly channels: number;
  readonly sampleRate: number;
  readonly bitDepth: number;
  readonly durationSeconds: number;
}

function readWaveHeader(filePath: string): WaveHeader {
  const descriptor = openSync(filePath, "r");
  try {
    const fileBytes = fstatSync(descriptor).size;
    const header = Buffer.alloc(Math.min(fileBytes, 65_536));
    readSync(descriptor, header, 0, header.length, 0);
    expect(header.toString("ascii", 0, 4)).toBe("RIFF");
    expect(header.toString("ascii", 8, 12)).toBe("WAVE");

    let format = 0;
    let channels = 0;
    let sampleRate = 0;
    let bitDepth = 0;
    let dataBytes = 0;
    let offset = 12;
    while (offset + 8 <= header.length) {
      const chunkId = header.toString("ascii", offset, offset + 4);
      const chunkBytes = header.readUInt32LE(offset + 4);
      if (chunkId === "fmt " && offset + 24 <= header.length) {
        format = header.readUInt16LE(offset + 8);
        channels = header.readUInt16LE(offset + 10);
        sampleRate = header.readUInt32LE(offset + 12);
        bitDepth = header.readUInt16LE(offset + 22);
      }
      if (chunkId === "data") {
        dataBytes = chunkBytes;
        break;
      }
      offset += 8 + chunkBytes + (chunkBytes % 2);
    }

    if (dataBytes <= 0 || channels <= 0 || sampleRate <= 0 || bitDepth <= 0) {
      throw new Error(`Incomplete WAV header: ${filePath}`);
    }
    return {
      fileBytes,
      format,
      channels,
      sampleRate,
      bitDepth,
      durationSeconds: dataBytes / (sampleRate * channels * (bitDepth / 8)),
    };
  } finally {
    closeSync(descriptor);
  }
}
