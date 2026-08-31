import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ScenePlanInput } from "@dalang/core";
import type { StockCandidate, StockProvider, TtsProvider } from "../src/index";

export const makeTempProject = (
  plan: ScenePlanInput,
): { dir: string; planPath: string; cleanup: () => void } => {
  const dir = mkdtempSync(join(tmpdir(), "dalang-pipeline-test-"));
  const planPath = join(dir, "plan.json");
  writeFileSync(planPath, JSON.stringify(plan, null, 2));
  return {
    dir,
    planPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
};

export const basicPlan = (overrides: Partial<ScenePlanInput> = {}): ScenePlanInput => ({
  version: 1,
  projectId: "proj-pipeline-test",
  meta: { title: "Uji Pipeline" },
  audio: { voice: { provider: "silence", voiceId: "v-test", speed: 1 } },
  scenes: [
    {
      id: "sc-001",
      narration: "Kalimat pertama untuk diuji.",
      visual: { type: "stock", query: "candi jawa" },
    },
    {
      id: "sc-002",
      narration: "Kalimat kedua sedikit lebih panjang lagi.",
      visual: { type: "solid" },
    },
  ],
  ...overrides,
});

/**
 * WAV 16-bit mono 1 detik berisi nada pelan.
 *
 * Bukan empat byte acak seperti sebelumnya: sejak ADR-0026 pipeline benar-benar
 * MEMBACA berkas narasi untuk mengukur kenyaringannya, jadi fixture yang bukan
 * WAV sah membuat tahap ukur gagal pada alur yang seharusnya mulus — dan
 * fixture yang sah justru membuat jalur itu ikut teruji.
 */
export const tinyWav = (seconds = 1, sampleRate = 8000): Uint8Array => {
  const frames = seconds * sampleRate;
  const bytes = new Uint8Array(44 + frames * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + frames * 2, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) {
    view.setInt16(
      44 + i * 2,
      Math.round(6000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)),
      true,
    );
  }
  return bytes;
};

export interface FakeTts extends TtsProvider {
  calls: string[];
}

export const fakeTts = (
  id: string,
  options: { fail?: boolean; placeholder?: boolean } = {},
): FakeTts => {
  const provider: FakeTts = {
    id,
    label: `Fake ${id}`,
    placeholderQuality: options.placeholder ?? false,
    calls: [],
    synthesize: (request) => {
      provider.calls.push(request.text);
      if (options.fail) {
        return Promise.reject(new Error(`${id} sengaja gagal`));
      }
      return Promise.resolve({
        audio: tinyWav(),
        format: "wav" as const,
        durationSec: 2.5,
        wordTimestamps: [{ word: "Kata", startSec: 0, endSec: 0.5 }],
        timestampsSource: "native" as const,
        costUsd: 0.01,
      });
    },
  };
  return provider;
};

export interface FakeStock extends StockProvider {
  searchCalls: Array<{ query: string; kind: string }>;
  downloadCalls: string[];
}

export const fakeStock = (
  id: string,
  options: {
    failSearch?: boolean;
    kinds?: Array<"video" | "image">;
  } = {},
): FakeStock => {
  const kinds = options.kinds ?? ["video", "image"];
  const provider: FakeStock = {
    id,
    label: `Fake ${id}`,
    searchCalls: [],
    downloadCalls: [],
    search: (request) => {
      provider.searchCalls.push({ query: request.query, kind: request.kind });
      if (options.failSearch) {
        return Promise.reject(new Error(`${id} search gagal`));
      }
      if (!kinds.includes(request.kind)) return Promise.resolve([]);
      const candidate: StockCandidate = {
        providerId: id,
        assetId: `${id}:${request.kind}:42`,
        kind: request.kind,
        downloadUrl: `https://example.test/${request.kind}.bin`,
        fileExt: request.kind === "video" ? "mp4" : "jpg",
        width: 1080,
        height: 1920,
        license: `${id} License`,
        author: "Penguji",
        sourceUrl: `https://example.test/${id}/42`,
      };
      return Promise.resolve([candidate]);
    },
    download: (candidate) => {
      provider.downloadCalls.push(candidate.assetId);
      return Promise.resolve(new Uint8Array([9, 9, 9]));
    },
  };
  return provider;
};

export const silentLog = { info: () => {}, warn: () => {} };
