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
        audio: new Uint8Array([1, 2, 3, 4]),
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
