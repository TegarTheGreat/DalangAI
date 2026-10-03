import { allProviders, scanCredentials } from "./providers";
import type { ModelInfo, ModelRegistry } from "./registry";
import type { ResolveEnv } from "./resolve";

/**
 * Pemilihan model default yang NETRAL VENDOR (PRD prinsip #5).
 *
 * Tidak ada provider yang diistimewakan: yang menentukan adalah environment
 * USER — API key mana yang terpasang. Aturannya:
 *
 *  1. `DALANG_MODEL` (dan `DALANG_MODEL_VOLUME`) eksplisit selalu menang.
 *  2. Tepat SATU kredensial provider terdeteksi → provider itu dipakai,
 *     model dipilih dari registry models.dev (data, bukan preferensi kami):
 *     orkestrator = model tool-calling berkonteks terbesar; volume = model
 *     tool-calling termurah (utamakan yang bisa input gambar, untuk vision).
 *     Bila registry tidak memuat provider itu (mis. offline), jatuh ke peta
 *     kurasi di bawah — sekadar titik mulai, bukan endorsement.
 *  3. LEBIH dari satu kredensial → kami MENOLAK memilih (memilih = bias);
 *     user diminta set `DALANG_MODEL=provider/model-id`.
 *  4. Tidak ada kredensial → chat nonaktif dengan instruksi jelas.
 *
 * "Kredensial terdeteksi" kini berarti: env var *_API_KEY milik provider mana
 * pun di registry yang bisa dipanggil (ADR-0044) — bukan lagi empat nama yang
 * dikodekan. Tiga pengaman supaya perluasan ini tidak menebak sembarangan:
 *  - hanya *_API_KEY: GITHUB_TOKEN, HF_TOKEN dkk. ada di mesin banyak orang
 *    untuk keperluan lain, jadi tidak pernah dianggap niat memakai provider;
 *  - satu env var untuk banyak provider (varian regional/paket) tidak bisa
 *    dipilihkan — diminta eksplisit;
 *  - agregator (ratusan model ber-id "vendor/model") tidak diberi model
 *    otomatis: "terbesar/termurah" di antara 400 model bukan pilihan yang
 *    layak, jadi pengguna diminta memilih.
 */

/** Gateway kustom: bukan provider di registry mana pun, jadi dideteksi dari base URL-nya. */
const GATEWAY = {
  provider: "openai-compatible",
  envVar: "DALANG_OPENAI_COMPAT_BASE_URL",
} as const;

const ANTI_BIAS_HINT =
  "pilih eksplisit lewat DALANG_MODEL=provider/model-id " +
  "(dan opsional DALANG_MODEL_VOLUME); daftar model: dalang models cari --provider <id>";

/**
 * Titik mulai per provider saat registry tidak tersedia — ID publik yang
 * dikenal saat rilis; BUKAN preferensi. Selalu bisa dioverride, dan bila
 * registry terjangkau, pilihan berbasis data di atas yang dipakai.
 * openai-compatible tidak mungkin ditebak (gateway kustom) → wajib eksplisit.
 */
const CURATED_FALLBACK: Record<string, { orchestrator: string; volume: string }> = {
  anthropic: {
    orchestrator: "anthropic/claude-opus-5",
    volume: "anthropic/claude-haiku-4-5",
  },
  openai: { orchestrator: "openai/gpt-5.2", volume: "openai/gpt-5.2" },
  google: { orchestrator: "google/gemini-3-pro", volume: "google/gemini-3-flash" },
};

const byProvider = (registry: ModelRegistry | undefined, provider: string): ModelInfo[] =>
  (registry?.models ?? []).filter(
    (model) => model.provider === provider && model.toolCall,
  );

/** Agregator = sebagian besar id-nya berbentuk "vendor/model" (OpenRouter, Hugging Face, Together). */
const looksLikeAggregator = (models: ModelInfo[]): boolean =>
  models.length > 0 &&
  models.filter((model) => model.id.includes("/")).length / models.length >= 0.5;

const pickOrchestratorFromRegistry = (models: ModelInfo[]): ModelInfo | undefined =>
  [...models].sort(
    (a, b) =>
      (b.contextTokens ?? 0) - (a.contextTokens ?? 0) ||
      (b.costOutputPerMTok ?? 0) - (a.costOutputPerMTok ?? 0),
  )[0];

const pickVolumeFromRegistry = (models: ModelInfo[]): ModelInfo | undefined => {
  const ranked = [...models].sort(
    (a, b) =>
      (a.costOutputPerMTok ?? Number.POSITIVE_INFINITY) -
      (b.costOutputPerMTok ?? Number.POSITIVE_INFINITY),
  );
  return ranked.find((model) => model.imageInput) ?? ranked[0];
};

export interface DefaultModelChoice {
  /** "provider/model-id" — undefined bila tidak bisa dipilih secara netral. */
  orchestrator?: string;
  volume?: string;
  /** Penjelasan pilihan ATAU alasan kenapa tidak memilih (untuk CLI/UI). */
  reason: string;
}

export const pickDefaultModels = (
  env: ResolveEnv & { DALANG_MODEL?: string; DALANG_MODEL_VOLUME?: string },
  registry?: ModelRegistry,
): DefaultModelChoice => {
  if (env.DALANG_MODEL) {
    return {
      orchestrator: env.DALANG_MODEL,
      ...(env.DALANG_MODEL_VOLUME ? { volume: env.DALANG_MODEL_VOLUME } : {}),
      reason: "dipilih eksplisit lewat DALANG_MODEL",
    };
  }

  const scan = scanCredentials(env, allProviders(registry));
  const found: Array<{ provider: string; envVar: string }> = [...scan.detected];
  if (env[GATEWAY.envVar])
    found.push({ provider: GATEWAY.provider, envVar: GATEWAY.envVar });

  if (found.length === 0 && scan.ambiguous.length === 0) {
    const incomplete = scan.incomplete
      .map(
        (item) =>
          `${item.envVar} terpasang, tetapi provider ${item.provider} juga butuh ${item.missingEnv.join(", ")}`,
      )
      .join("; ");
    return {
      reason:
        "Tidak ada API key provider model di environment. Set salah satu: " +
        "ANTHROPIC_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY / OPENAI_API_KEY / " +
        `${GATEWAY.envVar}, atau key provider lain dari models.dev ` +
        "(mis. OPENROUTER_API_KEY, DEEPSEEK_API_KEY — lihat: dalang models provider), " +
        "atau tentukan model eksplisit lewat DALANG_MODEL=provider/model-id. " +
        "Tanpa API sama sekali: model lokal (DALANG_MODEL=ollama/<model>), " +
        "atau pakai Claude Code / Codex / Gemini CLI lewat MCP (dalang agen siapkan)." +
        (incomplete ? ` Catatan: ${incomplete}.` : ""),
    };
  }

  if (found.length + scan.ambiguous.length > 1) {
    const names = [
      ...found.map((c) => c.provider),
      ...scan.ambiguous.map((a) => `${a.envVar} -> ${a.providers.join("|")}`),
    ];
    return {
      reason:
        `Ditemukan kredensial lebih dari satu provider (${names.join(", ")}) — ` +
        `Dalang tidak memihak vendor; ${ANTI_BIAS_HINT}`,
    };
  }

  if (found.length === 0) {
    const ambiguous = scan.ambiguous[0] as (typeof scan.ambiguous)[number];
    return {
      reason:
        `${ambiguous.envVar} dipakai beberapa provider sekaligus (${ambiguous.providers.join(", ")}) — ` +
        `varian regional/paket dengan endpoint berbeda, jadi Dalang tidak menebak; ${ANTI_BIAS_HINT}`,
    };
  }

  const detected = found[0] as { provider: string; envVar: string };
  const provider = detected.provider;
  const models = byProvider(registry, provider);

  if (looksLikeAggregator(models)) {
    return {
      reason:
        `Provider ${provider} terdeteksi (${detected.envVar}), tetapi ia agregator dengan ${models.length} model ` +
        `bertool-calling — tidak ada pilihan otomatis yang layak; ${ANTI_BIAS_HINT}`,
    };
  }

  const fromRegistryOrchestrator = pickOrchestratorFromRegistry(models);
  const fromRegistryVolume = pickVolumeFromRegistry(models);

  if (fromRegistryOrchestrator) {
    return {
      orchestrator: fromRegistryOrchestrator.key,
      ...(fromRegistryVolume ? { volume: fromRegistryVolume.key } : {}),
      ...(env.DALANG_MODEL_VOLUME ? { volume: env.DALANG_MODEL_VOLUME } : {}),
      reason: `provider ${provider} terdeteksi dari environment (${detected.envVar}); model dipilih dari registry models.dev`,
    };
  }

  const curated = CURATED_FALLBACK[provider];
  if (curated) {
    return {
      orchestrator: curated.orchestrator,
      volume: env.DALANG_MODEL_VOLUME ?? curated.volume,
      reason: `provider ${provider} terdeteksi dari environment; registry tidak memuat daftarnya — memakai titik mulai kurasi (override dengan DALANG_MODEL bila perlu)`,
    };
  }

  return {
    reason:
      `Provider ${provider} terdeteksi, tapi model-id tidak bisa ditebak — ` +
      "set DALANG_MODEL=" +
      `${provider}/<model-id>`,
  };
};
