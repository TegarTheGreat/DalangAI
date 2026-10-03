import { pickDefaultModels } from "./defaults";
import type { EnvLike } from "./providers";
import type { ModelRegistry } from "./registry";
import { type ResolveEnv, resolveModel } from "./resolve";

export interface ChatReadiness {
  ready: boolean;
  /** Model yang akan dipakai bila siap. */
  model?: string;
  /** Alasan pemilihannya, atau mengapa belum siap. */
  reason: string;
}

/**
 * Apakah `dalang chat` bisa jalan dengan environment ini — jawaban yang SAMA
 * dengan yang akan ditemui chat sungguhan, bukan tebakan dari daftar kunci.
 * Dipakai `dalang doctor/setup` supaya provider registry di luar katalog
 * statis (OpenRouter, DeepSeek, Ollama lokal, ...) tidak dilaporkan "mati"
 * padahal chat-nya hidup. Tidak ada jaringan: yang dibangun hanya objek model.
 */
export const chatReadiness = (env: EnvLike, registry?: ModelRegistry): ChatReadiness => {
  const choice = pickDefaultModels(env as ResolveEnv, registry);
  if (!choice.orchestrator) return { ready: false, reason: choice.reason };
  try {
    resolveModel(choice.orchestrator, {
      ...(registry ? { registry } : {}),
      env: env as ResolveEnv,
    });
    return { ready: true, model: choice.orchestrator, reason: choice.reason };
  } catch (error) {
    return {
      ready: false,
      model: choice.orchestrator,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
};
