import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DIMENSIONS, parseScenePlan, type ScenePlan } from "@dalang/core";
import {
  assertSafeRelative,
  DEFAULT_EXPORT_SETTINGS,
  type ExportSettings,
  PROFILES,
  planAssetFiles,
  type RenderCostEstimate,
  type RenderProfile,
  type RenderRequest,
  type RenderTarget,
  type RenderVideoResult,
  resolveExportSettings,
} from "@dalang/renderer";
import { computeFrameLayout, FPS } from "@dalang/templates/layout";
import { estimateLambdaCost } from "./cost";
import { contentTypeFor } from "./mime";
import type { AssetStore, LambdaRenderClient } from "./ports";

/**
 * Target render cloud: Remotion Lambda (ADR-0019, PRD Fase 5).
 *
 * Urutannya: unggah aset plan → mulai render dari situs yang SUDAH terpasang →
 * pantau kemajuan → unduh hasilnya. Situsnya tidak dipasang ulang per render;
 * itulah gunanya aset plan dialamatkan lewat URL.
 *
 * Semua panggilan AWS di-inject (lihat `ports.ts`), jadi urutan langkah di sini
 * teruji tanpa akun AWS. Yang tidak bisa diuji di sini adalah apakah AWS
 * menjawab sesuai dokumentasinya — untuk itu ada `dalang cloud:check`.
 */

export interface LambdaTargetConfig {
  /** URL situs Remotion yang sudah ter-deploy (hasil deploySiteFromBundle). */
  serveUrl: string;
  compositionId: string;
  memorySizeInMb: number;
  framesPerLambda: number;
  /** Jeda antar polling kemajuan, ms. */
  pollIntervalMs?: number;
  /** Batas waktu keseluruhan, ms. */
  timeoutMs?: number;
}

export interface LambdaTargetDeps {
  client: LambdaRenderClient;
  assets: AssetStore;
  /** Disuntikkan supaya polling bisa dipercepat di test. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const CODEC_FOR: Record<ExportSettings["format"], "h264" | "h265" | "vp9" | "prores"> = {
  mp4: "h264",
  hevc: "h265",
  webm: "vp9",
  mov: "prores",
};

const AUDIO_CODEC_FOR: Record<ExportSettings["format"], "aac" | "opus" | "pcm-16"> = {
  mp4: "aac",
  hevc: "aac",
  webm: "opus",
  mov: "pcm-16",
};

const CRF_FOR: Record<ExportSettings["quality"], number> = {
  cepat: 28,
  seimbang: 23,
  terbaik: 18,
};

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/**
 * Panjang dan ukuran video dihitung dari PLAN, bukan dari komposisi yang sudah
 * dipilih browser — target ini tidak menjalankan Chromium di mesin pemanggil
 * sama sekali. Sumbernya sama persis dengan yang dipakai `calculateMetadata`,
 * jadi angkanya tidak bisa berbeda dari yang dirender Lambda.
 */
const frameCountOf = (plan: ScenePlan): { totalFrames: number; fps: number } => ({
  totalFrames: computeFrameLayout(plan).totalFrames,
  fps: FPS,
});

const dimensionsOf = (plan: ScenePlan): { width: number; height: number } =>
  DIMENSIONS[plan.meta.aspectRatio];

const loadPlan = (planPath: string): ScenePlan => {
  const absolute = resolve(planPath);
  if (!existsSync(absolute)) {
    throw new Error(`Scene-plan tidak ditemukan: ${absolute}`);
  }
  return parseScenePlan(JSON.parse(readFileSync(absolute, "utf8")));
};

/**
 * Unggah aset plan yang belum ada di penyimpanan. Mengembalikan berapa yang
 * benar-benar diunggah — angka itu dipakai laporan progres, dan juga menjadi
 * bukti di test bahwa render kedua tidak mengunggah ulang apa pun.
 */
export const uploadPlanAssets = async (
  planPath: string,
  plan: ScenePlan,
  assets: AssetStore,
  onProgress?: (done: number, total: number) => void,
): Promise<{ uploaded: number; skipped: number; urls: Record<string, string> }> => {
  const planDir = dirname(resolve(planPath));
  const files = planAssetFiles(plan);
  let uploaded = 0;
  let skipped = 0;

  for (const [index, file] of files.entries()) {
    assertSafeRelative(file);
    const absolute = join(planDir, file);
    if (!existsSync(absolute)) {
      throw new Error(`Aset yang dirujuk renderState tidak ditemukan: ${absolute}`);
    }
    const bytes = new Uint8Array(readFileSync(absolute));
    const digest = sha256(bytes);
    if (await assets.has(plan.projectId, file, digest)) {
      skipped += 1;
    } else {
      await assets.upload({
        projectId: plan.projectId,
        file,
        bytes,
        contentType: contentTypeFor(file),
        sha256: digest,
      });
      uploaded += 1;
    }
    onProgress?.(index + 1, files.length);
  }

  // URL diminta SETELAH semua terunggah: URL bertanda tangan punya umur, dan
  // menandatanganinya lebih awal berarti membuang sebagian umurnya untuk
  // menunggu unggahan berkas lain selesai.
  const urls: Record<string, string> = {};
  for (const file of files) {
    urls[file] = await assets.urlFor(plan.projectId, file);
  }
  return { uploaded, skipped, urls };
};

/** Hasil render Lambda: `RenderVideoResult` plus jejak unggahan asetnya. */
export interface LambdaRenderResult extends RenderVideoResult {
  assetsUploaded: number;
  assetsReused: number;
}

export const createLambdaRenderTarget = (
  config: LambdaTargetConfig,
  deps: LambdaTargetDeps,
): RenderTarget => {
  const pollIntervalMs = config.pollIntervalMs ?? 2000;
  const timeoutMs = config.timeoutMs ?? 30 * 60_000;
  const sleep = deps.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
  const now = deps.now ?? (() => Date.now());

  const costOf = (plan: ScenePlan, profile: RenderProfile): RenderCostEstimate => {
    // Durasi diambil dari plan, bukan dari komposisi yang sudah dipilih: target
    // ini tidak menjalankan browser di mesin pemanggil sama sekali.
    const { totalFrames, fps } = frameCountOf(plan);
    const breakdown = estimateLambdaCost({
      durationInFrames: totalFrames,
      fps,
      framesPerLambda: config.framesPerLambda,
      memorySizeInMb: config.memorySizeInMb,
    });
    return {
      usd: breakdown.usd,
      detail:
        `~${breakdown.lambdasInvoked} invokasi Lambda ${config.memorySizeInMb} MB, ` +
        `~${breakdown.gbSeconds} GB-detik untuk ${totalFrames} frame (profil ${profile}). ` +
        "Estimasi kasar dan sengaja dibulatkan ke atas.",
    };
  };

  return {
    id: "lambda",
    label: "Remotion Lambda (AWS)",

    estimateCost: async (request: RenderRequest) =>
      costOf(loadPlan(request.planPath), request.profile),

    render: async (request: RenderRequest): Promise<RenderVideoResult> => {
      const plan = loadPlan(request.planPath);
      const settings = resolveExportSettings(request.profile, request.settings);
      const report = request.onProgress;

      report?.({ stage: "uploading", progress: 0 });
      const upload = await uploadPlanAssets(
        request.planPath,
        plan,
        deps.assets,
        (done, total) =>
          report?.({ stage: "uploading", progress: total === 0 ? 1 : done / total }),
      );
      report?.({ stage: "uploading", progress: 1 });

      const started = await deps.client.startRender({
        serveUrl: config.serveUrl,
        composition: config.compositionId,
        inputProps: {
          plan,
          debug: PROFILES[request.profile].debug,
          assetUrls: upload.urls,
        },
        codec: CODEC_FOR[settings.format],
        audioCodec: AUDIO_CODEC_FOR[settings.format],
        crf: CRF_FOR[settings.quality],
        scale: settings.resolution / 1080,
        imageFormat: "jpeg",
        privacy: "private",
      });

      const deadline = now() + timeoutMs;
      let progress = await deps.client.getProgress(started);
      while (!progress.done) {
        if (progress.fatalErrorEncountered) {
          throw new Error(
            `Render Lambda gagal: ${progress.errors.map((e) => e.message).join("; ") || "tanpa pesan"}`,
          );
        }
        if (request.signal?.aborted) {
          throw new Error("Render Lambda dibatalkan");
        }
        if (now() > deadline) {
          throw new Error(
            `Render Lambda melewati batas ${Math.round(timeoutMs / 1000)} dtk (kemajuan terakhir ${Math.round(progress.overallProgress * 100)}%)`,
          );
        }
        report?.({ stage: "rendering", progress: progress.overallProgress });
        await sleep(pollIntervalMs);
        progress = await deps.client.getProgress(started);
      }
      if (progress.fatalErrorEncountered) {
        throw new Error(
          `Render Lambda gagal: ${progress.errors.map((e) => e.message).join("; ") || "tanpa pesan"}`,
        );
      }

      report?.({ stage: "downloading", progress: 0 });
      const sizeBytes = await deps.client.download({
        renderId: started.renderId,
        bucketName: started.bucketName,
        outPath: request.outputLocation,
      });
      report?.({ stage: "downloading", progress: 1 });

      const { totalFrames, fps } = frameCountOf(plan);
      const { width, height } = dimensionsOf(plan);
      const result: LambdaRenderResult = {
        outputLocation: request.outputLocation,
        sizeBytes,
        durationSec: Number((totalFrames / fps).toFixed(2)),
        durationInFrames: totalFrames,
        width: Math.round(width * (settings.resolution / 1080)),
        height: Math.round(height * (settings.resolution / 1080)),
        // Situs Lambda memang selalu dipakai ulang — itu inti rancangannya.
        bundleFromCache: true,
        settings,
        assetsUploaded: upload.uploaded,
        assetsReused: upload.skipped,
      };
      return result;
    },
  };
};

export const DEFAULT_LAMBDA_CONFIG = {
  memorySizeInMb: 2048,
  framesPerLambda: 20,
} as const;

export { DEFAULT_EXPORT_SETTINGS };
