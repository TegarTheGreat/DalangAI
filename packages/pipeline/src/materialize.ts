import { join } from "node:path";
import {
  assignLayerAsset,
  assignResolvedAsset,
  getScene,
  type ResolvedAsset,
  type ScenePlan,
  setLayerAsset,
  setResolvedAsset,
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
 * pinned ditolak oleh core.assignResolvedAsset — KECUALI `allowPinned`
 * (pilihan user dari UI boleh mengganti pilihannya sendiri; renderState
 * ditulis langsung dan `visual.assetId`/`pinned` diserahkan ke patch user
 * `replaceAsset` milik pemanggil, PRD §8.2).
 */
export const materializeCandidate = async ({
  paths,
  plan,
  db,
  sceneId,
  layerId,
  provider,
  candidate,
  allowPinned = false,
}: {
  paths: ProjectPaths;
  plan: ScenePlan;
  db: PipelineDb;
  sceneId: string;
  /** Menyasar satu lapisan video di dalam scene (ADR-0025); kosong = visual dasar. */
  layerId?: string;
  provider: StockProvider;
  candidate: StockCandidate;
  allowPinned?: boolean;
}): Promise<{ plan: ScenePlan; asset: ResolvedAsset }> => {
  const scene = getScene(plan, sceneId);
  if (!scene) throw new Error(`Scene "${sceneId}" tidak ditemukan`);
  if (scene.locked) {
    throw new Error(`Scene "${sceneId}" terkunci — aset tidak boleh diubah`);
  }
  if (layerId !== undefined && !scene.layers.some((layer) => layer.id === layerId)) {
    throw new Error(`Lapisan "${layerId}" tidak ada di scene "${sceneId}"`);
  }

  const inputHash = contentHash({
    kind: "stock-pick",
    assetId: candidate.assetId,
  });
  // Kunci run ikut menyebut lapisannya, sama seperti di auto-resolve: tanpa
  // itu memilih aset lapisan menimpa riwayat pilihan visual dasarnya.
  const runKey = layerId === undefined ? sceneId : `${sceneId}#${layerId}`;
  db.startRun(plan.projectId, runKey, "assets", inputHash);
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
    const next =
      layerId === undefined
        ? allowPinned
          ? setResolvedAsset(plan, sceneId, asset)
          : assignResolvedAsset(plan, sceneId, candidate.assetId, asset)
        : allowPinned
          ? setLayerAsset(plan, layerId, asset)
          : assignLayerAsset(plan, sceneId, layerId, candidate.assetId, asset);

    db.finishRun(plan.projectId, runKey, "assets", {
      provider: candidate.providerId,
      fallback: false,
      outputJson: JSON.stringify({ assetId: candidate.assetId, asset }),
      costUsd: 0,
      durationMs: Date.now() - startedAt,
    });
    return { plan: next, asset };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.failRun(plan.projectId, runKey, "assets", message, Date.now() - startedAt);
    throw error;
  }
};
