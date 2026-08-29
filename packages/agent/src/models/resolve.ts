import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { ModelInfo, ModelRegistry } from "./registry";

/**
 * "provider/model-id" → LanguageModel AI SDK (PRD prinsip #5: model-agnostic).
 * Provider eksekusi terkurasi: anthropic, openai, google, openai-compatible
 * (baseURL kustom — pintu ke banyak provider lain), plus "mock/echo" untuk
 * smoke test tanpa jaringan. Registry models.dev tetap sumber metadata;
 * peta ini hanya soal SIAPA yang bisa kita panggil.
 */

export interface ResolveEnv {
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
}

export const EXECUTABLE_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "openai-compatible",
  "mock",
] as const;

const requireKey = (
  value: string | undefined,
  envVar: string,
  provider: string,
): string => {
  if (!value) {
    throw new Error(
      `Provider model "${provider}" membutuhkan env ${envVar} (belum diset)`,
    );
  }
  return value;
};

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

  switch (provider) {
    case "anthropic": {
      const factory = createAnthropic({
        apiKey: requireKey(env.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY", provider),
      });
      return { key, model: factory(modelId), info };
    }
    case "openai": {
      const factory = createOpenAI({
        apiKey: requireKey(env.OPENAI_API_KEY, "OPENAI_API_KEY", provider),
      });
      return { key, model: factory(modelId), info };
    }
    case "google": {
      const factory = createGoogle({
        apiKey: requireKey(
          env.GOOGLE_GENERATIVE_AI_API_KEY,
          "GOOGLE_GENERATIVE_AI_API_KEY",
          provider,
        ),
      });
      return { key, model: factory(modelId), info };
    }
    case "openai-compatible": {
      const factory = createOpenAICompatible({
        name: "openai-compatible",
        baseURL: requireKey(
          env.DALANG_OPENAI_COMPAT_BASE_URL,
          "DALANG_OPENAI_COMPAT_BASE_URL",
          provider,
        ),
        apiKey: env.DALANG_OPENAI_COMPAT_API_KEY,
      });
      return { key, model: factory(modelId), info };
    }
    case "mock":
      return { key, model: createEchoModel(), info };
    default:
      throw new Error(
        `Provider model "${provider}" tidak dikenal — tersedia: ${EXECUTABLE_PROVIDERS.join(", ")}`,
      );
  }
};

/** Default dua tingkat (PRD §6.4); override via env/flag. */
export const DEFAULT_ORCHESTRATOR_MODEL = "anthropic/claude-opus-5";
export const DEFAULT_VOLUME_MODEL = "anthropic/claude-haiku-4-5";
