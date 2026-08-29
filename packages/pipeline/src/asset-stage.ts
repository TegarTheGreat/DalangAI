import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type AspectRatio,
  assignResolvedAsset,
  type ResolvedAsset,
  resolvedAssetSchema,
  type ScenePlan,
} from "@dalang/core";
import type { PipelineDb } from "./db";
import { atomicWriteFile, round3 } from "./fs-utils";
import { contentHash } from "./hash";
import type { StockCandidate, StockKind, StockOrientation, StockProvider } from "./ports";
import type { ProjectPaths } from "./project-paths";
import { consoleLogger, type SceneStageResult, type StageLogger } from "./stage-types";

/**
 * Asset-resolve stage — per-scene, cached, resumable (PRD §7.1 [3], §7.2).
 *
 * Fase 1 scope: `visual.type === "stock"` only. Selection is deterministic
 * (first candidate, video before image); reranking by a cheap vision model is
 * R-4 / Fase 2. Pinned scenes are never touched (hard invariant, enforced by
 * core.assignResolvedAsset as well); locked scenes are also skipped — a lock
 * means "leave this scene alone", including its visual.
 */

const KIND_PREFERENCE: StockKind[] = ["video", "image"];
const PER_PAGE = 8;

export const orientationForAspect = (aspect: AspectRatio): StockOrientation =>
  aspect === "9:16" ? "portrait" : aspect === "16:9" ? "landscape" : "square";

/** Deterministic query when the plan author gave none. */
export const deriveQuery = (narration: string, maxWords = 8): string =>
  narration.trim().split(/\s+/).slice(0, maxWords).join(" ");

interface StoredAssetOutput {
  assetId: string;
  asset: ResolvedAsset;
}

export interface AssetStageOptions {
  paths: ProjectPaths;
  plan: ScenePlan;
  /** Fallback chain, primary first. May be empty (every scene errors clearly). */
  providers: StockProvider[];
  db: PipelineDb;
  force?: boolean;
  log?: StageLogger;
}

export interface AssetStageOutcome {
  plan: ScenePlan;
  results: SceneStageResult[];
}

export const runAssetStage = async ({
  paths,
  plan,
  providers,
  db,
  force = false,
  log = consoleLogger,
}: AssetStageOptions): Promise<AssetStageOutcome> => {
  const results: SceneStageResult[] = [];
  let current = plan;

  const stockScenes = plan.scenes.filter((scene) => scene.visual.type === "stock");
  const orientation = orientationForAspect(plan.meta.aspectRatio);

  for (const scene of stockScenes) {
    if (scene.visual.pinned) {
      results.push({
        sceneId: scene.id,
        status: "skipped",
        detail: "aset ter-pin (pilihan eksplisit dihormati)",
      });
      continue;
    }
    if (scene.locked) {
      results.push({
        sceneId: scene.id,
        status: "skipped",
        detail: "scene terkunci",
      });
      continue;
    }

    const query = scene.visual.query?.trim() || deriveQuery(scene.narration);
    if (query === "") {
      results.push({
        sceneId: scene.id,
        status: "error",
        detail: "tidak ada query maupun narasi untuk mencari aset",
      });
      continue;
    }
    const derived = !scene.visual.query?.trim();

    const inputHash = contentHash({
      kind: "stock-resolve",
      query,
      orientation,
      preference: KIND_PREFERENCE,
    });

    const existing = db.getRun(plan.projectId, scene.id, "assets");
    if (
      !force &&
      existing?.status === "done" &&
      existing.inputHash === inputHash &&
      existing.outputJson
    ) {
      const stored = JSON.parse(existing.outputJson) as StoredAssetOutput;
      const asset = resolvedAssetSchema.parse(stored.asset);
      if (existsSync(join(paths.planDir, asset.file))) {
        current = assignResolvedAsset(current, scene.id, stored.assetId, asset);
        results.push({
          sceneId: scene.id,
          status: "cached",
          detail: `cache (${existing.provider ?? "?"})`,
          provider: existing.provider ?? undefined,
          fallback: existing.fallback,
          costUsd: 0,
        });
        continue;
      }
    }

    if (providers.length === 0) {
      results.push({
        sceneId: scene.id,
        status: "error",
        detail:
          "tidak ada provider stock yang terkonfigurasi — set PEXELS_API_KEY dan/atau PIXABAY_API_KEY",
      });
      continue;
    }

    db.startRun(plan.projectId, scene.id, "assets", inputHash);
    const startedAt = Date.now();
    let resolved: { candidate: StockCandidate; bytes: Uint8Array } | null = null;
    let usedFallback = false;
    let lastError = "tidak ada kandidat ditemukan";

    outer: for (const kind of KIND_PREFERENCE) {
      for (let index = 0; index < providers.length; index++) {
        const provider = providers[index]!;
        try {
          const candidates = await provider.search({
            query,
            kind,
            orientation,
            perPage: PER_PAGE,
          });
          const candidate = candidates[0];
          if (!candidate) continue;
          const bytes = await provider.download(candidate);
          resolved = { candidate, bytes };
          usedFallback = index > 0;
          break outer;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          log.warn(
            `  provider ${provider.id} gagal (${kind}) untuk ${scene.id}: ${lastError}`,
          );
        }
      }
    }

    if (!resolved) {
      const durationMs = Date.now() - startedAt;
      db.failRun(plan.projectId, scene.id, "assets", lastError, durationMs);
      results.push({
        sceneId: scene.id,
        status: "error",
        detail: `${lastError} (query: "${query}")`,
        durationMs,
      });
      continue;
    }

    const { candidate, bytes } = resolved;
    const file = join(paths.assetsDir, `${inputHash}.${candidate.fileExt}`);
    atomicWriteFile(file, bytes);

    const asset: ResolvedAsset = {
      file: paths.relFromPlan(file),
      kind: candidate.kind,
      source: candidate.providerId,
      ...(candidate.sourceUrl ? { sourceUrl: candidate.sourceUrl } : {}),
      ...(candidate.author ? { author: candidate.author } : {}),
      license: candidate.license,
      width: candidate.width,
      height: candidate.height,
    };
    current = assignResolvedAsset(current, scene.id, candidate.assetId, asset);

    const durationMs = Date.now() - startedAt;
    const stored: StoredAssetOutput = { assetId: candidate.assetId, asset };
    db.finishRun(plan.projectId, scene.id, "assets", {
      provider: candidate.providerId,
      fallback: usedFallback,
      outputJson: JSON.stringify(stored),
      costUsd: 0,
      durationMs,
    });
    if (usedFallback) {
      log.warn(`  ⚠ ${scene.id}: aset dari provider fallback (${candidate.providerId})`);
    }
    results.push({
      sceneId: scene.id,
      status: "done",
      detail:
        `${candidate.providerId} · ${candidate.kind} ${candidate.width}×${candidate.height}` +
        `${derived ? ` · query turunan: "${query}"` : ""} · ${round3(bytes.byteLength / 1024 / 1024)} MB`,
      provider: candidate.providerId,
      fallback: usedFallback,
      costUsd: 0,
      durationMs,
    });
  }

  return { plan: current, results };
};
