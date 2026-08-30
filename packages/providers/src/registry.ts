import type {
  IconProvider,
  SfxProvider,
  StockProvider,
  TtsProvider,
} from "@dalang/pipeline";
import type { FetchImpl } from "./http";
import { createIconifyIcons } from "./icons/iconify";
import { createOpenverseSfx } from "./sfx/openverse";
import { createGiphyStock } from "./stock/giphy";
import { createPexelsStock } from "./stock/pexels";
import { createPixabayStock } from "./stock/pixabay";
import { createTenorStock } from "./stock/tenor";
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
  /** GIF & stiker (ADR-0018) — opsional, isinya perlu ditinjau hak pakai. */
  GIPHY_API_KEY?: string;
  TENOR_API_KEY?: string;
  /** Openverse: token OPSIONAL, hanya menaikkan batas laju (ADR-0018). */
  OPENVERSE_TOKEN?: string;
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

/**
 * Urutan rantai stock adalah keputusan produk, bukan selera (ADR-0018):
 * Pexels dan Pixabay lebih dulu karena lisensinya JELAS boleh dipakai
 * komersial. GIPHY dan Tenor menyusul di belakang karena isinya unggahan
 * pihak ketiga yang hak ciptanya milik pengunggah — berguna, tapi tidak boleh
 * menjadi pilihan otomatis pertama untuk video yang akan dipublikasikan.
 */
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
  if (env.GIPHY_API_KEY) {
    chain.push(createGiphyStock({ apiKey: env.GIPHY_API_KEY, fetchImpl }));
  }
  if (env.TENOR_API_KEY) {
    chain.push(createTenorStock({ apiKey: env.TENOR_API_KEY, fetchImpl }));
  }
  return chain;
};

/**
 * Rantai khusus GIF/stiker — dipakai pencarian yang MEMANG meminta gerak
 * pendek berulang, terpisah dari rantai stock utama supaya foto/video
 * berlisensi jelas tidak pernah tergeser olehnya.
 */
export const buildGifChain = ({
  env = process.env as ProviderEnv,
  fetchImpl,
  stickers = false,
}: {
  env?: ProviderEnv;
  fetchImpl?: FetchImpl;
  stickers?: boolean;
} = {}): StockProvider[] => {
  const kind = stickers ? ("stickers" as const) : ("gifs" as const);
  const chain: StockProvider[] = [];
  if (env.GIPHY_API_KEY) {
    chain.push(createGiphyStock({ apiKey: env.GIPHY_API_KEY, kind, fetchImpl }));
  }
  if (env.TENOR_API_KEY) {
    chain.push(createTenorStock({ apiKey: env.TENOR_API_KEY, kind, fetchImpl }));
  }
  return chain;
};

/**
 * Ikon (ADR-0018). Iconify adalah API publik TANPA KUNCI, jadi tidak ada
 * gerbang konfigurasi: ikon selalu tersedia. Set NonCommercial disaring di
 * dalam provider, bukan di sini.
 */
export const buildIconProvider = ({
  fetchImpl,
}: {
  fetchImpl?: FetchImpl;
} = {}): IconProvider => createIconifyIcons({ fetchImpl });

/**
 * Efek suara (ADR-0018). Openverse juga tidak mewajibkan kunci; token hanya
 * menaikkan batas laju, jadi SFX pun tersedia tanpa konfigurasi apa pun.
 */
export const buildSfxChain = ({
  env = process.env as ProviderEnv,
  fetchImpl,
}: {
  env?: ProviderEnv;
  fetchImpl?: FetchImpl;
} = {}): SfxProvider[] => [
  createOpenverseSfx({
    ...(env.OPENVERSE_TOKEN ? { accessToken: env.OPENVERSE_TOKEN } : {}),
    fetchImpl,
  }),
];
