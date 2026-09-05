import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PublishMetadata } from "@dalang/core";
import type { PipelineDb } from "./db";
import { contentHash } from "./hash";
import type { PublishResult, PublishTarget } from "./ports";
import type { ProjectPaths } from "./project-paths";

/**
 * Publikasi satu berkas render (ADR-0030), DIKUNCI DI LEDGER seperti tahap
 * lain: berkas yang isinya sama dan sudah terunggah ke tujuan yang sama tidak
 * diunggah dua kali — unggahan ganda menghasilkan dua video di kanal orang,
 * dan itu bukan hal yang bisa dibatalkan dengan Ctrl+Z. `force` memaksa
 * unggah ulang (isinya sama, video baru).
 */

export interface PublishedRecord {
  targetId: string;
  videoId: string;
  url: string;
  title: string;
  privacy: PublishMetadata["privacy"];
  at: string;
}

export interface PublishRenderOptions {
  paths: ProjectPaths;
  db: PipelineDb;
  projectId: string;
  target: PublishTarget;
  /** Path absolut berkas render. */
  filePath: string;
  metadata: PublishMetadata;
  force?: boolean;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export type PublishRenderOutcome =
  | { status: "done" | "cached"; record: PublishedRecord }
  | { status: "error"; reason: string };

/** Kunci ledger: path relatif plan — sama dengan tahap per-berkas lain. */
export const publishLedgerKey = (paths: ProjectPaths, filePath: string): string =>
  paths.relFromPlan(filePath);

const RENDER_FILE = /\.(mp4|webm|mov)$/;

/**
 * Nama berkas render TERBARU (mtime) di sebuah folder render, atau null.
 * Dipakai CLI dan agent supaya "unggah hasil terakhir" berarti hal yang sama.
 */
export const latestRenderFile = (rendersDir: string): string | null => {
  if (!existsSync(rendersDir)) return null;
  const files = readdirSync(rendersDir)
    .filter((name) => RENDER_FILE.test(name))
    .map((name) => ({ name, mtimeMs: statSync(join(rendersDir, name)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0]?.name ?? null;
};

/** Catatan publikasi tersimpan untuk sebuah berkas, atau null. */
export const publishedRecordFor = (
  db: PipelineDb,
  projectId: string,
  paths: ProjectPaths,
  filePath: string,
): PublishedRecord | null => {
  const run = db.getRun(projectId, publishLedgerKey(paths, filePath), "publish");
  if (run?.status !== "done" || !run.outputJson) return null;
  try {
    return JSON.parse(run.outputJson) as PublishedRecord;
  } catch {
    return null;
  }
};

export const publishRender = async ({
  paths,
  db,
  projectId,
  target,
  filePath,
  metadata,
  force = false,
  onProgress,
  signal,
}: PublishRenderOptions): Promise<PublishRenderOutcome> => {
  if (!existsSync(filePath))
    return { status: "error", reason: "berkas render tidak ditemukan" };
  const stat = statSync(filePath);
  const key = publishLedgerKey(paths, filePath);
  const inputHash = contentHash({
    kind: "publish-v1",
    file: key,
    size: stat.size,
    mtimeMs: Math.round(stat.mtimeMs),
    target: target.id,
  });
  const existing = db.getRun(projectId, key, "publish");
  if (
    !force &&
    existing?.status === "done" &&
    existing.inputHash === inputHash &&
    existing.outputJson
  ) {
    return {
      status: "cached",
      record: JSON.parse(existing.outputJson) as PublishedRecord,
    };
  }

  db.startRun(projectId, key, "publish", inputHash);
  const startedAt = Date.now();
  try {
    const result: PublishResult = await target.publish({
      filePath,
      title: metadata.title,
      description: metadata.description,
      tags: metadata.tags,
      privacy: metadata.privacy,
      ...(metadata.language ? { language: metadata.language } : {}),
      ...(onProgress ? { onProgress } : {}),
      ...(signal ? { signal } : {}),
    });
    const record: PublishedRecord = {
      targetId: result.providerId,
      videoId: result.videoId,
      url: result.url,
      title: metadata.title,
      privacy: metadata.privacy,
      at: new Date().toISOString(),
    };
    db.finishRun(projectId, key, "publish", {
      provider: target.id,
      fallback: false,
      outputJson: JSON.stringify(record),
      costUsd: 0,
      durationMs: Date.now() - startedAt,
    });
    return { status: "done", record };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    db.failRun(projectId, key, "publish", reason, Date.now() - startedAt);
    return { status: "error", reason };
  }
};
