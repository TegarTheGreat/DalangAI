import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  type MediaProbeNote,
  orphanMediaAssetIds,
  PROXY_SHORT_SIDE,
  type ProxyMedia,
  proxyDecision,
  proxyDimensions,
  proxyFps,
  type ScenePlan,
  setProxy,
} from "@dalang/core";
import type { PipelineDb } from "./db";
import { contentHash } from "./hash";
import type { MediaTranscoder } from "./ports";
import type { ProjectPaths } from "./project-paths";
import { consoleLogger, type SceneStageResult, type StageLogger } from "./stage-types";

/**
 * Tahap proxy (ADR-0028, roadmap §9.5).
 *
 * DIKUNCI PER BERKAS, seperti transkrip (ADR-0021) dan kenyaringan (ADR-0026):
 * satu rekaman yang dipakai lima scene di-proxy sekali, dan proxy-nya tetap
 * sah saat scene-nya dipotong ulang — trim adalah keputusan kreatif yang
 * hidup di scene, proxy adalah turunan yang hidup di berkas.
 *
 * Yang diputuskan di sini hanya "berkas mana" dan "sudah atau belum"; "perlu
 * atau tidak" adalah keputusan MURNI di @dalang/core (`proxyDecision`), supaya
 * ia bisa diuji tanpa ffmpeg dan alasannya sama persis di CLI, Studio, dan
 * laporan agent.
 */

/** Satu berkas video yang dirujuk plan, beserta pemakainya (untuk laporan). */
export interface ProxyJob {
  file: string;
  label: string;
}

/** Kemajuan satu berkas: `index`/`total` di antrean, `fraction` 0..1 di berkas itu. */
export interface ProxyProgressEvent {
  file: string;
  label: string;
  index: number;
  total: number;
  fraction: number;
}

/**
 * Satu berkas SELESAI diproses (apa pun hasilnya). `proxy` hadir — null atau
 * media — bila ada yang harus ditulis ke renderState pemanggil: Studio
 * memakainya untuk menulis ke plan HIDUP per berkas, bukan menunggu seluruh
 * antrean selesai lalu menimpa plan yang mungkin sudah diedit orang.
 */
export interface ProxyFileEvent {
  file: string;
  label: string;
  result: SceneStageResult;
  proxy?: ProxyMedia | null;
  note?: MediaProbeNote;
}

/**
 * Berkas VIDEO yang dirujuk plan — aset scene dan lapisan yang masih hidup.
 * Gambar tidak pernah butuh proxy; audio tidak digambar.
 */
export const proxyCandidates = (plan: ScenePlan): ProxyJob[] => {
  const jobs = new Map<string, string>();
  const add = (file: string, label: string) => {
    if (!jobs.has(file)) jobs.set(file, label);
  };
  // Labelnya menyebut SCENE, bukan id klip: yang dibaca orang di progres
  // proxy adalah satuan yang mereka kenali di timeline (ADR-0033).
  const sceneOfClip = new Map<string, string>();
  for (const scene of plan.scenes) {
    for (const clip of scene.clips) sceneOfClip.set(clip.id, scene.id);
  }
  for (const [clipId, asset] of Object.entries(plan.renderState.clipAssets)) {
    if (asset.kind !== "video") continue;
    add(asset.file, `scene ${sceneOfClip.get(clipId) ?? clipId}`);
  }
  const orphans = new Set(orphanMediaAssetIds(plan).layers);
  for (const [layerId, asset] of Object.entries(plan.renderState.layerAssets)) {
    if (asset.kind === "video" && !orphans.has(layerId)) {
      add(asset.file, `lapisan ${layerId}`);
    }
  }
  return [...jobs].map(([file, label]) => ({ file, label }));
};

/** Isi ledger satu jalan tahap proxy — cukup untuk memulihkannya dari cache. */
interface StoredProxyRun {
  proxy: ProxyMedia | null;
  codec: string | null;
  fps: number | null;
  reason: string;
}

export interface ProxyStageOptions {
  paths: ProjectPaths;
  plan: ScenePlan;
  db: PipelineDb;
  /** Tanpa transkoder tahap ini melewati semua berkas dan MENGATAKANNYA. */
  transcoder?: MediaTranscoder;
  /** Batasi ke berkas tertentu (path relatif-plan); kosong = semua kandidat. */
  files?: string[];
  force?: boolean;
  log?: StageLogger;
  /** Kemajuan per berkas (ADR-0028 §10). */
  onProgress?: (event: ProxyProgressEvent) => void;
  /** Dipanggil setiap satu berkas selesai — done, cached, skipped, atau error. */
  onFile?: (event: ProxyFileEvent) => void;
  /**
   * Pembatalan: berkas yang sedang dibuat dihentikan (ffmpeg dibunuh, berkas
   * setengah jadi dibuang) dan sisanya dilaporkan "dibatalkan", bukan gagal.
   */
  signal?: AbortSignal;
}

export interface ProxyStageOutcome {
  plan: ScenePlan;
  results: SceneStageResult[];
}

export const runProxyStage = async ({
  paths,
  plan,
  db,
  transcoder,
  files,
  force = false,
  log = consoleLogger,
  onProgress,
  onFile,
  signal,
}: ProxyStageOptions): Promise<ProxyStageOutcome> => {
  const results: SceneStageResult[] = [];
  let current = plan;
  const wanted = files ? new Set(files) : null;
  const jobs = proxyCandidates(plan).filter((job) => !wanted || wanted.has(job.file));
  if (jobs.length === 0) return { plan: current, results };
  const total = jobs.length;

  for (const [position, job] of jobs.entries()) {
    const index = position + 1;
    // `sceneId` diisi PATH BERKAS: tahap ini memang bekerja per berkas.
    const row = { sceneId: job.file };
    const finish = (
      result: SceneStageResult,
      applied?: { proxy: ProxyMedia | null; note: MediaProbeNote },
    ) => {
      results.push(result);
      onFile?.({ file: job.file, label: job.label, result, ...(applied ?? {}) });
    };
    const progress = (fraction: number) =>
      onProgress?.({ file: job.file, label: job.label, index, total, fraction });

    if (signal?.aborted) {
      finish({ ...row, status: "skipped", detail: `${job.label} · dibatalkan` });
      continue;
    }
    const absolute = join(paths.planDir, job.file);
    if (!existsSync(absolute)) {
      finish({ ...row, status: "error", detail: "berkas tidak ditemukan" });
      continue;
    }
    if (!transcoder) {
      finish({
        ...row,
        status: "skipped",
        detail: "tidak ada transkoder — preview memakai berkas aslinya",
      });
      continue;
    }

    const stat = statSync(absolute);
    const inputHash = contentHash({
      kind: "proxy-v1",
      file: job.file,
      size: stat.size,
      mtimeMs: Math.round(stat.mtimeMs),
      shortSide: PROXY_SHORT_SIDE,
    });
    const existing = db.getRun(plan.projectId, job.file, "proxy");
    const stored = existing?.outputJson
      ? (JSON.parse(existing.outputJson) as StoredProxyRun)
      : null;
    if (
      !force &&
      existing?.status === "done" &&
      existing.inputHash === inputHash &&
      stored &&
      // Proxy yang berkasnya sudah dihapus dari disk BUKAN cache hit: memakai
      // entri ledger tanpa berkasnya membuat preview 404 dengan tenang.
      (stored.proxy === null || existsSync(join(paths.planDir, stored.proxy.file)))
    ) {
      const note: MediaProbeNote = { codec: stored.codec, fps: stored.fps };
      current = setProxy(current, job.file, stored.proxy, note);
      finish(
        {
          ...row,
          status: stored.proxy ? "cached" : "skipped",
          detail: stored.proxy
            ? `cache · ${stored.proxy.width}×${stored.proxy.height}`
            : `cache · tidak perlu: ${stored.reason}`,
          costUsd: 0,
        },
        { proxy: stored.proxy, note },
      );
      continue;
    }

    db.startRun(plan.projectId, job.file, "proxy", inputHash);
    const startedAt = Date.now();
    try {
      progress(0);
      const info = await transcoder.probe(absolute);
      if (!info?.codec) {
        const reason = info ? "tidak punya jalur video" : "tidak terbaca sebagai media";
        db.failRun(plan.projectId, job.file, "proxy", reason, Date.now() - startedAt);
        finish({ ...row, status: "error", detail: `${job.label} · ${reason}` });
        continue;
      }
      const decision = proxyDecision(info);
      const note: MediaProbeNote = { codec: info.codec, fps: info.fps };
      if (!decision.needed) {
        // Proxy lama dari sumber yang sudah berganti isi dibersihkan di sini
        // juga: berkas yang tidak dirujuk siapa pun hanya memenuhi disk.
        if (stored?.proxy)
          rmSync(join(paths.planDir, stored.proxy.file), { force: true });
        current = setProxy(current, job.file, null, note);
        db.finishRun(plan.projectId, job.file, "proxy", {
          provider: transcoder.id,
          fallback: false,
          outputJson: JSON.stringify({
            proxy: null,
            codec: info.codec,
            fps: info.fps,
            reason: decision.reason,
          } satisfies StoredProxyRun),
          costUsd: 0,
          durationMs: Date.now() - startedAt,
        });
        finish(
          {
            ...row,
            status: "skipped",
            detail: `${job.label} · tidak perlu: ${decision.reason}`,
            provider: transcoder.id,
            costUsd: 0,
          },
          { proxy: null, note },
        );
        continue;
      }

      const dims = proxyDimensions(info.width, info.height);
      const fps = proxyFps(info.fps);
      mkdirSync(paths.proxiesDir, { recursive: true });
      const outputAbs = join(paths.proxiesDir, `${inputHash}-${PROXY_SHORT_SIDE}p.mp4`);
      // Ditulis ke berkas sementara lalu di-rename: dua penulis untuk berkas
      // yang sama (Studio di latar dan agent `ingestVideo`) tidak pernah
      // saling merusak — rename itu atomik, dan yang terakhir menang dengan
      // berkas yang utuh. Ekstensinya tetap .mp4 supaya muxer-nya benar.
      const outputTmp = join(
        paths.proxiesDir,
        `${inputHash}-${PROXY_SHORT_SIDE}p.${process.pid}-${startedAt}.tmp.mp4`,
      );
      const made = await transcoder.makeProxy(
        {
          sourcePath: absolute,
          outputPath: outputTmp,
          width: dims.width,
          height: dims.height,
          ...(fps ? { fps } : {}),
          durationSec: info.durationSec,
        },
        { onProgress: progress, ...(signal ? { signal } : {}) },
      );
      const durationMs = Date.now() - startedAt;
      if (!made.ok) {
        rmSync(outputTmp, { force: true });
        if (signal?.aborted) {
          db.failRun(plan.projectId, job.file, "proxy", "dibatalkan", durationMs);
          finish({
            ...row,
            status: "skipped",
            detail: `${job.label} · dibatalkan`,
            provider: transcoder.id,
            durationMs,
          });
          continue;
        }
        db.failRun(plan.projectId, job.file, "proxy", made.reason, durationMs);
        finish({
          ...row,
          status: "error",
          detail: `${job.label} · gagal membuat proxy: ${made.reason}`,
          provider: transcoder.id,
          durationMs,
        });
        continue;
      }
      renameSync(outputTmp, outputAbs);
      progress(1);
      if (stored?.proxy && stored.proxy.file !== paths.relFromPlan(outputAbs)) {
        rmSync(join(paths.planDir, stored.proxy.file), { force: true });
      }
      const proxy: ProxyMedia = {
        file: paths.relFromPlan(outputAbs),
        width: made.width,
        height: made.height,
        ...(made.fps ? { fps: made.fps } : {}),
      };
      current = setProxy(current, job.file, proxy, note);
      db.finishRun(plan.projectId, job.file, "proxy", {
        provider: transcoder.id,
        fallback: false,
        outputJson: JSON.stringify({
          proxy,
          codec: info.codec,
          fps: info.fps,
          reason: decision.reason,
        } satisfies StoredProxyRun),
        costUsd: 0,
        durationMs,
      });
      log.info(`  proxy ${job.file} → ${proxy.file} (${decision.reason})`);
      finish(
        {
          ...row,
          status: "done",
          detail: `${job.label} · ${made.width}×${made.height}${made.fps ? ` ${Math.round(made.fps)} fps` : ""} · ${decision.reason}`,
          provider: transcoder.id,
          costUsd: 0,
          durationMs,
        },
        { proxy, note },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      db.failRun(plan.projectId, job.file, "proxy", message, Date.now() - startedAt);
      finish({ ...row, status: "error", detail: message });
    }
  }

  return { plan: current, results };
};
