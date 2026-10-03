import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { type ReadyRoute, routeHost, routeProvider } from "./providers";
import type { ModelInfo, ModelRegistry } from "./registry";
import { SYNTHETIC_PROVIDERS } from "./synthetic-providers";

/**
 * "provider/model-id" → LanguageModel AI SDK (PRD prinsip #5: model-agnostic).
 *
 * Tiga jalur:
 *  1. SDK bawaan — anthropic, openai, google.
 *  2. Provider mana pun di registry models.dev yang bisa dipanggil lewat
 *     endpoint OpenAI-compatible / Anthropic-compatible / OpenAI: cara
 *     memanggilnya dibaca dari metadata registry (providers.ts, ADR-0044),
 *     bukan dikodekan per provider. Plus ollama lokal.
 *  3. "openai-compatible" — gateway kustom lewat DALANG_OPENAI_COMPAT_BASE_URL,
 *     untuk server yang tidak ada di registry mana pun.
 * Ditambah "mock/echo" untuk smoke test tanpa jaringan.
 */

export interface ResolveEnv extends Record<string, string | undefined> {
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GOOGLE_GENERATIVE_AI_API_KEY?: string;
  DALANG_OPENAI_COMPAT_BASE_URL?: string;
  DALANG_OPENAI_COMPAT_API_KEY?: string;
}

export interface ResolvedModel {
  key: string;
  model: LanguageModel;
  /** Metadata registry bila ada — dipakai untuk cek kapabilitas & biaya. */
  info?: ModelInfo;
  /** Host tujuan permintaan (tanpa kunci) bila bukan endpoint bawaan SDK. */
  host?: string;
  /**
   * Batas token keluaran yang HARUS dikirim eksplisit. SDK Anthropic membatasi
   * model yang tak dikenalnya (id kustom di endpoint bergaya Anthropic) hanya
   * 4096 token per langkah — cukup untuk memotong patch besar di tengah JSON.
   */
  maxOutputTokens?: number;
}

/** Plafon aman untuk permintaan non-streaming; batas registry yang lebih kecil tetap dihormati. */
const COMPAT_MAX_OUTPUT_TOKENS = 16_384;

export const EXECUTABLE_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "openai-compatible",
  "mock",
] as const;

/** Model mock deterministik untuk smoke test CLI (tanpa tools, tanpa jaringan). */
const createEchoModel = (): LanguageModel =>
  new MockLanguageModelV3({
    provider: "mock",
    modelId: "echo",
    doGenerate: async (options) => {
      const lastUser = [...options.prompt]
        .reverse()
        .find((message) => message.role === "user");
      const text =
        lastUser && Array.isArray(lastUser.content)
          ? lastUser.content
              .map((part) => (part.type === "text" ? part.text : ""))
              .join("")
          : "";
      return {
        content: [
          {
            type: "text" as const,
            text: `[mock/echo] Saya menerima: ${text.slice(0, 400)}`,
          },
        ],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: {
          inputTokens: {
            total: 0,
            noCache: 0,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 0, text: 0, reasoning: undefined },
          raw: undefined,
        },
        warnings: [],
      };
    },
  });

const buildFromRoute = (route: ReadyRoute, modelId: string): LanguageModel => {
  switch (route.sdk) {
    case "anthropic":
      return createAnthropic({
        ...(route.apiKey ? { apiKey: route.apiKey } : {}),
        ...(route.baseURL ? { baseURL: route.baseURL } : {}),
      })(modelId);
    case "openai":
      return createOpenAI({
        ...(route.apiKey ? { apiKey: route.apiKey } : {}),
        ...(route.baseURL ? { baseURL: route.baseURL } : {}),
      })(modelId);
    case "google":
      return createGoogle({ ...(route.apiKey ? { apiKey: route.apiKey } : {}) })(modelId);
    case "openai-compatible":
      return createOpenAICompatible({
        name: route.providerId,
        baseURL: route.baseURL as string,
        ...(route.apiKey ? { apiKey: route.apiKey } : {}),
      })(modelId);
  }
};

export const resolveModel = (
  key: string,
  {
    registry,
    env = process.env as ResolveEnv,
  }: { registry?: ModelRegistry; env?: ResolveEnv } = {},
): ResolvedModel => {
  const slash = key.indexOf("/");
  if (slash <= 0 || slash === key.length - 1) {
    throw new Error(
      `Format model tidak valid: "${key}" — pakai "provider/model-id", mis. "anthropic/claude-opus-5"`,
    );
  }
  const provider = key.slice(0, slash);
  const modelId = key.slice(slash + 1);
  const info = registry?.find(key);

  if (provider === "mock") return { key, model: createEchoModel(), info };

  if (provider === "openai-compatible") {
    const baseURL = env.DALANG_OPENAI_COMPAT_BASE_URL;
    if (!baseURL) {
      throw new Error(
        `Provider model "${provider}" membutuhkan env DALANG_OPENAI_COMPAT_BASE_URL (belum diset)`,
      );
    }
    const factory = createOpenAICompatible({
      name: "openai-compatible",
      baseURL,
      apiKey: env.DALANG_OPENAI_COMPAT_API_KEY,
    });
    return { key, model: factory(modelId), info };
  }

  // Registry dulu (datanya yang terbaru); yang selalu dikenal sebagai cadangan
  // — anthropic/openai/google tetap jalan saat registry belum terambil.
  const providerInfo = registry?.provider(provider) ?? SYNTHETIC_PROVIDERS[provider];
  if (!providerInfo) {
    throw new Error(
      `Provider model "${provider}" tidak dikenal — tersedia: ${EXECUTABLE_PROVIDERS.join(", ")}` +
        ", ollama, serta provider registry models.dev yang bisa dipanggil (dalang models provider)",
    );
  }

  const route = routeProvider(providerInfo, env);
  if (!route.ok) throw new Error(route.reason);
  const host = routeHost(route);
  const needsExplicitCap = route.sdk === "anthropic" && route.via !== "bawaan";
  return {
    key,
    model: buildFromRoute(route, modelId),
    info,
    ...(host ? { host } : {}),
    ...(needsExplicitCap
      ? {
          maxOutputTokens: Math.min(
            info?.outputTokens ?? COMPAT_MAX_OUTPUT_TOKENS,
            COMPAT_MAX_OUTPUT_TOKENS,
          ),
        }
      : {}),
  };
};

// Default dua tingkat (PRD §6.4) dipilih netral-vendor — lihat defaults.ts.
