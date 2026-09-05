import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { extname, join, normalize, relative, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  clockLabel,
  type ProxyMedia,
  primaryClip,
  proxyDecision,
  type ResolvedAsset,
  type ScenePlan,
  setClipAsset,
  setLayerAsset,
} from "@dalang/core";
import {
  contentHash,
  type MediaProbeInfo,
  PEAKS_SAMPLE_RATE,
  peaksFromPcm,
} from "@dalang/pipeline";
import type { Hono } from "hono";
import { z } from "zod";
import type { SourceLite, SourcesResponse } from "../shared/api-types";
import type { StudioContext } from "./context";
import { ProxyJobRunner } from "./proxy-jobs";
import { StudioBusyError } from "./store";

/**
 * Rute sumber rekaman & proxy (ADR-0028, roadmap §9.5).
 *
 * Sampai fase ini satu-satunya jalan membawa REKAMAN (bukan gambar) ke dalam
 * proyek dari Studio adalah menaruh berkasnya di folder proyek dengan tangan
 * lalu meminta agent memanggil ingestVideo — dan agent butuh API key. Rute
 * ini memberi jalannya tanpa kunci apa pun:
 *
 *   - GET  /api/sources          daftar rekaman di folder proyek + faktanya
 *   - POST /api/sources/upload   unggah STREAMING ke disk (rekaman satu jam
 *                                tidak muat dalam data URL base64 — dan tidak
 *                                boleh dimuat ke memori dulu); dengan
 *                                ?id=&offset=&total= per potongan, BISA
 *                                DILANJUTKAN setelah putus (§11)
 *   - GET  /api/sources/upload/status  sampai byte ke berapa potongan id itu
 *                                sudah sampai
 *   - POST /api/sources/register pasang rekaman ke scene/lapisan + proxy-nya
 *   - GET  /api/sources/thumb    satu bingkai pada detik tertentu (cache disk)
 *   - GET  /api/sources/peaks    bentuk gelombang (cache disk)
 *   - POST /api/pipeline/proxies tahap proxy untuk semua/sebagian berkas
 *
 * Semuanya lewat jalur yang sama dengan panel manual lain: berkas di folder
 * proyek, renderState lewat helper core, lalu SATU patch user — bisa di-undo
 * dan terlihat agent di giliran berikutnya.
 */

const VIDEO_EXT = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi", ".mts"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus"]);
const SOURCE_DIRS = ["assets", "rekaman", "media"];
const MAX_SCAN_DEPTH = 3;
const DEFAULT_MAX_UPLOAD_MB = 4096;
/** Bagian unggahan yang tak pernah dilanjutkan dibuang setelah seminggu. */
const UPLOAD_PART_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const UPLOAD_ID = /^[0-9a-f]{8,64}$/;
/** Tinggi thumbnail yang dilayani; di luar rentang ini dipangkas, bukan ditolak. */
const THUMB_MIN_H = 40;
const THUMB_MAX_H = 360;
const PEAKS_MAX_BUCKETS = 4000;

const registerBody = z.object({
  file: z.string().min(1),
  sceneId: z.string().min(1),
  layerId: z.string().min(1).nullish(),
  trimStartSec: z.number().min(0).finite().optional(),
});

const proxiesBody = z.object({
  files: z.array(z.string().min(1)).optional(),
  force: z.boolean().optional(),
});

const errorPayload = (error: unknown) => ({
  error: error instanceof Error ? error.message : String(error),
});

/** Path relatif-plan yang aman: tanpa `..`, tanpa absolut, pemisah POSIX. */
export const safeRelativeSource = (file: string): string | null => {
  if (!file || file.includes("\0")) return null;
  const posix = file.split("\\").join("/");
  const normalized = normalize(posix);
  if (
    posix.startsWith("/") ||
    /^[a-zA-Z]:/.test(posix) ||
    normalized.startsWith("..") ||
    normalized.split(sep).includes("..")
  ) {
    return null;
  }
  return posix.replace(/^\.\//, "");
};

const kindOf = (file: string): "video" | "audio" | null => {
  const ext = extname(file).toLowerCase();
  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  return null;
};

/** Nama berkas aman dari nama unggahan: huruf kecil, angka, tanda hubung. */
export const safeBaseName = (filename: string): string =>
  filename
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "rekaman";

const maxUploadBytes = (): number => {
  const mb = Number(process.env.DALANG_MAX_UPLOAD_MB ?? DEFAULT_MAX_UPLOAD_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_MAX_UPLOAD_MB) * 1024 * 1024;
};

export const registerSourceRoutes = (app: Hono, ctx: StudioContext): void => {
  const { store, deps } = ctx;
  const { session } = store;
  // Proxy dibuat DI LATAR (ADR-0028 §10): satu pelari per proyek, mengantre.
  const runner = new ProxyJobRunner(ctx);
  const { planDir } = session.paths;

  const logUiEvent = (
    name: string,
    input: unknown,
    output: unknown,
    durationMs: number,
  ) => {
    session.events.record({
      turn: session.turn,
      kind: "tool",
      name: `ui:${name}`,
      input,
      output,
      costUsd: 0,
      durationMs,
    });
  };

  // Cache pemeriksaan per (path, ukuran, mtime): ffprobe murah, tapi daftar
  // sumber dibuka berulang kali dan rekaman jarang berubah.
  const probeCache = new Map<string, MediaProbeInfo | null>();
  const probeOf = async (rel: string): Promise<MediaProbeInfo | null> => {
    const absolute = join(planDir, rel);
    if (!existsSync(absolute)) return null;
    const stat = statSync(absolute);
    const key = `${rel}:${stat.size}:${Math.round(stat.mtimeMs)}`;
    if (probeCache.has(key)) return probeCache.get(key) ?? null;
    const transcoder = deps.transcoder?.();
    let info: MediaProbeInfo | null = null;
    if (transcoder) {
      info = await transcoder.probe(absolute);
    } else {
      // Tanpa transkoder: probe lama (durasi + dimensi) masih ada untuk video.
      const basic = await deps.probeVideo(session.paths.planPath, rel);
      info = basic
        ? {
            durationSec: basic.durationSec,
            width: basic.width,
            height: basic.height,
            fps: null,
            codec: null,
            hasAudio: false,
            audioCodec: null,
            channels: null,
            sampleRate: null,
            bitrate: null,
            sizeBytes: stat.size,
          }
        : null;
    }
    probeCache.set(key, info);
    return info;
  };

  /** Semua berkas video/audio di folder sumber proyek, relatif-plan. */
  const scanSources = (): string[] => {
    const found: string[] = [];
    const walk = (dir: string, depth: number) => {
      if (!existsSync(dir) || depth > MAX_SCAN_DEPTH) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const absolute = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(absolute, depth + 1);
        } else if (entry.isFile() && kindOf(entry.name)) {
          found.push(relative(planDir, absolute).split(sep).join("/"));
        }
      }
    };
    for (const name of SOURCE_DIRS) walk(join(planDir, name), 0);
    return found.sort();
  };

  const usersOf = (plan: ScenePlan, file: string) => {
    // `clipAssets` dikunci id KLIP (ADR-0033), tapi field ini menjanjikan id
    // SCENE dan itulah yang muncul di panel Sumber. Memakai kunci lumbung apa
    // adanya akan menampilkan "sc-batu-k1" pada orang yang mencari "sc-batu".
    const owners = new Map<string, string>();
    for (const scene of plan.scenes) {
      for (const clip of scene.clips) owners.set(clip.id, scene.id);
    }
    const sceneIds = [
      ...new Set(
        Object.entries(plan.renderState.clipAssets)
          .filter(([, asset]) => asset.file === file)
          .map(([clipId]) => owners.get(clipId))
          .filter((id): id is string => id !== undefined),
      ),
    ];
    const layerIds = Object.entries(plan.renderState.layerAssets)
      .filter(([, asset]) => asset.file === file)
      .map(([layerId]) => layerId);
    return { sceneIds, layerIds };
  };

  const proxyOf = (plan: ScenePlan, file: string): ProxyMedia | null => {
    for (const store of [plan.renderState.clipAssets, plan.renderState.layerAssets]) {
      for (const asset of Object.values(store)) {
        if (asset.file === file && asset.proxy) return asset.proxy;
      }
    }
    return null;
  };

  const describe = async (plan: ScenePlan | null, file: string): Promise<SourceLite> => {
    const absolute = join(planDir, file);
    const stat = statSync(absolute);
    const info = await probeOf(file);
    const kind = kindOf(file) ?? "video";
    return {
      file,
      kind,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      probe: info
        ? {
            durationSec: Number(info.durationSec.toFixed(2)),
            width: info.width,
            height: info.height,
            fps: info.fps,
            codec: info.codec,
            hasAudio: info.hasAudio,
          }
        : null,
      usedBy: plan ? usersOf(plan, file) : { sceneIds: [], layerIds: [] },
      proxy: plan ? proxyOf(plan, file) : null,
      proxyDecision:
        info && kind === "video"
          ? proxyDecision({
              width: info.width,
              height: info.height,
              durationSec: info.durationSec,
              fps: info.fps,
              codec: info.codec,
              bitrate: info.bitrate,
            })
          : null,
      transcript: plan ? file in plan.renderState.transcripts : false,
    };
  };

  // -------------------------------------------------------------------------
  // Daftar
  // -------------------------------------------------------------------------
  app.get("/api/sources", async (c) => {
    const files = scanSources();
    const sources: SourceLite[] = [];
    for (const file of files) sources.push(await describe(session.plan, file));
    const payload: SourcesResponse = {
      ok: true,
      transcoder: deps.transcoder !== undefined,
      maxUploadBytes: maxUploadBytes(),
      sources,
    };
    return c.json(payload);
  });

  // -------------------------------------------------------------------------
  // Unggah streaming: body mentah -> disk, hash dihitung sambil lewat
  // -------------------------------------------------------------------------
  const uploadDir = join(planDir, "assets", "rekaman");
  const partPath = (id: string) => join(uploadDir, `.unggah-${id}.part`);
  const partSize = (id: string): number =>
    existsSync(partPath(id)) ? statSync(partPath(id)).size : 0;
  const sweepStaleParts = () => {
    if (!existsSync(uploadDir)) return;
    for (const entry of readdirSync(uploadDir)) {
      if (!entry.startsWith(".unggah-") || !entry.endsWith(".part")) continue;
      const full = join(uploadDir, entry);
      if (Date.now() - statSync(full).mtimeMs > UPLOAD_PART_MAX_AGE_MS) {
        rmSync(full, { force: true });
      }
    }
  };
  /** SHA-256 (10 heksa pertama) satu lintasan baca — untuk bagian yang dirakit per potongan. */
  const digestOfFile = async (path: string): Promise<string> => {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
    return hash.digest("hex").slice(0, 10);
  };
  /**
   * Jalur akhir yang SAMA untuk unggahan sekali jalan maupun per potongan:
   * nama ber-hash, dedup isi, rename atomik, lalu deskripsi.
   */
  const finalizeUpload = async (temp: string, name: string, digest: string) => {
    const ext = extname(name).toLowerCase();
    // Unggahan yang ISINYA sama tidak disalin dua kali, apa pun namanya:
    // rekaman empat gigabyte yang diunggah ulang dari folder lain bukan
    // rekaman baru, dan disk proyek bukan tempat menyimpan dua salinannya.
    const twin = readdirSync(uploadDir).find((entry) =>
      entry.endsWith(`-${digest}${ext}`),
    );
    const finalAbs = join(uploadDir, twin ?? `${safeBaseName(name)}-${digest}${ext}`);
    const file = relative(planDir, finalAbs).split(sep).join("/");
    const existed = twin !== undefined;
    if (existed) rmSync(temp, { force: true });
    else renameSync(temp, finalAbs);
    probeCache.clear();
    const source = await describe(session.plan, file);
    return { file, existed, source };
  };

  // ADR-0028 §11: sampai byte ke berapa potongan `id` sudah sampai. `size`
  // (ukuran berkas yang kini hendak diunggah) membuang bagian yang lebih
  // besar dari itu — identitas yang sama untuk berkas yang berbeda.
  app.get("/api/sources/upload/status", (c) => {
    const id = c.req.query("id") ?? "";
    if (!UPLOAD_ID.test(id)) return c.json({ error: "id unggahan tidak valid" }, 400);
    sweepStaleParts();
    const size = Number(c.req.query("size") ?? Number.NaN);
    let offset = partSize(id);
    if (Number.isFinite(size) && offset > size) {
      rmSync(partPath(id), { force: true });
      offset = 0;
    }
    return c.json({ ok: true, id, offset });
  });

  app.post("/api/sources/upload", async (c) => {
    const name = c.req.query("name") ?? "";
    const kind = kindOf(name);
    if (!kind) {
      return c.json(
        {
          error: `Ekstensi "${extname(name) || "(kosong)"}" tidak dikenal sebagai video/audio — kirim ?name=rekaman.mp4`,
        },
        400,
      );
    }
    const limit = maxUploadBytes();
    const declared = Number(c.req.header("content-length") ?? Number.NaN);
    if (Number.isFinite(declared) && declared > limit) {
      return c.json(
        {
          error: `Berkas ${Math.round(declared / 1024 / 1024)} MB melampaui batas ${Math.round(limit / 1024 / 1024)} MB (DALANG_MAX_UPLOAD_MB)`,
        },
        413,
      );
    }
    const body = c.req.raw.body;
    if (!body) return c.json({ error: "Body kosong" }, 400);
    mkdirSync(uploadDir, { recursive: true });
    const startedAt = Date.now();

    // --- ADR-0028 §11: per potongan, bisa dilanjutkan --------------------
    const id = c.req.query("id");
    if (id !== undefined) {
      if (!UPLOAD_ID.test(id)) return c.json({ error: "id unggahan tidak valid" }, 400);
      const total = Number(c.req.query("total"));
      const offset = Number(c.req.query("offset"));
      if (
        !Number.isInteger(total) ||
        total <= 0 ||
        !Number.isInteger(offset) ||
        offset < 0 ||
        offset > total
      ) {
        return c.json({ error: "offset/total tidak valid" }, 400);
      }
      if (total > limit) {
        return c.json(
          {
            error: `Berkas ${Math.round(total / 1024 / 1024)} MB melampaui batas ${Math.round(limit / 1024 / 1024)} MB (DALANG_MAX_UPLOAD_MB)`,
          },
          413,
        );
      }
      const temp = partPath(id);
      const current = partSize(id);
      // Offset yang tidak cocok bukan galat fatal: jawabannya memberi tahu
      // klien sampai mana byte-nya sudah sampai, dan klien lanjut dari sana.
      if (current !== offset) {
        return c.json(
          {
            error: `Offset tidak cocok: server sudah punya ${current} byte`,
            offset: current,
          },
          409,
        );
      }
      let bytes = 0;
      let overflow = false;
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          if (offset + bytes > total) {
            overflow = true;
            callback(new Error("melampaui total"));
            return;
          }
          callback(null, chunk);
        },
      });
      try {
        await pipeline(
          Readable.fromWeb(body as import("node:stream/web").ReadableStream),
          counter,
          createWriteStream(temp, { flags: "a" }),
        );
      } catch (error) {
        if (overflow) {
          rmSync(temp, { force: true });
          return c.json({ error: "Potongan melampaui total yang diumumkan" }, 400);
        }
        // Putus di tengah potongan: byte yang sudah ditulis TETAP di bagian;
        // itulah titik lanjutnya. Klien yang masih hidup bertanya ke /status.
        return c.json(errorPayload(error), 500);
      }
      if (bytes === 0) return c.json({ error: "Potongan kosong" }, 400);
      const reached = offset + bytes;
      if (reached < total) return c.json({ ok: true, done: false, id, offset: reached });
      // Selesai: hash seluruh berkas sekali (satu lintasan baca), lalu jalur
      // akhir yang sama dengan unggahan sekali jalan.
      const result = await finalizeUpload(temp, name, await digestOfFile(temp));
      logUiEvent(
        "uploadSource",
        { name, bytes: total, resumable: true },
        { file: result.file, existed: result.existed },
        Date.now() - startedAt,
      );
      return c.json({ ok: true, done: true, id, offset: total, ...result });
    }

    // --- sekali jalan: hash dihitung sambil lewat ------------------------
    const temp = join(uploadDir, `.unggah-${process.pid}-${Date.now()}.part`);
    const hash = createHash("sha256");
    let bytes = 0;
    let overflow = false;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > limit) {
          overflow = true;
          callback(new Error("melampaui batas"));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(body as import("node:stream/web").ReadableStream),
        counter,
        createWriteStream(temp),
      );
    } catch (error) {
      rmSync(temp, { force: true });
      if (overflow) {
        return c.json(
          {
            error: `Unggahan melampaui batas ${Math.round(limit / 1024 / 1024)} MB (DALANG_MAX_UPLOAD_MB)`,
          },
          413,
        );
      }
      return c.json(errorPayload(error), 500);
    }
    if (bytes === 0) {
      rmSync(temp, { force: true });
      return c.json({ error: "Berkas kosong" }, 400);
    }
    const result = await finalizeUpload(temp, name, hash.digest("hex").slice(0, 10));
    logUiEvent(
      "uploadSource",
      { name, bytes },
      { file: result.file, existed: result.existed },
      Date.now() - startedAt,
    );
    return c.json({ ok: true, ...result });
  });

  // -------------------------------------------------------------------------
  // Daftarkan ke scene / lapisan + proxy
  // -------------------------------------------------------------------------
  app.post("/api/sources/register", async (c) => {
    const body = registerBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Body tidak valid" }, 400);
    const plan = session.plan;
    if (!plan) return c.json({ error: "Proyek belum punya scene-plan" }, 400);
    const file = safeRelativeSource(body.data.file);
    if (!file)
      return c.json({ error: "Path rekaman harus relatif di dalam folder proyek" }, 400);
    if (!existsSync(join(planDir, file))) {
      return c.json({ error: `Rekaman tidak ditemukan: ${file}` }, 404);
    }
    if (kindOf(file) !== "video") {
      return c.json(
        {
          error:
            "Hanya berkas VIDEO yang bisa jadi visual scene/lapisan — untuk audio, pakai trek audio di tab Audio",
        },
        400,
      );
    }
    const scene = plan.scenes.find((candidate) => candidate.id === body.data.sceneId);
    if (!scene) return c.json({ error: `Scene ${body.data.sceneId} tidak ada` }, 400);
    if (scene.locked) return c.json({ error: "Scene terkunci" }, 400);
    const layerId = body.data.layerId ?? null;
    if (layerId && !scene.layers.some((layer) => layer.id === layerId)) {
      return c.json({ error: `Lapisan ${layerId} tidak ada di scene ${scene.id}` }, 400);
    }
    const info = await probeOf(file);
    if (!info || (!info.codec && !info.width)) {
      return c.json({ error: `Rekaman "${file}" tidak terbaca sebagai video` }, 400);
    }

    try {
      const startedAt = Date.now();
      const result = await store.runExclusive("sources", async () => {
        const current = store.freshPlan();
        if (!current) throw new Error("Plan hilang di tengah pendaftaran");
        const asset: ResolvedAsset = {
          file,
          kind: "video",
          source: "local",
          license: "milik user (rekaman sumber)",
          width: info.width,
          height: info.height,
          durationSec: info.durationSec,
          ...(info.codec ? { codec: info.codec } : {}),
          ...(info.fps ? { fps: info.fps } : {}),
        };
        session.plan = layerId
          ? setLayerAsset(current, layerId, asset)
          : setClipAsset(current, primaryClip(scene).id, asset);
        // Urutan op PENTING: patch `layers` menulis seluruh larik lapisan dari
        // snapshot scene SEBELUM pendaftaran, jadi ia harus lebih dulu — kalau
        // di belakang, ia menimpa assetId/pin yang baru saja dipasang.
        const ops: Parameters<typeof session.applyUserPatch>[0] = [];
        if (layerId && body.data.trimStartSec !== undefined) {
          ops.push({
            op: "updateScene",
            id: scene.id,
            patch: {
              layers: scene.layers.map((layer) =>
                layer.id === layerId
                  ? {
                      ...layer,
                      visual: { ...layer.visual, trimStartSec: body.data.trimStartSec },
                    }
                  : layer,
              ),
            },
          });
        }
        ops.push({
          op: "replaceAsset",
          sceneId: scene.id,
          ...(layerId ? { layerId } : {}),
          assetId: file,
          pinned: true,
        });
        if (
          !layerId &&
          primaryClip(scene).type !== "image" &&
          primaryClip(scene).type !== "screenshot"
        ) {
          ops.push({
            op: "updateScene",
            id: scene.id,
            patch: { clip: { type: "image" } },
          });
        }
        if (!layerId && body.data.trimStartSec !== undefined) {
          ops.push({
            op: "updateScene",
            id: scene.id,
            patch: { clip: { trimStartSec: body.data.trimStartSec } },
          });
        }
        const { summary } = session.applyUserPatch(ops);

        // Proxy DI LATAR (ADR-0028 §10): rekaman yang baru dipasang adalah
        // persis yang akan diseret-seret di preview, tapi satu jam rekaman
        // tidak boleh membekukan editor selama proxy-nya dibuat. Jawaban ini
        // kembali sekarang; proxy-nya menyusul lewat event `proxy-progress`
        // dan `plan-updated`.
        let proxy: ProxyMedia | null = proxyOf(session.plan as ScenePlan, file);
        let proxyNote = "tidak ada transkoder — preview memakai berkas aslinya";
        if (deps.transcoder) {
          const started = runner.start([file], false);
          proxyNote = started.started
            ? started.queued
              ? "proxy antre di latar, di belakang yang sedang dibuat"
              : "proxy dibuat di latar — preview beralih ke proxy begitu selesai"
            : `proxy: ${started.reason ?? "tidak diproses"}`;
          proxy = proxyOf(session.plan as ScenePlan, file);
        }
        return { summary, proxy, proxyNote };
      });
      logUiEvent(
        "registerSource",
        { file, sceneId: scene.id, layerId },
        { proxy: result.proxy?.file ?? null },
        Date.now() - startedAt,
      );
      store.notifyPlan("pick");
      return c.json({
        ok: true,
        file,
        summary: result.summary,
        proxy: result.proxy,
        proxyNote: result.proxyNote,
        durationSec: info.durationSec,
        codec: info.codec,
      });
    } catch (error) {
      if (error instanceof StudioBusyError) return c.json(errorPayload(error), 409);
      return c.json(errorPayload(error), 400);
    }
  });

  // -------------------------------------------------------------------------
  // Bingkai pada detik tertentu (cache disk di .dalang/thumbs)
  // -------------------------------------------------------------------------
  app.get("/api/sources/thumb", async (c) => {
    const file = safeRelativeSource(c.req.query("file") ?? "");
    if (!file) return c.json({ error: "Parameter ?file= wajib dan harus relatif" }, 400);
    const absolute = join(planDir, file);
    if (!existsSync(absolute)) return c.json({ error: `Tidak ditemukan: ${file}` }, 404);
    const transcoder = deps.transcoder?.();
    if (!transcoder) {
      return c.json(
        { error: "Thumbnail rekaman butuh transkoder ffmpeg (tidak tersedia)" },
        501,
      );
    }
    const info = await probeOf(file);
    const requestedT = Number(c.req.query("t") ?? 0);
    const t = Math.max(
      0,
      Math.min(
        Number.isFinite(requestedT) ? requestedT : 0,
        Math.max(0, (info?.durationSec ?? 0) - 0.05),
      ),
    );
    const requestedH = Number(c.req.query("h") ?? 90);
    const h = Math.round(
      Math.max(
        THUMB_MIN_H,
        Math.min(THUMB_MAX_H, Number.isFinite(requestedH) ? requestedH : 90),
      ),
    );
    const stat = statSync(absolute);
    const key = contentHash({
      kind: "thumb-v1",
      file,
      size: stat.size,
      mtimeMs: Math.round(stat.mtimeMs),
      t: Math.round(t * 10) / 10,
      h,
    });
    const cached = join(session.paths.thumbsDir, `${key}.jpg`);
    if (!existsSync(cached)) {
      const frame = await transcoder.extractFrame(absolute, t, cached, { height: h });
      if (!frame.ok) return c.json({ error: frame.reason }, 422);
    }
    return c.body(readFileSync(cached), 200, {
      "content-type": "image/jpeg",
      "cache-control": "private, max-age=31536000, immutable",
    });
  });

  // -------------------------------------------------------------------------
  // Bentuk gelombang (cache disk di .dalang/peaks)
  // -------------------------------------------------------------------------
  app.get("/api/sources/peaks", async (c) => {
    const file = safeRelativeSource(c.req.query("file") ?? "");
    if (!file) return c.json({ error: "Parameter ?file= wajib dan harus relatif" }, 400);
    const absolute = join(planDir, file);
    if (!existsSync(absolute)) return c.json({ error: `Tidak ditemukan: ${file}` }, 404);
    const transcoder = deps.transcoder?.();
    if (!transcoder) {
      return c.json(
        { error: "Bentuk gelombang butuh transkoder ffmpeg (tidak tersedia)" },
        501,
      );
    }
    const requested = Number(c.req.query("buckets") ?? 600);
    const buckets = Math.round(
      Math.max(
        16,
        Math.min(PEAKS_MAX_BUCKETS, Number.isFinite(requested) ? requested : 600),
      ),
    );
    const stat = statSync(absolute);
    const key = contentHash({
      kind: "peaks-v1",
      file,
      size: stat.size,
      mtimeMs: Math.round(stat.mtimeMs),
      buckets,
      rate: PEAKS_SAMPLE_RATE,
    });
    const cached = join(session.paths.peaksDir, `${key}.json`);
    if (existsSync(cached)) {
      return c.body(readFileSync(cached, "utf8"), 200, {
        "content-type": "application/json",
      });
    }
    const pcm = await transcoder.decodeMonoPcm(absolute, PEAKS_SAMPLE_RATE);
    const info = await probeOf(file);
    const payload = {
      ok: true,
      file,
      durationSec: info?.durationSec ?? (pcm ? pcm.length / PEAKS_SAMPLE_RATE : 0),
      hasAudio: pcm !== null,
      peaks: pcm ? peaksFromPcm(pcm, buckets) : new Array(buckets).fill(0),
    };
    mkdirSync(session.paths.peaksDir, { recursive: true });
    writeFileSync(cached, JSON.stringify(payload));
    return c.json(payload);
  });

  // -------------------------------------------------------------------------
  // Tahap proxy untuk semua/sebagian berkas
  // -------------------------------------------------------------------------
  app.post("/api/pipeline/proxies", async (c) => {
    const body = proxiesBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "Body tidak valid" }, 400);
    if (!session.plan) return c.json({ error: "Proyek belum punya scene-plan" }, 400);
    const started = runner.start(body.data.files ?? null, body.data.force ?? false);
    logUiEvent(
      "buildProxies",
      { files: body.data.files ?? null, force: body.data.force ?? false },
      {
        started: started.started,
        queued: started.queued,
        reason: started.reason ?? null,
      },
      0,
    );
    if (!started.started) {
      return c.json({
        ok: true,
        started: false,
        queued: false,
        reason: started.reason,
        job: started.job,
      });
    }
    // 202: pekerjaannya berjalan di latar; kemajuan lewat SSE `proxy-progress`.
    return c.json(
      { ok: true, started: true, queued: started.queued, job: started.job },
      202,
    );
  });

  app.post("/api/pipeline/proxies/cancel", (c) => {
    const cancelled = runner.cancel();
    logUiEvent("cancelProxies", {}, { cancelled }, 0);
    return c.json({ ok: true, cancelled });
  });

  app.get("/api/pipeline/proxies", (c) => c.json({ ok: true, job: runner.status }));
};

/** Untuk pesan UI: "1 j 2 mnt" dsb. — diekspor supaya server dan tes memakai kata yang sama. */
export const sourceClock = clockLabel;
