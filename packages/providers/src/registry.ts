import type { StockProvider, TtsProvider } from "@dalang/pipeline";
import type { FetchImpl } from "./http";
import { createPexelsStock } from "./stock/pexels";
import { createPixabayStock } from "./stock/pixabay";
import { createEdgeTts } from "./tts/edge";
import { createElevenLabsTts } from "./tts/elevenlabs";
import { createSilenceTts } from "./tts/silence";

/**
 * Chain wiring (PRD §7.2: every external service has ≥1 fallback with clear
 * degradation). Rules:
 *  - The REQUESTED primary missing its API key is a configuration error —
 *    fail loudly, never silently swap what the user asked for.
 *  - Optional fallbacks missing keys are simply dropped from the chain.
 *  - `silence` is always last: generate never hard-fails offline, and its
 *    output is unmistakably marked placeholder/fallback quality.
 */

export interface ProviderEnv {
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_MODEL_ID?: string;
  PEXELS_API_KEY?: string;
  PIXABAY_API_KEY?: string;
}

export const KNOWN_TTS_PROVIDERS = ["elevenlabs", "edge", "silence"] as const;
export type KnownTtsProvider = (typeof KNOWN_TTS_PROVIDERS)[number];

export interface BuildTtsChainOptions {
  /** plan.audio.voice.provider — the requested primary. */
  provider: string;
  env?: ProviderEnv;
  fetchImpl?: FetchImpl;
}

export const buildTtsChain = ({
  provider,
  env = process.env as ProviderEnv,
  fetchImpl,
}: BuildTtsChainOptions): TtsProvider[] => {
  if (!(KNOWN_TTS_PROVIDERS as readonly string[]).includes(provider)) {
    throw new Error(
      `Provider TTS "${provider}" tidak dikenal — tersedia: ${KNOWN_TTS_PROVIDERS.join(", ")}`,
    );
  }

  const factories: Record<KnownTtsProvider, () => TtsProvider | null> = {
    elevenlabs: () =>
      env.ELEVENLABS_API_KEY
        ? createElevenLabsTts({
            apiKey: env.ELEVENLABS_API_KEY,
            modelId: env.ELEVENLABS_MODEL_ID,
            fetchImpl,
          })
        : null,
    edge: () => createEdgeTts(),
    silence: () => createSilenceTts(),
  };

  const primary = factories[provider as KnownTtsProvider]();
  if (!primary) {
    throw new Error(
      `Provider TTS "${provider}" diminta di plan tapi ELEVENLABS_API_KEY tidak diset`,
    );
  }

  const chain: TtsProvider[] = [primary];
  for (const id of KNOWN_TTS_PROVIDERS) {
    if (id === provider) continue;
    const fallback = factories[id]();
    if (fallback) chain.push(fallback);
  }
  return chain;
};

export const buildStockChain = ({
  env = process.env as ProviderEnv,
  fetchImpl,
}: {
  env?: ProviderEnv;
  fetchImpl?: FetchImpl;
} = {}): StockProvider[] => {
  const chain: StockProvider[] = [];
  if (env.PEXELS_API_KEY) {
    chain.push(createPexelsStock({ apiKey: env.PEXELS_API_KEY, fetchImpl }));
  }
  if (env.PIXABAY_API_KEY) {
    chain.push(createPixabayStock({ apiKey: env.PIXABAY_API_KEY, fetchImpl }));
  }
  return chain;
};
