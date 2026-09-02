import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import {
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

/**
 * Berkas VIDEO yang dirujuk plan — aset scene dan lapisan yang masih hidup.
 * Gambar tidak pernah butuh proxy; audio tidak digambar.
 */
export const proxyCandidates = (plan: ScenePlan): ProxyJob[] => {
  const jobs = new Map<string, string>();
  const add = (file: string, label: string) => {
    if (!jobs.has(file)) jobs.set(file, label);
  };
  for (const [sceneId, asset] of Object.entries(plan.renderState.resolvedAssets)) {
    if (asset.kind === "video") add(asset.file, `scene ${sceneId}`);
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
}: ProxyStageOptions): Promise<ProxyStageOutcome> => {
  const results: SceneStageResult[] = [];
  let current = plan;
  const wanted = files ? new Set(files) : null;
  const jobs = proxyCandidates(plan).filter((job) => !wanted || wanted.has(job.file));
  if (jobs.length === 0) return { plan: current, results };

  for (const job of jobs) {
    // `sceneId` diisi PATH BERKAS: tahap ini memang bekerja per berkas.
    const row = { sceneId: job.file };
    const absolute = join(paths.planDir, job.file);
    if (!existsSync(absolute)) {
      results.push({ ...row, status: "error", detail: "berkas tidak ditemukan" });
      continue;
    }
    if (!transcoder) {
      results.push({
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
      current = setProxy(current, job.file, stored.proxy, {
        codec: stored.codec,
        fps: stored.fps,
      });
      results.push({
        ...row,
        status: stored.proxy ? "cached" : "skipped",
        detail: stored.proxy
          ? `cache · ${stored.proxy.width}×${stored.proxy.height}`
          : `cache · tidak perlu: ${stored.reason}`,
        costUsd: 0,
      });
      continue;
    }

    db.startRun(plan.projectId, job.file, "proxy", inputHash);
    const startedAt = Date.now();
    try {
      const info = await transcoder.probe(absolute);
      if (!info?.codec) {
        const reason = info ? "tidak punya jalur video" : "tidak terbaca sebagai media";
        db.failRun(plan.projectId, job.file, "proxy", reason, Date.now() - startedAt);
        results.push({ ...row, status: "error", detail: `${job.label} · ${reason}` });
        continue;
      }
      const decision = proxyDecision(info);
      const note = { codec: info.codec, fps: info.fps };
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
        results.push({
          ...row,
          status: "skipped",
          detail: `${job.label} · tidak perlu: ${decision.reason}`,
          provider: transcoder.id,
          costUsd: 0,
        });
        continue;
      }

      const dims = proxyDimensions(info.width, info.height);
      const fps = proxyFps(info.fps);
      mkdirSync(paths.proxiesDir, { recursive: true });
      const outputAbs = join(paths.proxiesDir, `${inputHash}-${PROXY_SHORT_SIDE}p.mp4`);
      const made = await transcoder.makeProxy({
        sourcePath: absolute,
        outputPath: outputAbs,
        width: dims.width,
        height: dims.height,
        ...(fps ? { fps } : {}),
      });
      const durationMs = Date.now() - startedAt;
      if (!made.ok) {
        db.failRun(plan.projectId, job.file, "proxy", made.reason, durationMs);
        results.push({
          ...row,
          status: "error",
          detail: `${job.label} · gagal membuat proxy: ${made.reason}`,
          provider: transcoder.id,
          durationMs,
        });
        continue;
      }
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
      results.push({
        ...row,
        status: "done",
        detail: `${job.label} · ${made.width}×${made.height}${made.fps ? ` ${Math.round(made.fps)} fps` : ""} · ${decision.reason}`,
        provider: transcoder.id,
        costUsd: 0,
        durationMs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      db.failRun(plan.projectId, job.file, "proxy", message, Date.now() - startedAt);
      results.push({ ...row, status: "error", detail: message });
    }
  }

  return { plan: current, results };
};
