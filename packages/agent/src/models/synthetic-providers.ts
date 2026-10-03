import type { ProviderInfo } from "./registry";

/**
 * Provider yang SELALU dikenal Dalang, ada atau tidaknya di registry.
 *
 * Dua alasan terpisah:
 *  1. anthropic/openai/google adalah SDK yang kita bundel. Saat registry belum
 *     terambil (jaringan terblokir, cache kosong) mereka tetap harus bisa
 *     dipanggil — snapshot offline hanya memuat Anthropic.
 *  2. ollama TIDAK ada di models.dev (yang ada hanya `ollama-cloud`), padahal ia
 *     jalur utama untuk memakai Dalang tanpa cloud dan tanpa API key: model
 *     berjalan di mesin sendiri. Mengisinya di sini membuat
 *     `DALANG_MODEL=ollama/qwen3:8b` langsung bekerja.
 *
 * Entri registry dengan id yang sama SELALU menang (lihat `registry.provider`).
 */
export const SYNTHETIC_PROVIDERS: Readonly<Record<string, ProviderInfo>> = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    npm: "@ai-sdk/anthropic",
    env: ["ANTHROPIC_API_KEY"],
    modelCount: 0,
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    npm: "@ai-sdk/openai",
    env: ["OPENAI_API_KEY"],
    modelCount: 0,
  },
  google: {
    id: "google",
    name: "Google",
    npm: "@ai-sdk/google",
    env: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"],
    modelCount: 0,
  },
  ollama: {
    id: "ollama",
    name: "Ollama (lokal, tanpa cloud)",
    npm: "@ai-sdk/openai-compatible",
    api: "http://127.0.0.1:11434/v1",
    env: ["OLLAMA_HOST"],
    modelCount: 0,
  },
};

/**
 * `OLLAMA_HOST` memakai konvensi klien Ollama: "host:port" tanpa skema dan
 * tanpa /v1, dan "0.0.0.0" (alamat PENDENGAR server) bukan alamat yang bisa
 * dihubungi. Diubah jadi base URL OpenAI-compatible yang sah.
 */
export const normalizeOllamaHost = (value: string): string => {
  let host = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(host)) host = `http://${host}`;
  host = host.replace(/^(https?:\/\/)0\.0\.0\.0(?=[:/]|$)/i, "$1127.0.0.1");
  if (!/\/v1$/.test(host)) host = `${host}/v1`;
  return host;
};
