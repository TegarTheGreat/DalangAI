import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveModel } from "@dalang/agent";
import type { ScenePlanInput } from "@dalang/core";
import type { StockCandidate, StockProvider, TtsProvider } from "@dalang/pipeline";
import type { SseEvent } from "../src/app/sse";
import { SseParser } from "../src/app/sse";
import type { StudioDeps } from "../src/server/context";
import { createStudioApp, type Studio, StudioHost } from "../src/server/index";

/** Plan kecil 3 scene: title (template-anim), body stock, body image lokal. */
export const makePlan = (): ScenePlanInput => ({
  version: 1,
  projectId: "proyek-uji",
  meta: {
    title: "Uji Studio",
    aspectRatio: "9:16",
    language: "id",
    stylePreset: "documentary-01",
  },
  audio: { voice: { provider: "silence", voiceId: "uji", speed: 1 } },
  scenes: [
    {
      id: "sc-judul",
      narration: "",
      visual: { type: "template-anim", variant: "title" },
    },
    {
      id: "sc-batu",
      narration: "Candi batu berdiri sejak dua belas abad silam.",
      visual: { type: "stock", query: "ancient stone temple" },
    },
    {
      id: "sc-peta",
      narration: "Letaknya di jantung Jawa bagian tengah.",
      visual: { type: "image" },
      locked: false,
    },
  ],
  renderState: { narrationAudio: {}, resolvedAssets: {} },
});

export const makeTempProject = (): { dir: string; planPath: string } => {
  const dir = mkdtempSync(join(tmpdir(), "dalang-studio-"));
  const planPath = join(dir, "plan.json");
  writeFileSync(planPath, JSON.stringify(makePlan(), null, 2));
  return { dir, planPath };
};

/** WAV PCM hening singkat yang valid. */
const silentWav = (): Uint8Array => {
  const samples = 800;
  const data = new Uint8Array(44 + samples * 2);
  const view = new DataView(data.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) data[offset + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples * 2, true);
  return data;
};

export const fakeTts = (options?: {
  delayMs?: number;
  costUsd?: number;
}): TtsProvider => ({
  id: "fake-tts",
  label: "TTS Palsu",
  placeholderQuality: false,
  synthesize: async ({ text }) => {
    if (options?.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
    return {
      audio: silentWav(),
      format: "wav",
      durationSec: 2.5,
      wordTimestamps: text
        .split(/\s+/)
        .filter(Boolean)
        .map((word, index) => ({
          word,
          startSec: index * 0.4,
          endSec: index * 0.4 + 0.35,
        })),
      timestampsSource: "native",
      costUsd: options?.costUsd ?? 0,
    };
  },
});

const PIXEL_JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9]);

export const fakeStock = (): StockProvider => {
  const candidates: StockCandidate[] = [0, 1, 2].map((index) => ({
    providerId: "fake-stock",
    assetId: `fake:image:${index}`,
    kind: "image",
    downloadUrl: `https://example.test/${index}.jpg`,
    fileExt: "jpg",
    width: 1080,
    height: 1920,
    author: `Fotografer ${index}`,
    license: "Uji License",
    thumbnailUrl: `https://example.test/thumb-${index}.jpg`,
  }));
  return {
    id: "fake-stock",
    label: "Stock Palsu",
    search: async () => candidates,
    download: async () => PIXEL_JPG,
  };
};

/** Stiker palsu: kandidat berlisensi bertanda perlu-diperiksa, seperti aslinya. */
export const fakeSticker = (): StockProvider => {
  const candidates: StockCandidate[] = [0, 1].map((index) => ({
    providerId: "giphy",
    assetId: `giphy:sticker:${index}`,
    kind: "image",
    downloadUrl: `https://media.test/sticker-${index}.webp`,
    fileExt: "webp",
    width: 480,
    height: 480,
    license: "GIPHY - PERIKSA HAK PAKAI sebelum dipakai komersial",
    thumbnailUrl: `https://media.test/sticker-${index}-thumb.webp`,
  }));
  return {
    id: "giphy",
    label: "GIPHY Stiker",
    search: async () => candidates,
    download: async () => PIXEL_JPG,
  };
};

export interface StudioOverrides {
  ttsDelayMs?: number;
  guardrails?: Parameters<typeof createStudioApp>[0]["guardrails"];
  renderDelayMs?: number;
  renderFail?: boolean;
  noOrchestrator?: boolean;
  /** Rantai ASR (ADR-0021); bawaannya kosong = mesin tanpa jalur transkripsi. */
  asrChain?: StudioDeps["asrChain"];
  renderStills?: StudioDeps["renderStills"];
}

export const fakeDeps = (overrides?: StudioOverrides): StudioDeps => ({
  ttsChainFor: () => [
    fakeTts(overrides?.ttsDelayMs !== undefined ? { delayMs: overrides.ttsDelayMs } : {}),
  ],
  stockChain: () => [fakeStock()],
  stickerChain: () => [fakeSticker()],
  // Rantai ASR kosong = keadaan mesin polos; tes yang butuh transkripsi
  // menyuntikkan rantainya sendiri lewat override.
  asrChain: overrides?.asrChain ?? (() => []),
  renderStills: overrides?.renderStills ?? (async () => []),
  probeVideo: async (_planPath, file) =>
    file.endsWith(".mp4") ? { durationSec: 600, width: 1920, height: 1080 } : null,
  iconProvider: () => ({
    id: "iconify",
    label: "Iconify",
    search: async (query: string, limit: number) =>
      Array.from({ length: Math.min(limit, 3) }, (_, i) => ({
        providerId: "iconify",
        iconId: `mdi:${query}-${i}`,
        setPrefix: "mdi",
        setName: "Material Design Icons",
        license: "MIT",
        licenseSpdx: "MIT",
        needsAttribution: false,
        commercialSafe: true,
      })),
    fetchSvg: async () => '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>',
  }),
  sfxChain: () => [
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
          license: "cc0 1.0",
          commercialSafe: true,
        })),
      download: async () => new Uint8Array([1]),
    },
  ],
  saveMedia: async (_planPath, media) =>
    `assets/${media.folder}/${media.name}.${media.fileExt}`,
  detectSilence: async (_planPath, file) =>
    file.endsWith(".mp4")
      ? {
          durationSec: 600,
          silences: [{ startSec: 0, endSec: 0.8 }],
          audible: [{ startSec: 0.8, endSec: 600 }],
        }
      : null,
  renderVideo: async ({ outputLocation }) => {
    if (overrides?.renderDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, overrides.renderDelayMs));
    }
    if (overrides?.renderFail) throw new Error("render gagal (uji)");
    const { mkdirSync, writeFileSync: write } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(outputLocation), { recursive: true });
    write(outputLocation, "mp4-uji");
    return {
      outputLocation,
      sizeBytes: 7,
      durationSec: 12,
      durationInFrames: 360,
      width: 1080,
      height: 1920,
      bundleFromCache: true,
      settings: { format: "mp4", resolution: 540, quality: "cepat" } as const,
    };
  },
  ...(overrides?.noOrchestrator
    ? { chatDisabledReason: "butuh API key (uji)" }
    : { orchestrator: resolveModel("mock/echo") }),
  registrySource: "uji",
});

export const makeStudio = (planPath: string, overrides?: StudioOverrides): Studio =>
  createStudioApp({
    planPath,
    guardrails: overrides?.guardrails ?? {},
    approvalTimeoutMs: 2000,
    deps: fakeDeps(overrides),
  });

/** Host lobi: satu port, banyak proyek. `planPath` kosong = mulai di lobi. */
export const makeHost = (
  workspaceRoot: string,
  planPath?: string,
  overrides?: StudioOverrides,
): StudioHost =>
  new StudioHost({
    workspaceRoot,
    ...(planPath ? { planPath } : {}),
    approvalTimeoutMs: 2000,
    deps: fakeDeps(overrides),
  });

export const hostCall = (
  host: StudioHost,
  path: string,
  init?: RequestInit,
): Promise<Response> =>
  Promise.resolve(
    host.app.fetch(
      new Request(`http://studio.local${path}`, {
        ...init,
        ...(init?.body ? { headers: { "content-type": "application/json" } } : {}),
      }),
    ),
  );

export const hostJson = async <T>(
  host: StudioHost,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: T }> => {
  const response = await hostCall(host, path, init);
  return { status: response.status, body: (await response.json()) as T };
};

export const postJson = (body: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
});

/** Fetch langsung ke app.fetch (tanpa port TCP). */
export const call = (
  studio: Studio,
  path: string,
  init?: RequestInit,
): Promise<Response> =>
  Promise.resolve(
    studio.app.fetch(
      new Request(`http://studio.local${path}`, {
        ...init,
        ...(init?.body ? { headers: { "content-type": "application/json" } } : {}),
      }),
    ),
  );

export const callJson = async <T>(
  studio: Studio,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: T }> => {
  const response = await call(studio, path, init);
  return { status: response.status, body: (await response.json()) as T };
};

/** Kumpulkan event SSE dari sebuah Response stream. */
export const collectSse = async (
  response: Response,
  until: (events: SseEvent[]) => boolean,
  timeoutMs = 5000,
): Promise<SseEvent[]> => {
  if (!response.body) throw new Error("Respons tanpa body stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  const events: SseEvent[] = [];
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline)
      throw new Error(`SSE timeout; events: ${JSON.stringify(events)}`);
    const { done, value } = await reader.read();
    if (done) break;
    events.push(...parser.push(decoder.decode(value, { stream: true })));
    if (until(events)) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return events;
};
