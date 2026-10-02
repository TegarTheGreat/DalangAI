import {
  clearDubAudio,
  dubCoverage,
  planInLanguage,
  type ScenePlan,
  setDubAudio,
} from "@dalang/core";
import type { PipelineDb } from "./db";
import type { TtsProvider } from "./ports";
import type { ProjectPaths } from "./project-paths";
import { consoleLogger, type SceneStageResult, type StageLogger } from "./stage-types";
import { runTtsStage } from "./tts-stage";

/**
 * Tahap sulih suara (ADR-0040) — TTS untuk satu BAHASA SULIH.
 *
 * Sengaja setipis mungkin: ia menukar plan ke bahasa yang diminta lewat
 * `planInLanguage`, menjalankan tahap TTS yang SUDAH ADA di atasnya, lalu
 * melipat hasilnya balik ke `renderState.dubAudio[bahasa]`.
 *
 * Menyalin isi tahap TTS ke sini akan menghasilkan dua tempat yang harus
 * sama-sama tahu soal cache, rantai fallback, penandaan `fallbackQuality`,
 * pengukuran kenyaringan, dan penulisan berkas — dan yang menyimpang duluan
 * pasti yang jarang dijalankan, yaitu justru yang ini.
 */

export interface DubStageOptions {
  paths: ProjectPaths;
  plan: ScenePlan;
  /** Kode bahasa sulih; harus BUKAN `plan.meta.language`. */
  language: string;
  providers: TtsProvider[];
  db: PipelineDb;
  sceneIds?: string[];
  force?: boolean;
  log?: StageLogger;
}

export interface DubStageOutcome {
  plan: ScenePlan;
  results: SceneStageResult[];
  /** Scene bernarasi yang belum punya teks sulihan — tidak disintesis. */
  belumDiterjemahkan: string[];
}

export const runDubStage = async ({
  paths,
  plan,
  language,
  providers,
  db,
  sceneIds,
  force = false,
  log = consoleLogger,
}: DubStageOptions): Promise<DubStageOutcome> => {
  if (language === plan.meta.language) {
    throw new Error(
      `"${language}" adalah bahasa utama proyek ini — pakai tahap TTS biasa, bukan sulih suara`,
    );
  }
  const cakupan = dubCoverage(plan, language);
  if (cakupan.diterjemahkan === 0) {
    return {
      plan,
      results: [],
      belumDiterjemahkan: cakupan.belumDiterjemahkan,
    };
  }

  const swapped = planInLanguage(plan, language);
  const { plan: sesudah, results } = await runTtsStage({
    paths,
    plan: swapped,
    providers,
    db,
    ...(sceneIds ? { sceneIds } : {}),
    force,
    // Kunci ledger dipisah per bahasa; lihat `ledgerScope` di tahap TTS.
    ledgerScope: language,
    log,
  });

  /**
   * Dilipat balik SATU per satu, bukan dengan menempelkan seluruh peta.
   *
   * `setDubAudio` memvalidasi tiap entri lewat skemanya, dan validasi di
   * pintu masuk `renderState` adalah satu-satunya hal yang menghalangi data
   * turunan yang cacat tersimpan ke plan.json dan baru meledak saat render.
   */
  let hasil = plan;
  for (const [sceneId, audio] of Object.entries(sesudah.renderState.narrationAudio)) {
    hasil = setDubAudio(hasil, language, sceneId, audio);
  }
  return { plan: hasil, results, belumDiterjemahkan: cakupan.belumDiterjemahkan };
};

/**
 * Membuang bahasa sulih beserta audionya.
 *
 * Teksnya dibuang lewat op `setDub` (bisa di-undo); yang ini membuang data
 * TURUNAN-nya, yang memang bukan urusan patch op. Dipisah supaya pemanggil
 * yang cuma mau membersihkan berkas tidak perlu menyusun patch.
 */
export const dropDubAudio = (plan: ScenePlan, language: string): ScenePlan =>
  clearDubAudio(plan, language);
