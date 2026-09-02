import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ScenePlanInput } from "@dalang/core";
import type {
  AsrProvider,
  StockCandidate,
  StockProvider,
  TtsProvider,
} from "@dalang/pipeline";
import type { RenderVideoResult } from "@dalang/renderer";
import { MockLanguageModelV3 } from "ai/test";
import type { ModelInfo } from "../src/models/registry";
import type { ResolvedModel } from "../src/models/resolve";
import { type ApprovalFn, Guardrails } from "../src/runtime/guardrails";
import { ProjectSession } from "../src/runtime/session";
import type { AgentDeps } from "../src/tools";

// ---------------------------------------------------------------------------
// Proyek sementara
// ---------------------------------------------------------------------------

export const basicPlan = (overrides: Partial<ScenePlanInput> = {}): ScenePlanInput => ({
  version: 1,
  projectId: "proj-agent-test",
  meta: { title: "Uji Agent" },
  audio: { voice: { provider: "silence", voiceId: "v", speed: 1 } },
  scenes: [
    {
      id: "sc-001",
      narration: "Kalimat pertama untuk agent.",
      visual: { type: "stock", query: "candi jawa" },
    },
    {
      id: "sc-002",
      narration: "Kalimat kedua yang sedikit lebih panjang.",
      visual: { type: "solid" },
    },
  ],
  ...overrides,
});

export const tempProject = (
  plan: ScenePlanInput | null,
): { dir: string; planPath: string; session: ProjectSession; cleanup: () => void } => {
  const dir = mkdtempSync(join(tmpdir(), "dalang-agent-test-"));
  const planPath = join(dir, "plan.json");
  if (plan) writeFileSync(planPath, JSON.stringify(plan, null, 2));
  const session = ProjectSession.open(planPath);
  return {
    dir,
    planPath,
    session,
    cleanup: () => {
      session.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
};

// ---------------------------------------------------------------------------
// Model mock terskrip (AI SDK V3 spec)
// ---------------------------------------------------------------------------

export const V3_USAGE = {
  inputTokens: {
    total: 1000,
    noCache: 1000,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 100, text: 100, reasoning: undefined },
  raw: undefined,
};

let toolCallCounter = 0;

export const textStep = (text: string) => ({
  content: [{ type: "text" as const, text }],
  finishReason: { unified: "stop" as const, raw: undefined },
  usage: V3_USAGE,
  warnings: [],
});

export const toolCallStep = (toolName: string, input: unknown) => ({
  content: [
    {
      type: "tool-call" as const,
      toolCallId: `call-${++toolCallCounter}`,
      toolName,
      input: JSON.stringify(input),
    },
  ],
  finishReason: { unified: "tool-calls" as const, raw: undefined },
  usage: V3_USAGE,
  warnings: [],
});

type Step = ReturnType<typeof textStep> | ReturnType<typeof toolCallStep>;

export const scriptedModel = (steps: Step[] | (() => Step)): MockLanguageModelV3 =>
  new MockLanguageModelV3({
    provider: "mock",
    modelId: "scripted",
    doGenerate: Array.isArray(steps) ? steps : async () => steps(),
  });

/** Info registry mock: $1/$5 per MTok → biaya per langkah (1000/100 token) = $0.0015. */
export const SCRIPTED_INFO: ModelInfo = {
  key: "mock/scripted",
  provider: "mock",
  id: "scripted",
  name: "Scripted",
  toolCall: true,
  imageInput: true,
  reasoning: false,
  costInputPerMTok: 1,
  costOutputPerMTok: 5,
};

export const COST_PER_STEP = (1000 * 1 + 100 * 5) / 1_000_000; // 0.0015

export const resolvedScripted = (
  steps: Step[] | (() => Step),
  info: ModelInfo | undefined = SCRIPTED_INFO,
): ResolvedModel => ({ key: "mock/scripted", model: scriptedModel(steps), info });

// ---------------------------------------------------------------------------
// Dependensi fake
// ---------------------------------------------------------------------------

/** Provider ASR palsu — offline supaya gerbang biaya tidak ikut terpicu. */
export const fakeAsr = (
  id = "asr-palsu",
  options: { offline?: boolean } = {},
): AsrProvider & { calls: string[] } => {
  const provider: AsrProvider & { calls: string[] } = {
    id,
    label: `ASR palsu ${id}`,
    offline: options.offline ?? true,
    calls: [],
    transcribe: async (request) => {
      provider.calls.push(request.file);
      return {
        words: [
          { word: "halo", startSec: 0, endSec: 0.5 },
          { word: "dunia", startSec: 0.6, endSec: 1.2 },
        ],
        segments: [{ startSec: 0, endSec: 1.2, text: "halo dunia" }],
        language: "id",
        durationSec: 1.2,
        costUsd: 0.02,
      };
    },
  };
  return provider;
};

export const fakeTts = (id = "tts-palsu"): TtsProvider & { calls: string[] } => {
  const provider = {
    id,
    label: `Fake ${id}`,
    placeholderQuality: false,
    calls: [] as string[],
    synthesize: (request: { text: string }) => {
      provider.calls.push(request.text);
      return Promise.resolve({
        audio: new Uint8Array([1, 2, 3]),
        format: "wav" as const,
        durationSec: 2,
        wordTimestamps: [{ word: "Kata", startSec: 0, endSec: 0.4 }],
        timestampsSource: "native" as const,
        costUsd: 0.01,
      });
    },
  };
  return provider;
};

export const fakeStock = (
  id = "stock-palsu",
): StockProvider & { downloads: string[] } => {
  const provider = {
    id,
    label: `Fake ${id}`,
    downloads: [] as string[],
    search: (request: { query: string; kind: "video" | "image" }) => {
      const candidate: StockCandidate = {
        providerId: id,
        assetId: `${id}:${request.kind}:7`,
        kind: request.kind,
        downloadUrl: "https://example.test/a",
        fileExt: request.kind === "video" ? "mp4" : "jpg",
        width: 1080,
        height: 1920,
        license: "Uji License",
        author: "Penguji",
      };
      return Promise.resolve([candidate]);
    },
    download: (candidate: StockCandidate) => {
      provider.downloads.push(candidate.assetId);
      return Promise.resolve(new Uint8Array([9, 9]));
    },
  };
  return provider;
};

export const fakeRender = (): AgentDeps["renderVideo"] & {
  calls: Array<{ profile: string; outputLocation: string; useProxies?: boolean }>;
} => {
  const calls: Array<{ profile: string; outputLocation: string; useProxies?: boolean }> =
    [];
  const fn = (async (options: {
    planPath: string;
    outputLocation: string;
    profile: "draft" | "final";
    useProxies?: boolean;
  }): Promise<RenderVideoResult> => {
    calls.push({
      profile: options.profile,
      outputLocation: options.outputLocation,
      ...(options.useProxies !== undefined ? { useProxies: options.useProxies } : {}),
    });
    return {
      outputLocation: options.outputLocation,
      durationInFrames: 1500,
      durationSec: 50,
      sizeBytes: 2_000_000,
      width: 540,
      height: 960,
      bundleFromCache: true,
      settings: { format: "mp4", resolution: 540, quality: "cepat" },
    };
  }) as AgentDeps["renderVideo"] & { calls: typeof calls };
  fn.calls = calls;
  return fn;
};

export interface ApprovalRecorder {
  approve: ApprovalFn;
  requests: Array<{ action: string; detail: string }>;
}

export const approvalRecorder = (answer: boolean): ApprovalRecorder => {
  const requests: Array<{ action: string; detail: string }> = [];
  return {
    requests,
    approve: (request) => {
      requests.push({ action: request.action, detail: request.detail });
      return Promise.resolve(answer);
    },
  };
};

/** PNG 1x1 yang SAH — dibaca tool lalu dikirim sebagai gambar. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export const makeDeps = (
  overrides: Partial<AgentDeps> & { approvalAnswer?: boolean } = {},
): {
  deps: AgentDeps;
  approvals: ApprovalRecorder;
  render: ReturnType<typeof fakeRender>;
} => {
  const approvals = approvalRecorder(overrides.approvalAnswer ?? true);
  const render = fakeRender();
  const deps: AgentDeps = {
    guards: overrides.guards ?? new Guardrails({}, approvals.approve),
    ttsChainFor: overrides.ttsChainFor ?? (() => [fakeTts()]),
    stockChain: overrides.stockChain ?? (() => [fakeStock()]),
    stickerChain: overrides.stickerChain ?? (() => [fakeStock("giphy")]),
    renderVideo: overrides.renderVideo ?? render,
    videoMetadata:
      overrides.videoMetadata ??
      (async (file) =>
        file.endsWith(".mp4") ? { durationSec: 600, width: 1920, height: 1080 } : null),
    // Rantai ASR bawaan KOSONG: itu keadaan mesin polos, dan yang paling
    // sering. Tes yang membutuhkan transkripsi menyuntikkan rantainya sendiri.
    asrChain: overrides.asrChain ?? (() => []),
    // Render frame palsu: menulis PNG 1x1 yang SAH, bukan berkas kosong —
    // tool membacanya lalu mengirimnya sebagai gambar, jadi berkas rusak akan
    // menguji jalur yang salah.
    renderStills:
      overrides.renderStills ??
      (async ({ frames, outDir }) => {
        mkdirSync(outDir, { recursive: true });
        return frames.map((frame) => {
          const file = join(outDir, `frame-${frame}.png`);
          writeFileSync(file, PNG_1X1);
          return file;
        });
      }),
    detectSilence:
      overrides.detectSilence ??
      (async (file) =>
        file.endsWith(".mp4")
          ? {
              durationSec: 600,
              silences: [
                { startSec: 0, endSec: 0.8 },
                { startSec: 64.2, endSec: 65.1 },
                { startSec: 402, endSec: 402.6 },
              ],
              audible: [
                { startSec: 0.8, endSec: 64.2 },
                { startSec: 65.1, endSec: 402 },
                { startSec: 402.6, endSec: 600 },
              ],
            }
          : null),
    iconProvider:
      overrides.iconProvider ??
      (() => ({
        id: "iconify",
        label: "Iconify",
        search: async (query: string, limit: number) =>
          Array.from({ length: Math.min(limit, 3) }, (_, i) => ({
            providerId: "iconify",
            iconId: `mdi:${query}-${i}`,
            setPrefix: "mdi",
            setName: "Material Design Icons",
            license: "Apache 2.0",
            licenseSpdx: "Apache-2.0",
            needsAttribution: true,
            commercialSafe: true,
          })),
        fetchSvg: async () => '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>',
      })),
    sfxChain:
      overrides.sfxChain ??
      (() => [
        {
          id: "openverse",
          label: "Openverse",
          search: async (query: string, limit: number) =>
            Array.from({ length: Math.min(limit, 2) }, (_, i) => ({
              providerId: "openverse",
              assetId: `openverse:${query}-${i}`,
              title: `${query} ${i}`,
              downloadUrl: `https://cdn.test/${query}-${i}.mp3`,
              fileExt: "mp3",
              durationSec: 1.2,
              license: "cc0 1.0",
              commercialSafe: true,
            })),
          download: async () => new Uint8Array([1, 2, 3]),
        },
      ]),
    saveMedia:
      overrides.saveMedia ??
      (async ({ folder, name, fileExt }) => `assets/${folder}/${name}.${fileExt}`),
    volumeModel: overrides.volumeModel,
    ...(overrides.transcoder ? { transcoder: overrides.transcoder } : {}),
    onToolActivity: () => {},
  };
  return { deps, approvals, render };
};

export const execOptions = { toolCallId: "t-1", messages: [] } as never;
