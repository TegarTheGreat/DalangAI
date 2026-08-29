import { join } from "node:path";
import {
  assignResolvedAsset,
  getScene,
  type ResolvedAsset,
  type ScenePlan,
} from "@dalang/core";
import type { PipelineDb } from "./db";
import { atomicWriteFile } from "./fs-utils";
import { contentHash } from "./hash";
import type { StockCandidate, StockProvider } from "./ports";
import type { ProjectPaths } from "./project-paths";

/**
 * Materialize ONE chosen stock candidate into the project: download, write
 * content-addressed, assign to the scene, record in the ledger. Dipakai oleh
 * tool agent `pickAsset` (agent/user memilih kandidat eksplisit — fondasi
 * R-4) di luar jalur auto-resolve stage.
 *
 * Invarian yang sama tetap berlaku: scene terkunci ditolak di sini; scene
 * pinned ditolak oleh core.assignResolvedAsset.
 */
export const materializeCandidate = async ({
  paths,
  plan,
  db,
  sceneId,
  provider,
  candidate,
}: {
  paths: ProjectPaths;
  plan: ScenePlan;
  db: PipelineDb;
  sceneId: string;
  provider: StockProvider;
  candidate: StockCandidate;
}): Promise<{ plan: ScenePlan; asset: ResolvedAsset }> => {
  const scene = getScene(plan, sceneId);
  if (!scene) throw new Error(`Scene "${sceneId}" tidak ditemukan`);
  if (scene.locked) {
    throw new Error(`Scene "${sceneId}" terkunci — aset tidak boleh diubah`);
  }

  const inputHash = contentHash({
    kind: "stock-pick",
    assetId: candidate.assetId,
  });
  db.startRun(plan.projectId, sceneId, "assets", inputHash);
  const startedAt = Date.now();

  try {
    const bytes = await provider.download(candidate);
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
    const next = assignResolvedAsset(plan, sceneId, candidate.assetId, asset);

    db.finishRun(plan.projectId, sceneId, "assets", {
      provider: candidate.providerId,
      fallback: false,
      outputJson: JSON.stringify({ assetId: candidate.assetId, asset }),
      costUsd: 0,
      durationMs: Date.now() - startedAt,
    });
    return { plan: next, asset };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.failRun(plan.projectId, sceneId, "assets", message, Date.now() - startedAt);
    throw error;
  }
};
