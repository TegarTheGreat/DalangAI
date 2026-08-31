import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ScenePlan, setLoudness } from "@dalang/core";
import type { PipelineDb } from "./db";
import { contentHash } from "./hash";
import { measureWavLoudness } from "./loudness";
import type { AudioProbe } from "./ports";
import type { ProjectPaths } from "./project-paths";
import { consoleLogger, type SceneStageResult, type StageLogger } from "./stage-types";

/**
 * Tahap ukur kenyaringan (ADR-0026, roadmap §9.4).
 *
 * DIKUNCI PER BERKAS, bukan per scene — satu rekaman yang dipakai lima scene
 * diukur sekali. Alasannya sama dengan transkrip di ADR-0021: hasilnya milik
 * berkasnya, bukan milik tempat berkas itu kebetulan dipakai, dan mengulang
 * pengukuran per pemakai hanya membakar waktu untuk mendapat angka yang sama.
 *
 * YANG DIUKUR HANYA YANG TERDENGAR. Mengukur setiap aset video di plan berarti
 * membongkar audio dari berkas-berkas yang `volume`-nya nol — pekerjaan yang
 * hasilnya tidak pernah dipakai satu frame pun. Menaikkan volume sebuah klip
 * berarti tahap ini perlu dijalankan lagi, dan itu memang alur yang benar:
 * pengukuran adalah tahap pipeline, bukan efek samping dari menggeser slider.
 */

/** Satu berkas yang perlu diukur, beserta alasan ia terdengar. */
interface Job {
  file: string;
  label: string;
}

const WAV_EXT = new Set([".wav", ".wave"]);

const extensionOf = (file: string): string => {
  const dot = file.lastIndexOf(".");
  return dot < 0 ? "" : file.slice(dot).toLowerCase();
};

/**
 * Berkas mana saja yang benar-benar berbunyi di plan ini.
 *
 * Sengaja fungsi murni yang bisa diuji sendiri: keputusan "apa yang terdengar"
 * adalah tempat paling mudah untuk melewatkan satu sumber diam-diam, dan
 * sumber yang terlewat berarti satu klip yang tidak ikut dinormalisasi.
 */
export const audibleFiles = (plan: ScenePlan): Job[] => {
  const jobs = new Map<string, string>();
  const add = (file: string | undefined, label: string) => {
    if (file && !jobs.has(file)) jobs.set(file, label);
  };

  // Narasi selalu terdengar — ia inti videonya.
  for (const [sceneId, audio] of Object.entries(plan.renderState.narrationAudio)) {
    add(audio.file, `narasi ${sceneId}`);
  }
  for (const scene of plan.scenes) {
    if (scene.visual.audio.volume > 0) {
      add(plan.renderState.resolvedAssets[scene.id]?.file, `suara aset ${scene.id}`);
    }
    for (const layer of scene.layers) {
      if (layer.visual.audio.volume > 0) {
        add(plan.renderState.layerAssets[layer.id]?.file, `lapisan ${layer.id}`);
      }
    }
  }
  for (const cue of plan.audio.sfx) {
    if (cue.volume > 0) add(plan.renderState.sfxAssets[cue.id]?.file, `efek ${cue.id}`);
  }
  for (const track of plan.audio.tracks) {
    if (track.audio.volume > 0) {
      add(plan.renderState.trackAssets[track.id]?.file, `trek ${track.id}`);
    }
  }
  // Musik ter-bundle ("pustaka:*") sudah punya angka bawaannya di paket
  // templates; hanya musik unggahan proyek yang perlu diukur di sini.
  const music = plan.audio.music;
  if (music && music.volume > 0 && !music.assetId.startsWith("pustaka:")) {
    add(music.assetId, "musik proyek");
  }

  return [...jobs].map(([file, label]) => ({ file, label }));
};

export interface LoudnessStageOptions {
  paths: ProjectPaths;
  plan: ScenePlan;
  db: PipelineDb;
  /** Tanpa ini hanya berkas WAV yang bisa diukur; sisanya dilewati & dilaporkan. */
  probe?: AudioProbe;
  force?: boolean;
  log?: StageLogger;
}

export interface LoudnessStageOutcome {
  plan: ScenePlan;
  results: SceneStageResult[];
}

export const runLoudnessStage = async ({
  paths,
  plan,
  db,
  probe,
  force = false,
  log = consoleLogger,
}: LoudnessStageOptions): Promise<LoudnessStageOutcome> => {
  const results: SceneStageResult[] = [];
  let current = plan;
  const jobs = audibleFiles(plan);
  if (jobs.length === 0) return { plan: current, results };

  let scratch: string | null = null;
  try {
    for (const job of jobs) {
      // `sceneId` di baris hasil diisi PATH BERKAS: tahap ini memang tidak
      // bekerja per scene, dan memalsukan id scene akan menyesatkan pembacanya.
      const row = { sceneId: job.file };
      const absolute = join(paths.planDir, job.file);
      if (!existsSync(absolute)) {
        results.push({ ...row, status: "error", detail: "berkas tidak ditemukan" });
        continue;
      }

      const stat = statSync(absolute);
      const inputHash = contentHash({
        kind: "loudness-r128",
        file: job.file,
        size: stat.size,
        mtimeMs: Math.round(stat.mtimeMs),
      });
      const existing = db.getRun(plan.projectId, job.file, "loudness");
      if (
        !force &&
        existing?.status === "done" &&
        existing.inputHash === inputHash &&
        existing.outputJson
      ) {
        const stored = JSON.parse(existing.outputJson) as {
          lufs: number | null;
          channels?: number;
          skipped?: string;
        };
        if (stored.lufs !== null) {
          current = setLoudness(current, job.file, stored.lufs, stored.channels);
        }
        results.push({
          ...row,
          status: stored.skipped ? "skipped" : "cached",
          detail: stored.skipped
            ? `cache · tidak diukur: ${stored.skipped}`
            : stored.lufs === null
              ? "cache (sunyi)"
              : `cache · ${stored.lufs} LUFS`,
          costUsd: 0,
        });
        continue;
      }

      const isWav = WAV_EXT.has(extensionOf(job.file));
      if (!isWav && !probe) {
        results.push({
          ...row,
          status: "skipped",
          detail:
            "bukan WAV dan tidak ada AudioProbe — tidak diukur, jadi tidak dinormalisasi",
        });
        continue;
      }

      db.startRun(plan.projectId, job.file, "loudness", inputHash);
      const startedAt = Date.now();
      try {
        let bytes: Uint8Array;
        if (isWav) {
          bytes = readFileSync(absolute);
        } else {
          scratch ??= mkdtempSync(join(tmpdir(), "dalang-loudness-"));
          const wav = join(scratch, `${inputHash}.wav`);
          const extracted = await (probe as AudioProbe).toWav(absolute, wav);
          if (!extracted.ok) {
            // Kodek yang tidak bisa didekode BUKAN kegagalan tahap: klipnya
            // tetap dipakai, cuma tanpa normalisasi. Dicatat sebagai dilewati
            // supaya pesannya menjelaskan keadaan, bukan menuduh ada kerusakan.
            db.finishRun(plan.projectId, job.file, "loudness", {
              provider: probe?.id ?? "?",
              fallback: true,
              outputJson: JSON.stringify({ lufs: null, skipped: extracted.reason }),
              costUsd: 0,
              durationMs: Date.now() - startedAt,
            });
            results.push({
              ...row,
              status: "skipped",
              detail: `${job.label} · tidak diukur: ${extracted.reason} — klip ini dipakai apa adanya`,
              provider: probe?.id,
              costUsd: 0,
            });
            continue;
          }
          bytes = readFileSync(wav);
        }
        const measured = measureWavLoudness(bytes);
        const durationMs = Date.now() - startedAt;
        if (measured.lufs !== null) {
          current = setLoudness(current, job.file, measured.lufs, measured.channels);
        }
        db.finishRun(plan.projectId, job.file, "loudness", {
          provider: isWav ? "wav" : (probe?.id ?? "?"),
          fallback: false,
          outputJson: JSON.stringify({
            lufs: measured.lufs,
            peak: measured.peak,
            channels: measured.channels,
          }),
          costUsd: 0,
          durationMs,
        });
        if (measured.peak > 1) {
          // Puncak di atas skala penuh berarti berkasnya SUDAH terpotong
          // sebelum sampai ke sini; normalisasi tidak bisa memperbaikinya.
          log.warn(`  ! ${job.file}: puncak ${measured.peak.toFixed(2)} — sudah kliping`);
        }
        results.push({
          ...row,
          status: "done",
          detail:
            measured.lufs === null
              ? `${job.label} · sunyi (tidak ada blok di atas gerbang -70 LUFS)`
              : `${job.label} · ${measured.lufs} LUFS · puncak ${measured.peak.toFixed(2)}`,
          provider: isWav ? "wav" : probe?.id,
          costUsd: 0,
          durationMs,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        db.failRun(plan.projectId, job.file, "loudness", message, Date.now() - startedAt);
        results.push({ ...row, status: "error", detail: message });
      }
    }
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
    // Probe boleh memegang browser; tanpa ini prosesnya menggantung setelah
    // tahapnya selesai.
    await probe?.close?.();
  }

  return { plan: current, results };
};
