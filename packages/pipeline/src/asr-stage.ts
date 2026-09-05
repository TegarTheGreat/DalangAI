import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import {
  clipAsset,
  type ScenePlan,
  setTranscript,
  type Transcript,
  transcriptSchema,
} from "@dalang/core";
import type { PipelineDb } from "./db";
import { round3 } from "./fs-utils";
import type { AsrProvider } from "./ports";
import type { ProjectPaths } from "./project-paths";
import { consoleLogger, type SceneStageResult, type StageLogger } from "./stage-types";

/**
 * Stage ASR — per BERKAS REKAMAN, ber-cache, bisa dilanjutkan (ADR-0021).
 *
 * Bedanya dengan stage TTS dan aset: satuan kerjanya bukan scene. Satu rekaman
 * satu jam yang dipakai lima scene ditranskrip SEKALI, dan hasilnya tetap sah
 * ketika scene-scene itu dipotong ulang, diurutkan ulang, atau dibuang.
 *
 * Kunci cache = isi berkas + bahasa + diarisasi. Isi berkasnya, bukan path atau
 * mtime: rekaman yang sama disalin ke folder lain tidak boleh ditranskrip dua
 * kali, dan berkas berbeda dengan nama sama tidak boleh memakai cache yang
 * salah.
 */

export interface AsrStageOptions {
  paths: ProjectPaths;
  plan: ScenePlan;
  /** Rantai fallback, primer di depan. */
  providers: AsrProvider[];
  db: PipelineDb;
  /** Batasi ke berkas milik scene-scene ini; kosong = semua yang punya rekaman. */
  sceneIds?: string[];
  /** Minta label pembicara kalau providernya mampu. */
  diarize?: boolean;
  force?: boolean;
  log?: StageLogger;
}

export interface AsrStageOutcome {
  plan: ScenePlan;
  /** `sceneId` di sini memuat PATH BERKAS — satuan kerjanya berkas, bukan scene. */
  results: SceneStageResult[];
}

/** Hash isi berkas secara mengalir: rekaman satu jam tidak dimuat ke memori. */
export const fileContentHash = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex").slice(0, 16)));
  });

/**
 * Berkas rekaman yang dirujuk plan, beserta scene yang memakainya.
 *
 * Hanya aset video/audio: menranskrip gambar diam adalah pekerjaan yang pasti
 * tidak menghasilkan apa-apa, dan biayanya nyata pada provider berbayar.
 *
 * Dipindai per KLIP (ADR-0033), bukan per scene. Sebelumnya hanya klip pertama
 * yang dilihat, jadi scene yang potongan keduanya rekaman LAIN tidak pernah
 * ditranskrip — dan yang hilang bukan berkasnya melainkan kemampuan agent
 * membaca isinya sebelum memutuskan potongan. Scene tetap disebut sekali
 * meski beberapa potongannya memakai berkas yang sama: yang dibawa peta ini
 * adalah "siapa yang memakai rekaman ini", dan menyebut satu scene dua kali
 * hanya membuat laporannya lebih panjang tanpa lebih benar.
 */
export const recordingsInPlan = (
  plan: ScenePlan,
  sceneIds?: string[],
): Map<string, string[]> => {
  const wanted = sceneIds ? new Set(sceneIds) : null;
  const byFile = new Map<string, string[]>();
  for (const scene of plan.scenes) {
    if (wanted && !wanted.has(scene.id)) continue;
    for (const clip of scene.clips) {
      const asset = clipAsset(plan, clip.id);
      if (!asset || (asset.kind !== "video" && asset.kind !== "audio")) continue;
      const users = byFile.get(asset.file) ?? [];
      if (!users.includes(scene.id)) users.push(scene.id);
      byFile.set(asset.file, users);
    }
  }
  return byFile;
};

export const runAsrStage = async ({
  paths,
  plan,
  providers,
  db,
  sceneIds,
  diarize = false,
  force = false,
  log = consoleLogger,
}: AsrStageOptions): Promise<AsrStageOutcome> => {
  const recordings = recordingsInPlan(plan, sceneIds);
  const results: SceneStageResult[] = [];

  if (recordings.size === 0) {
    return { plan, results };
  }
  if (providers.length === 0) {
    // Sengaja galat, bukan lewat diam-diam: tanpa provider, transkrip TIDAK
    // AKAN pernah ada, dan pemakainya harus tahu itu sekarang — bukan setelah
    // menunggu pekerjaan yang tak pernah berjalan (PRD §10).
    throw new Error(
      "Tidak ada provider ASR yang tersedia — pasang whisper.cpp untuk jalur offline, " +
        "atau set DEEPGRAM_API_KEY / ELEVENLABS_API_KEY untuk jalur API",
    );
  }

  let current = plan;
  for (const [file, users] of recordings) {
    const abs = join(paths.planDir, file);
    if (!existsSync(abs)) {
      results.push({
        sceneId: file,
        status: "error",
        detail: `berkas rekaman tidak ada: ${file}`,
      });
      continue;
    }

    const inputHash = `${await fileContentHash(abs)}:${diarize ? "d" : "-"}:${plan.meta.language}`;
    const existing = db.getRun(plan.projectId, file, "asr");
    if (
      !force &&
      existing?.status === "done" &&
      existing.inputHash === inputHash &&
      existing.outputJson
    ) {
      const entry = transcriptSchema.parse(JSON.parse(existing.outputJson));
      current = setTranscript(current, file, entry);
      results.push({
        sceneId: file,
        status: "cached",
        detail: `cache (${existing.provider ?? "?"}) · ${entry.words.length} kata`,
        provider: existing.provider ?? undefined,
        costUsd: 0,
      });
      continue;
    }

    db.startRun(plan.projectId, file, "asr", inputHash);
    const startedAt = Date.now();
    let succeeded = false;
    let lastError = "tidak ada provider yang dicoba";

    for (let index = 0; index < providers.length; index++) {
      const provider = providers[index] as AsrProvider;
      try {
        const result = await provider.transcribe({
          file: abs,
          language: plan.meta.language,
          diarize,
        });
        if (result.words.length === 0) {
          throw new Error("tidak ada satu kata pun dikenali");
        }
        const entry: Transcript = {
          source: provider.id,
          language: result.language,
          durationSec: round3(
            result.durationSec > 0
              ? result.durationSec
              : (result.words.at(-1)?.endSec ?? 0),
          ),
          words: result.words,
          segments: result.segments,
        };
        current = setTranscript(current, file, entry);

        const durationMs = Date.now() - startedAt;
        db.finishRun(plan.projectId, file, "asr", {
          provider: provider.id,
          fallback: index > 0,
          outputJson: JSON.stringify(entry),
          costUsd: result.costUsd,
          durationMs,
        });
        const speakers = new Set(
          result.words.map((word) => word.speaker).filter((s) => s !== undefined),
        );
        results.push({
          sceneId: file,
          status: "done",
          detail:
            `${provider.label} · ${result.words.length} kata · ${result.language}` +
            (speakers.size > 1 ? ` · ${speakers.size} pembicara` : "") +
            ` · dipakai ${users.length} scene`,
          provider: provider.id,
          fallback: index > 0,
          costUsd: result.costUsd,
          durationMs,
        });
        succeeded = true;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        log.warn(`  provider ${provider.id} gagal untuk ${file}: ${lastError}`);
      }
    }

    if (!succeeded) {
      const durationMs = Date.now() - startedAt;
      db.failRun(plan.projectId, file, "asr", lastError, durationMs);
      results.push({ sceneId: file, status: "error", detail: lastError, durationMs });
    }
  }

  return { plan: current, results };
};

/**
 * Transkrip dari narasi buatan Dalang sendiri — gratis dan tanpa jaringan.
 *
 * Word timestamp untuk suara yang KITA hasilkan sudah ada sejak stage TTS;
 * menjalankan ASR di atasnya berarti membayar mesin untuk menebak ulang apa
 * yang sudah kita ketahui persis. Ditandai `fromNarration` supaya tidak pernah
 * disamakan dengan hasil mendengarkan rekaman sungguhan.
 */
export const narrationTranscripts = (plan: ScenePlan): ScenePlan => {
  let current = plan;
  for (const [sceneId, audio] of Object.entries(plan.renderState.narrationAudio)) {
    const words = audio.wordTimestamps;
    if (!words || words.length === 0) continue;
    if (current.renderState.transcripts[audio.file]) continue;
    const scene = plan.scenes.find((s) => s.id === sceneId);
    current = setTranscript(current, audio.file, {
      source: "narration",
      language: plan.meta.language,
      durationSec: audio.durationSec,
      words: words.map((word) => ({ ...word })),
      segments: scene
        ? [
            {
              startSec: words[0]?.startSec ?? 0,
              endSec: words.at(-1)?.endSec ?? audio.durationSec,
              text: scene.narration,
            },
          ]
        : [],
      fromNarration: true,
    });
  }
  return current;
};
