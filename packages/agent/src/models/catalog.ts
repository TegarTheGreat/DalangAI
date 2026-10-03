import {
  allProviders,
  type EnvLike,
  type ProviderState,
  type ProviderStatus,
  providerStatus,
} from "./providers";
import type { ModelInfo, ModelRegistry } from "./registry";

/**
 * Menjelajahi registry untuk perintah `dalang models` — logika murni tanpa
 * I/O, supaya urutan, penyaringan, dan bentuk tabelnya bisa diuji tanpa CLI.
 */

export type ModelSort = "biaya" | "konteks" | "nama";

export interface ModelQuery {
  /** Semua kata harus muncul (huruf besar/kecil diabaikan) di id atau nama model. */
  text?: string;
  /** Id provider persis. */
  provider?: string;
  /** Hanya model yang mendukung tool-calling (syarat orkestrator Dalang). */
  toolCall?: boolean;
  /** Hanya model dengan input gambar (syarat tier-volume/vision). */
  vision?: boolean;
  /** Hanya model dari provider yang konfigurasinya lengkap di environment ini. */
  ready?: boolean;
  sort?: ModelSort;
  limit?: number;
}

export interface ModelRow {
  model: ModelInfo;
  state: ProviderState;
}

const stateByProvider = (
  registry: ModelRegistry,
  env: EnvLike,
): Map<string, ProviderStatus> =>
  new Map(
    allProviders(registry).map((provider) => [
      provider.id,
      providerStatus(provider, env),
    ]),
  );

const compareCost = (a: ModelInfo, b: ModelInfo): number =>
  (a.costOutputPerMTok ?? Number.POSITIVE_INFINITY) -
  (b.costOutputPerMTok ?? Number.POSITIVE_INFINITY);

export const searchModels = (
  registry: ModelRegistry,
  env: EnvLike,
  query: ModelQuery = {},
): { rows: ModelRow[]; total: number } => {
  const states = stateByProvider(registry, env);
  const words = (query.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);

  const matched = registry.models.filter((model) => {
    if (query.provider && model.provider !== query.provider) return false;
    if (query.toolCall && !model.toolCall) return false;
    if (query.vision && !model.imageInput) return false;
    const state = states.get(model.provider)?.state ?? "tidak-didukung";
    if (query.ready && state !== "siap") return false;
    if (words.length > 0) {
      const haystack = `${model.key} ${model.name}`.toLowerCase();
      if (!words.every((word) => haystack.includes(word))) return false;
    }
    return true;
  });

  const sort = query.sort ?? "nama";
  matched.sort((a, b) => {
    if (sort === "biaya") return compareCost(a, b) || a.key.localeCompare(b.key);
    if (sort === "konteks") {
      return (
        (b.contextTokens ?? 0) - (a.contextTokens ?? 0) || a.key.localeCompare(b.key)
      );
    }
    return a.key.localeCompare(b.key);
  });

  const limit = query.limit ?? matched.length;
  return {
    total: matched.length,
    rows: matched.slice(0, limit).map((model) => ({
      model,
      state: states.get(model.provider)?.state ?? "tidak-didukung",
    })),
  };
};

const STATE_ORDER: Record<ProviderState, number> = {
  siap: 0,
  "butuh-env": 1,
  "tidak-didukung": 2,
};

export const listProviders = (
  registry: ModelRegistry,
  env: EnvLike,
  options: { text?: string; ready?: boolean } = {},
): ProviderStatus[] => {
  const words = (options.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return allProviders(registry)
    .map((provider) => providerStatus(provider, env))
    .filter((status) => {
      if (options.ready && status.state !== "siap") return false;
      if (words.length === 0) return true;
      const haystack = `${status.provider.id} ${status.provider.name}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .sort(
      (a, b) =>
        STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
        a.provider.id.localeCompare(b.provider.id),
    );
};

// ---------------------------------------------------------------------------
// Tampilan teks
// ---------------------------------------------------------------------------

const pad = (text: string, width: number): string =>
  text.length >= width ? text : text + " ".repeat(width - text.length);

const clip = (text: string, width: number): string =>
  text.length <= width ? text : `${text.slice(0, Math.max(1, width - 1))}~`;

export const formatTokens = (tokens: number | undefined): string => {
  if (tokens === undefined) return "-";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
};

export const formatUsdPerMTok = (price: number | undefined): string => {
  if (price === undefined) return "-";
  if (price === 0) return "gratis";
  return price >= 1 ? price.toFixed(2) : price.toFixed(3);
};

const STATE_LABEL: Record<ProviderState, string> = {
  siap: "siap",
  "butuh-env": "butuh-env",
  "tidak-didukung": "tak-didukung",
};

const table = (header: string[], rows: string[][]): string[] => {
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => (row[column] ?? "").length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, column) => pad(cell, widths[column] ?? 0))
      .join("  ")
      .trimEnd();
  return [line(header), ...rows.map(line)];
};

export const formatModelRows = (rows: ModelRow[]): string[] =>
  table(
    ["MODEL", "KONTEKS", "MASUK", "KELUAR", "ALAT", "GAMBAR", "STATUS"],
    rows.map(({ model, state }) => [
      clip(model.key, 52),
      formatTokens(model.contextTokens),
      formatUsdPerMTok(model.costInputPerMTok),
      formatUsdPerMTok(model.costOutputPerMTok),
      model.toolCall ? "ya" : "tidak",
      model.imageInput ? "ya" : "tidak",
      STATE_LABEL[state],
    ]),
  );

const providerNote = (status: ProviderStatus): string => {
  const { support } = status;
  if (!support.executable) return clip(support.reason ?? "", 70);
  const env = [support.keyEnv, ...support.templateVars, support.endpointEnv]
    .filter((name): name is string => Boolean(name))
    .join(" + ");
  if (status.state === "butuh-env") return `kurang: ${status.missingEnv.join(", ")}`;
  return support.keyOptional && !support.keyEnv ? "tanpa key" : env || "tanpa key";
};

export const formatProviderRows = (rows: ProviderStatus[]): string[] =>
  table(
    ["PROVIDER", "NAMA", "STATUS", "JALUR", "MODEL", "ENV / ALASAN"],
    rows.map((status) => [
      status.provider.id,
      clip(status.provider.name, 28),
      STATE_LABEL[status.state],
      status.support.via ?? "-",
      String(status.provider.modelCount),
      providerNote(status),
    ]),
  );
