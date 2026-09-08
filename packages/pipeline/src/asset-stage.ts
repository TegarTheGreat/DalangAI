import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import {
  type AspectRatio,
  assignLayerAsset,
  assignResolvedAsset,
  type Clip,
  clipAsset,
  DIMENSIONS,
  type ResolvedAsset,
  resolvedAssetSchema,
  type Scene,
  type ScenePlan,
  type VideoLayer,
} from "@dalang/core";
import type { PipelineDb } from "./db";
import { atomicWriteFile, round3 } from "./fs-utils";
import { contentHash } from "./hash";
import { imageDims } from "./image-dims";
import type { StockCandidate, StockKind, StockOrientation, StockProvider } from "./ports";
import type { ProjectPaths } from "./project-paths";
import { consoleLogger, type SceneStageResult, type StageLogger } from "./stage-types";

/**
 * Asset-resolve stage — per-KLIP, cached, resumable (PRD §7.1 [3], §7.2).
 *
 * Selection is deterministic (first candidate, video before image); reranking
 * by a cheap vision model is R-4 / Fase 2. Pinned clips are never touched
 * (hard invariant, enforced by core.assignResolvedAsset as well); locked
 * scenes are also skipped — a lock means "leave this scene alone", including
 * every clip in it.
 *
 * Satuannya KLIP, bukan scene (ADR-0033). Sebelumnya tahap ini membaca
 * `primaryClip(scene)` saja, jadi scene berklip tiga dengan tiga kueri berbeda
 * hanya bisa mendapat berkas untuk potongan pertama — dua sisanya diam-diam
 * tidak pernah dicari, dan kegagalannya baru terlihat sebagai latar prosedural
 * di tengah video. Scene berklip satu jatuh ke jalur yang sama persis seperti
 * sebelumnya, termasuk kunci cache-nya.
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
  /** Limit to these scene ids (partial runs). */
  sceneIds?: string[];
  force?: boolean;
  log?: StageLogger;
}

export interface AssetStageOutcome {
  plan: ScenePlan;
  results: SceneStageResult[];
}

/**
 * Cari + unduh SATU kandidat dari rantai provider.
 *
 * Diangkat jadi fungsi sendiri karena lapisan video (ADR-0025) mencari aset
 * dengan aturan yang PERSIS sama: video dulu baru gambar, provider pertama
 * dulu baru fallback, kandidat teratas. Menuliskannya dua kali berarti dua
 * kebijakan pemilihan aset yang akan menyimpang diam-diam — dan bedanya baru
 * ketahuan lewat video yang isinya tidak seperti yang diminta.
 */
const searchAndDownload = async ({
  providers,
  query,
  orientation,
  label,
  log,
}: {
  providers: StockProvider[];
  query: string;
  orientation: StockOrientation;
  label: string;
  log: StageLogger;
}): Promise<
  | { ok: true; candidate: StockCandidate; bytes: Uint8Array; usedFallback: boolean }
  | { ok: false; error: string }
> => {
  let lastError = "tidak ada kandidat ditemukan";
  for (const kind of KIND_PREFERENCE) {
    for (let index = 0; index < providers.length; index++) {
      const provider = providers[index] as StockProvider;
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
        return { ok: true, candidate, bytes, usedFallback: index > 0 };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        log.warn(
          `  provider ${provider.id} gagal (${kind}) untuk ${label}: ${lastError}`,
        );
      }
    }
  }
  return { ok: false, error: lastError };
};

/**
 * Orientasi pencarian untuk satu LAPISAN (ADR-0025) — diturunkan dari kotaknya
 * sendiri, bukan dari rasio video.
 *
 * Sisipan 0,34 x 0,34 di bingkai 16:9 adalah kotak 653x367 piksel: LANDSCAPE.
 * Sisipan 0,2 x 0,55 di bingkai yang sama adalah 384x594: PORTRAIT. Memakai
 * rasio videonya akan meminta stok landscape untuk kotak tegak, dan hasilnya
 * terpotong habis di setiap sisipan.
 */
export const layerOrientation = (
  layer: Pick<VideoLayer, "width" | "height">,
  aspect: AspectRatio,
): StockOrientation => {
  const frame = DIMENSIONS[aspect];
  const ratio = (layer.width * frame.width) / (layer.height * frame.height);
  if (ratio > 1.2) return "landscape";
  if (ratio < 0.83) return "portrait";
  return "square";
};

/**
 * Kunci run untuk satu klip.
 *
 * Klip PERTAMA memakai id scene apa adanya, bukan id klipnya: kunci itu sudah
 * dipakai setiap proyek yang ada, dan menggantinya berarti setiap plan lama
 * mengunduh ulang seluruh asetnya pada `dalang generate` berikutnya — biaya
 * nyata untuk perubahan yang seharusnya tak terlihat. Klip berikutnya memakai
 * `scene@klip`, pola yang sama dengan `scene#lapisan` milik ADR-0025.
 */
const clipRunKey = (sceneId: string, clip: Clip, index: number): string =>
  index === 0 ? sceneId : `${sceneId}@${clip.id}`;

/** Satu pekerjaan resolve: klip mana, di scene mana, urutan ke berapa. */
interface ClipJob {
  scene: Scene;
  clip: Clip;
  index: number;
  runKey: string;
  /** Baris hasil: `clipId` hanya diisi untuk klip kedua dan seterusnya. */
  row: { sceneId: string; clipId?: string };
}

const clipJobs = (plan: ScenePlan, targetIds: Set<string> | null): ClipJob[] =>
  plan.scenes
    .filter((scene) => !targetIds || targetIds.has(scene.id))
    .flatMap((scene) =>
      scene.clips.map((clip, index) => ({
        scene,
        clip,
        index,
        runKey: clipRunKey(scene.id, clip, index),
        // Scene berklip satu tidak menyebut klipnya sama sekali di laporan:
        // "sc-002" lebih terbaca daripada "sc-002 klip 1 dari 1", dan
        // permukaan lama tidak perlu tahu soal klip untuk tetap benar.
        row:
          scene.clips.length > 1
            ? { sceneId: scene.id, clipId: clip.id }
            : { sceneId: scene.id },
      })),
    );

export const runAssetStage = async ({
  paths,
  plan,
  providers,
  db,
  sceneIds,
  force = false,
  log = consoleLogger,
}: AssetStageOptions): Promise<AssetStageOutcome> => {
  const results: SceneStageResult[] = [];
  let current = plan;

  const targetIds = sceneIds ? new Set(sceneIds) : null;
  if (targetIds) {
    const known = new Set(plan.scenes.map((scene) => scene.id));
    for (const id of targetIds) {
      if (!known.has(id)) {
        results.push({
          sceneId: id,
          status: "error",
          detail: "scene tidak ditemukan di plan",
        });
      }
    }
  }
  // -- Ingest aset LOKAL (Fase 4 §9): screenshot/image dengan assetId berupa
  //    path relatif di folder proyek — dimaterialkan ke resolvedAssets tanpa
  //    provider. Sumber "local", lisensi milik user.
  const jobs = clipJobs(plan, targetIds);
  const localJobs = jobs.filter(
    ({ clip }) => clip.type === "screenshot" || clip.type === "image",
  );
  for (const { scene, clip, row } of localJobs) {
    const relPath = clip.assetId;
    if (!relPath) {
      results.push({
        ...row,
        status: "error",
        detail:
          "clip.assetId kosong — isi path file di folder proyek (mis. assets/step-1.png)",
      });
      continue;
    }
    if (clipAsset(current, clip.id)?.file === relPath) {
      results.push({ ...row, status: "cached", detail: "sudah ter-resolve" });
      continue;
    }
    if (scene.locked) {
      results.push({ ...row, status: "skipped", detail: "scene terkunci" });
      continue;
    }
    if (isAbsolute(relPath) || normalize(relPath).startsWith("..")) {
      results.push({
        ...row,
        status: "error",
        detail: "path aset lokal harus relatif di dalam folder proyek",
      });
      continue;
    }
    const absPath = join(paths.planDir, relPath);
    if (!existsSync(absPath)) {
      results.push({
        ...row,
        status: "error",
        detail: `file lokal tidak ditemukan: ${relPath}`,
      });
      continue;
    }
    const dims = imageDims(readFileSync(absPath));
    const localAsset: ResolvedAsset = {
      file: relPath,
      kind: "image",
      source: "local",
      license: "milik user (aset lokal proyek)",
      ...(dims ? { width: dims.width, height: dims.height } : {}),
    };
    try {
      current = assignResolvedAsset(current, scene.id, relPath, localAsset, clip.id);
      results.push({
        ...row,
        status: "done",
        detail: `aset lokal ${relPath}${dims ? ` · ${dims.width}×${dims.height}` : ""}`,
        costUsd: 0,
      });
    } catch (error) {
      results.push({
        ...row,
        status: "skipped",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const stockJobs = jobs.filter(({ clip }) => clip.type === "stock");
  const orientation = orientationForAspect(plan.meta.aspectRatio);

  for (const { scene, clip, index, runKey, row } of stockJobs) {
    if (clip.pinned) {
      results.push({
        ...row,
        status: "skipped",
        detail: "aset ter-pin (pilihan eksplisit dihormati)",
      });
      continue;
    }
    if (scene.locked) {
      results.push({
        ...row,
        status: "skipped",
        detail: "scene terkunci",
      });
      continue;
    }

    // Kueri turunan dari narasi hanya untuk klip PERTAMA. Menurunkannya untuk
    // potongan kedua memberi kueri yang sama persis dengan potongan pertama —
    // alasan yang sama dengan lapisan (ADR-0025): dua potongan berisi gambar
    // yang sama bukan penyuntingan, itu cuma satu gambar dua kali.
    const own = clip.query?.trim() ?? "";
    const query = own || (index === 0 ? deriveQuery(scene.narration) : "");
    if (query === "") {
      results.push({
        ...row,
        status: "error",
        detail:
          index === 0
            ? "tidak ada query maupun narasi untuk mencari aset"
            : "klip kedua dan seterusnya butuh clip.query sendiri — kueri klip tidak diturunkan dari narasi",
      });
      continue;
    }
    const derived = own === "";

    const inputHash = contentHash({
      kind: "stock-resolve",
      query,
      orientation,
      preference: KIND_PREFERENCE,
    });

    const existing = db.getRun(plan.projectId, runKey, "assets");
    if (
      !force &&
      existing?.status === "done" &&
      existing.inputHash === inputHash &&
      existing.outputJson
    ) {
      const stored = JSON.parse(existing.outputJson) as StoredAssetOutput;
      const asset = resolvedAssetSchema.parse(stored.asset);
      if (existsSync(join(paths.planDir, asset.file))) {
        current = assignResolvedAsset(current, scene.id, stored.assetId, asset, clip.id);
        results.push({
          ...row,
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
        ...row,
        status: "error",
        detail:
          "tidak ada provider stock yang terkonfigurasi — set PEXELS_API_KEY dan/atau PIXABAY_API_KEY",
      });
      continue;
    }

    db.startRun(plan.projectId, runKey, "assets", inputHash);
    const startedAt = Date.now();
    const found = await searchAndDownload({
      providers,
      query,
      orientation,
      label: runKey,
      log,
    });

    if (!found.ok) {
      const durationMs = Date.now() - startedAt;
      db.failRun(plan.projectId, runKey, "assets", found.error, durationMs);
      results.push({
        ...row,
        status: "error",
        detail: `${found.error} (query: "${query}")`,
        durationMs,
      });
      continue;
    }

    const { candidate, bytes, usedFallback } = found;
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
    current = assignResolvedAsset(current, scene.id, candidate.assetId, asset, clip.id);

    const durationMs = Date.now() - startedAt;
    const stored: StoredAssetOutput = { assetId: candidate.assetId, asset };
    db.finishRun(plan.projectId, runKey, "assets", {
      provider: candidate.providerId,
      fallback: usedFallback,
      outputJson: JSON.stringify(stored),
      costUsd: 0,
      durationMs,
    });
    if (usedFallback) {
      log.warn(`  ! ${runKey}: aset dari provider fallback (${candidate.providerId})`);
    }
    results.push({
      ...row,
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

  // -- Lapisan video (ADR-0025). Dijalankan SETELAH visual dasar supaya urutan
  //    log terbaca sebagai "scene ini, lalu sisipannya".
  const layerJobs: Array<{ scene: Scene; layer: VideoLayer }> = plan.scenes
    .filter((scene) => !targetIds || targetIds.has(scene.id))
    .flatMap((scene) => scene.layers.map((layer) => ({ scene, layer })));

  for (const { scene, layer } of layerJobs) {
    const row = { sceneId: scene.id, layerId: layer.id };
    if (scene.locked) {
      results.push({ ...row, status: "skipped", detail: "scene terkunci" });
      continue;
    }
    if (layer.visual.pinned) {
      results.push({
        ...row,
        status: "skipped",
        detail: "aset lapisan ter-pin (pilihan eksplisit dihormati)",
      });
      continue;
    }

    // Lapisan lokal: assetId adalah path relatif di folder proyek.
    if (layer.visual.type === "image" || layer.visual.type === "screenshot") {
      const relPath = layer.visual.assetId;
      if (!relPath) {
        results.push({
          ...row,
          status: "error",
          detail: "assetId lapisan kosong — isi path file di folder proyek",
        });
        continue;
      }
      if (current.renderState.layerAssets[layer.id]?.file === relPath) {
        results.push({ ...row, status: "cached", detail: "sudah ter-resolve" });
        continue;
      }
      if (isAbsolute(relPath) || normalize(relPath).startsWith("..")) {
        results.push({
          ...row,
          status: "error",
          detail: "path aset lapisan harus relatif di dalam folder proyek",
        });
        continue;
      }
      const absPath = join(paths.planDir, relPath);
      if (!existsSync(absPath)) {
        results.push({
          ...row,
          status: "error",
          detail: `file lokal tidak ditemukan: ${relPath}`,
        });
        continue;
      }
      const dims = imageDims(readFileSync(absPath));
      current = assignLayerAsset(current, scene.id, layer.id, relPath, {
        file: relPath,
        kind: "image",
        source: "local",
        license: "milik user (aset lokal proyek)",
        ...(dims ? { width: dims.width, height: dims.height } : {}),
      });
      results.push({
        ...row,
        status: "done",
        detail: `aset lokal ${relPath}`,
        costUsd: 0,
      });
      continue;
    }

    if (layer.visual.type !== "stock") {
      results.push({
        ...row,
        status: "skipped",
        detail: `tipe "${layer.visual.type}" belum di-resolve otomatis`,
      });
      continue;
    }

    // Query WAJIB untuk lapisan, tidak diturunkan dari narasi seperti visual
    // dasar. Menurunkannya akan memberi kueri yang SAMA dengan visual dasar —
    // dan sisipan yang isinya sama persis dengan latarnya bukan B-roll, itu
    // cuma gambar yang sama dua kali.
    const query = layer.visual.query?.trim() ?? "";
    if (query === "") {
      results.push({
        ...row,
        status: "error",
        detail:
          "lapisan stock butuh visual.query sendiri — kueri lapisan tidak diturunkan dari narasi",
      });
      continue;
    }

    const layerOrient = layerOrientation(layer, plan.meta.aspectRatio);
    const inputHash = contentHash({
      kind: "stock-resolve-layer",
      query,
      orientation: layerOrient,
      preference: KIND_PREFERENCE,
    });
    // Kunci run memakai scene DAN lapisan: dua lapisan di satu scene punya
    // riwayat sendiri-sendiri, dan tanpa itu cache lapisan kedua akan menjawab
    // pertanyaan lapisan pertama.
    const runKey = `${scene.id}#${layer.id}`;

    const existing = db.getRun(plan.projectId, runKey, "assets");
    if (
      !force &&
      existing?.status === "done" &&
      existing.inputHash === inputHash &&
      existing.outputJson
    ) {
      const stored = JSON.parse(existing.outputJson) as StoredAssetOutput;
      const asset = resolvedAssetSchema.parse(stored.asset);
      if (existsSync(join(paths.planDir, asset.file))) {
        current = assignLayerAsset(current, scene.id, layer.id, stored.assetId, asset);
        results.push({
          ...row,
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
        ...row,
        status: "error",
        detail:
          "tidak ada provider stock yang terkonfigurasi — set PEXELS_API_KEY dan/atau PIXABAY_API_KEY",
      });
      continue;
    }

    db.startRun(plan.projectId, runKey, "assets", inputHash);
    const startedAt = Date.now();
    const found = await searchAndDownload({
      providers,
      query,
      orientation: layerOrient,
      label: runKey,
      log,
    });
    if (!found.ok) {
      const durationMs = Date.now() - startedAt;
      db.failRun(plan.projectId, runKey, "assets", found.error, durationMs);
      results.push({
        ...row,
        status: "error",
        detail: `${found.error} (query: "${query}")`,
        durationMs,
      });
      continue;
    }

    const file = join(paths.assetsDir, `${inputHash}.${found.candidate.fileExt}`);
    atomicWriteFile(file, found.bytes);
    const asset: ResolvedAsset = {
      file: paths.relFromPlan(file),
      kind: found.candidate.kind,
      source: found.candidate.providerId,
      ...(found.candidate.sourceUrl ? { sourceUrl: found.candidate.sourceUrl } : {}),
      ...(found.candidate.author ? { author: found.candidate.author } : {}),
      license: found.candidate.license,
      width: found.candidate.width,
      height: found.candidate.height,
    };
    current = assignLayerAsset(
      current,
      scene.id,
      layer.id,
      found.candidate.assetId,
      asset,
    );
    const durationMs = Date.now() - startedAt;
    db.finishRun(plan.projectId, runKey, "assets", {
      provider: found.candidate.providerId,
      fallback: found.usedFallback,
      outputJson: JSON.stringify({ assetId: found.candidate.assetId, asset }),
      costUsd: 0,
      durationMs,
    });
    results.push({
      ...row,
      status: "done",
      detail: `${found.candidate.providerId} · ${found.candidate.kind} ${found.candidate.width}x${found.candidate.height} · ${round3(found.bytes.byteLength / 1024 / 1024)} MB`,
      provider: found.candidate.providerId,
      fallback: found.usedFallback,
      costUsd: 0,
      durationMs,
    });
  }

  return { plan: current, results };
};
