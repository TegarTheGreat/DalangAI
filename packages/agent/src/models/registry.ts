import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { MODELS_SNAPSHOT, MODELS_SNAPSHOT_DATE } from "./snapshot";

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

const providerEntrySchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    env: z.array(z.string()).optional(),
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
  /** USD per 1 juta token. */
  costInputPerMTok?: number;
  costOutputPerMTok?: number;
}

export type RegistrySource = "network" | "cache" | "stale-cache" | "snapshot";

export interface ModelRegistry {
  models: ModelInfo[];
  source: RegistrySource;
  snapshotDate: string;
  find(key: string): ModelInfo | undefined;
}

/** Parse defensif: entri yang tidak sesuai bentuk dilewati diam-diam. */
export const parseModelsDev = (raw: unknown): ModelInfo[] => {
  if (typeof raw !== "object" || raw === null) return [];
  const models: ModelInfo[] = [];
  for (const [providerKey, providerRaw] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    const provider = providerEntrySchema.safeParse(providerRaw);
    if (!provider.success || !provider.data.models) continue;
    for (const [modelKey, modelRaw] of Object.entries(provider.data.models)) {
      const model = modelEntrySchema.safeParse(modelRaw);
      if (!model.success) continue;
      const entry = model.data;
      models.push({
        key: `${providerKey}/${modelKey}`,
        provider: providerKey,
        id: modelKey,
        name: entry.name ?? modelKey,
        toolCall: entry.tool_call ?? false,
        imageInput: entry.modalities?.input?.includes("image") ?? false,
        reasoning: entry.reasoning ?? false,
        contextTokens: entry.limit?.context,
        costInputPerMTok: entry.cost?.input,
        costOutputPerMTok: entry.cost?.output,
      });
    }
  }
  return models;
};

const toRegistry = (models: ModelInfo[], source: RegistrySource): ModelRegistry => {
  const byKey = new Map(models.map((model) => [model.key, model]));
  return {
    models,
    source,
    snapshotDate: MODELS_SNAPSHOT_DATE,
    find: (key) => byKey.get(key),
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
  const readCache = (): ModelInfo[] | null => {
    try {
      if (!existsSync(cachePath)) return null;
      const parsed = parseModelsDev(JSON.parse(readFileSync(cachePath, "utf8")));
      return parsed.length > 0 ? parsed : null;
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
        const parsed = parseModelsDev(json);
        if (parsed.length > 0) {
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
  return toRegistry(parseModelsDev(MODELS_SNAPSHOT), "snapshot");
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
