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
 */

interface ProviderCredential {
  provider: string;
  envVar: string;
  present: (env: ResolveEnv) => boolean;
}

const CREDENTIALS: ProviderCredential[] = [
  {
    provider: "anthropic",
    envVar: "ANTHROPIC_API_KEY",
    present: (env) => Boolean(env.ANTHROPIC_API_KEY),
  },
  {
    provider: "google",
    envVar: "GOOGLE_GENERATIVE_AI_API_KEY",
    present: (env) => Boolean(env.GOOGLE_GENERATIVE_AI_API_KEY),
  },
  {
    provider: "openai",
    envVar: "OPENAI_API_KEY",
    present: (env) => Boolean(env.OPENAI_API_KEY),
  },
  {
    provider: "openai-compatible",
    envVar: "DALANG_OPENAI_COMPAT_BASE_URL",
    present: (env) => Boolean(env.DALANG_OPENAI_COMPAT_BASE_URL),
  },
];

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

  const found = CREDENTIALS.filter((credential) => credential.present(env));

  if (found.length === 0) {
    return {
      reason:
        "Tidak ada API key provider model di environment. Set salah satu: " +
        `${CREDENTIALS.map((c) => c.envVar).join(" / ")}, ` +
        "atau tentukan model eksplisit lewat DALANG_MODEL=provider/model-id",
    };
  }

  if (found.length > 1) {
    return {
      reason:
        `Ditemukan kredensial lebih dari satu provider (${found
          .map((c) => c.provider)
          .join(", ")}) — Dalang tidak memihak vendor; ` +
        "pilih eksplisit lewat DALANG_MODEL=provider/model-id " +
        "(dan opsional DALANG_MODEL_VOLUME)",
    };
  }

  const provider = (found[0] as ProviderCredential).provider;
  const models = byProvider(registry, provider);
  const fromRegistryOrchestrator = pickOrchestratorFromRegistry(models);
  const fromRegistryVolume = pickVolumeFromRegistry(models);

  if (fromRegistryOrchestrator) {
    return {
      orchestrator: fromRegistryOrchestrator.key,
      ...(fromRegistryVolume ? { volume: fromRegistryVolume.key } : {}),
      ...(env.DALANG_MODEL_VOLUME ? { volume: env.DALANG_MODEL_VOLUME } : {}),
      reason: `provider ${provider} terdeteksi dari environment; model dipilih dari registry models.dev`,
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
