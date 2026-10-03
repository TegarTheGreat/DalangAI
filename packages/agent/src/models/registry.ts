import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { MODELS_SNAPSHOT, MODELS_SNAPSHOT_DATE } from "./snapshot";
import { SYNTHETIC_PROVIDERS } from "./synthetic-providers";

/**
 * Registry model dari models.dev (PRD §4.2, §6.4): metadata harga +
 * kapabilitas untuk (1) memfilter model yang layak per tier — tool-calling
 * wajib untuk orkestrasi, image-input wajib untuk tugas vision — dan (2)
 * estimasi biaya per giliran/tool call.
 *
 * Urutan sumber: fetch api.json → cache lokal (TTL 24 jam, PRD: refresh
 * harian) → cache basi → snapshot bundled. api.json adalah DATA EKSTERNAL:
 * diparse defensif entry-per-entry; entri rusak dilewati, tidak meruntuhkan
 * loader, dan tidak ada apa pun darinya yang dieksekusi.
 *
 * Selain model, registry membawa METADATA PROVIDER (paket SDK, base URL, nama
 * env var kredensial). Dari sanalah providers.ts tahu cara memanggil ratusan
 * provider tanpa satu pun dikodekan tangan — lihat ADR-0044.
 */

const MODELS_DEV_URL = "https://models.dev/api.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const modelEntrySchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    tool_call: z.boolean().optional(),
    reasoning: z.boolean().optional(),
    modalities: z
      .object({
        input: z.array(z.string()).optional(),
        output: z.array(z.string()).optional(),
      })
      .loose()
      .optional(),
    limit: z
      .object({
        context: z.number().optional(),
        output: z.number().optional(),
      })
      .loose()
      .optional(),
    cost: z
      .object({
        input: z.number().optional(),
        output: z.number().optional(),
        cache_read: z.number().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

// Metadata provider didegradasi per-field: npm/api/doc yang bentuknya salah
// hilang begitu saja, TANPA ikut membuang model-model provider itu.
const providerEntrySchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    npm: z.string().optional().catch(undefined),
    api: z.string().optional().catch(undefined),
    doc: z.string().optional().catch(undefined),
    env: z.array(z.string()).optional().catch(undefined),
    models: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

export interface ModelInfo {
  /** "provider/model-id", mis. "anthropic/claude-opus-5". */
  key: string;
  provider: string;
  id: string;
  name: string;
  toolCall: boolean;
  imageInput: boolean;
  reasoning: boolean;
  contextTokens?: number;
  /** Batas token keluaran per respons, bila registry memuatnya. */
  outputTokens?: number;
  /** USD per 1 juta token. */
  costInputPerMTok?: number;
  costOutputPerMTok?: number;
}

/** Metadata provider dari registry — bahan providers.ts untuk memanggilnya. */
export interface ProviderInfo {
  id: string;
  name: string;
  /** Paket AI SDK yang dipakai registry, mis. "@ai-sdk/openai-compatible". */
  npm?: string;
  /** Base URL API; kosong bila SDK-nya sudah tahu sendiri. Bisa memuat ${VAR}. */
  api?: string;
  /** Nama env var kredensial/konfigurasi, urutan seperti di registry. */
  env: string[];
  doc?: string;
  modelCount: number;
}

export type RegistrySource = "network" | "cache" | "stale-cache" | "snapshot";

export interface ModelRegistry {
  models: ModelInfo[];
  providers: ProviderInfo[];
  source: RegistrySource;
  snapshotDate: string;
  find(key: string): ModelInfo | undefined;
  /** Provider menurut id registry, atau yang bawaan lokal (mis. ollama). */
  provider(id: string): ProviderInfo | undefined;
}

export interface ParsedRegistry {
  models: ModelInfo[];
  providers: ProviderInfo[];
}

/** Parse defensif: entri yang tidak sesuai bentuk dilewati diam-diam. */
export const parseRegistryData = (raw: unknown): ParsedRegistry => {
  const models: ModelInfo[] = [];
  const providers: ProviderInfo[] = [];
  if (typeof raw !== "object" || raw === null) return { models, providers };
  for (const [providerKey, providerRaw] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    const provider = providerEntrySchema.safeParse(providerRaw);
    if (!provider.success || !provider.data.models) continue;
    let modelCount = 0;
    for (const [modelKey, modelRaw] of Object.entries(provider.data.models)) {
      const model = modelEntrySchema.safeParse(modelRaw);
      if (!model.success) continue;
      const entry = model.data;
      modelCount += 1;
      models.push({
        key: `${providerKey}/${modelKey}`,
        provider: providerKey,
        id: modelKey,
        name: entry.name ?? modelKey,
        toolCall: entry.tool_call ?? false,
        imageInput: entry.modalities?.input?.includes("image") ?? false,
        reasoning: entry.reasoning ?? false,
        contextTokens: entry.limit?.context,
        outputTokens: entry.limit?.output,
        costInputPerMTok: entry.cost?.input,
        costOutputPerMTok: entry.cost?.output,
      });
    }
    providers.push({
      id: providerKey,
      name: provider.data.name ?? providerKey,
      ...(provider.data.npm ? { npm: provider.data.npm } : {}),
      ...(provider.data.api ? { api: provider.data.api } : {}),
      env: provider.data.env ?? [],
      ...(provider.data.doc ? { doc: provider.data.doc } : {}),
      modelCount,
    });
  }
  return { models, providers };
};

/** Hanya modelnya — bentuk lama, dipertahankan untuk pemanggil yang tak butuh provider. */
export const parseModelsDev = (raw: unknown): ModelInfo[] =>
  parseRegistryData(raw).models;

const toRegistry = (parsed: ParsedRegistry, source: RegistrySource): ModelRegistry => {
  const byKey = new Map(parsed.models.map((model) => [model.key, model]));
  const byProvider = new Map(parsed.providers.map((provider) => [provider.id, provider]));
  return {
    models: parsed.models,
    providers: parsed.providers,
    source,
    snapshotDate: MODELS_SNAPSHOT_DATE,
    find: (key) => byKey.get(key),
    provider: (id) => byProvider.get(id) ?? SYNTHETIC_PROVIDERS[id],
  };
};

const agentCacheDir = (): string =>
  process.env.DALANG_CACHE_DIR ?? join(homedir(), ".cache", "dalang");

export interface LoadRegistryOptions {
  fetchImpl?: typeof fetch;
  cachePath?: string;
  ttlMs?: number;
  now?: () => number;
  /** Lewati jaringan sepenuhnya (offline eksplisit). */
  offline?: boolean;
}

export const loadModelRegistry = async ({
  fetchImpl = fetch,
  cachePath = join(agentCacheDir(), "models-dev.json"),
  ttlMs = CACHE_TTL_MS,
  now = Date.now,
  offline = false,
}: LoadRegistryOptions = {}): Promise<ModelRegistry> => {
  const readCache = (): ParsedRegistry | null => {
    try {
      if (!existsSync(cachePath)) return null;
      const parsed = parseRegistryData(JSON.parse(readFileSync(cachePath, "utf8")));
      return parsed.models.length > 0 ? parsed : null;
    } catch {
      return null;
    }
  };

  // Cache segar dulu — hemat & deterministik antar-run pada hari yang sama.
  try {
    if (existsSync(cachePath) && now() - statSync(cachePath).mtimeMs < ttlMs) {
      const cached = readCache();
      if (cached) return toRegistry(cached, "cache");
    }
  } catch {
    // stat gagal → lanjut ke jalur berikutnya
  }

  if (!offline) {
    try {
      const response = await fetchImpl(MODELS_DEV_URL, {
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        const json: unknown = await response.json();
        const parsed = parseRegistryData(json);
        if (parsed.models.length > 0) {
          try {
            mkdirSync(dirname(cachePath), { recursive: true });
            writeFileSync(cachePath, JSON.stringify(json));
          } catch {
            // gagal menulis cache bukan alasan menggagalkan loader
          }
          return toRegistry(parsed, "network");
        }
      }
    } catch {
      // jaringan gagal → cache basi → snapshot
    }
  }

  const stale = readCache();
  if (stale) return toRegistry(stale, "stale-cache");
  return toRegistry(parseRegistryData(MODELS_SNAPSHOT), "snapshot");
};

/**
 * Estimasi biaya LLM dari usage (token input/output × harga registry).
 * `null` bila harga model tidak diketahui — ditampilkan sebagai "tak
 * diketahui", tidak pernah dipalsukan jadi nol.
 */
export const estimateLlmCostUsd = (
  info: ModelInfo | undefined,
  usage: { inputTokens?: number; outputTokens?: number },
): number | null => {
  if (
    !info ||
    info.costInputPerMTok === undefined ||
    info.costOutputPerMTok === undefined
  ) {
    return null;
  }
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  return (input * info.costInputPerMTok + output * info.costOutputPerMTok) / 1_000_000;
};
