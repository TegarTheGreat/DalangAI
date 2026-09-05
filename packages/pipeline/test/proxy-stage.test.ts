import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseScenePlan,
  type ScenePlan,
  setClipAsset,
  setLayerAsset,
} from "@dalang/core";
import { afterEach, describe, expect, it } from "vitest";
import { PipelineDb } from "../src/db";
import type { MediaProbeInfo, MediaTranscoder } from "../src/ports";
import { projectPaths } from "../src/project-paths";
import { proxyCandidates, runProxyStage } from "../src/proxy-stage";
import { silentLog } from "./helpers";

/**
 * Tahap proxy (ADR-0028) dengan transkoder PALSU: yang diuji adalah
 * orkestrasinya — berkas mana, cache, pembersihan proxy basi, pelaporan —
 * bukan ffmpeg-nya (itu diuji nyata di paket renderer).
 */

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup) fn();
  cleanup = [];
});

const makeProject = () => {
  const dir = mkdtempSync(join(tmpdir(), "dalang-proxy-stage-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "assets/podcast.mp4"), "bukan mp4 sungguhan, cukup ada");
  writeFileSync(join(dir, "assets/broll.mp4"), "klip pendek");
  const paths = projectPaths(join(dir, "plan.json"));
  const db = new PipelineDb(":memory:");
  cleanup.push(() => db.close());
  return { dir, paths, db };
};

const LONG: MediaProbeInfo = {
  durationSec: 3600,
  width: 3840,
  height: 2160,
  fps: 59.94,
  codec: "hevc",
  hasAudio: true,
  audioCodec: "aac",
  channels: 2,
  sampleRate: 48000,
  bitrate: 20_000_000,
  sizeBytes: 1,
};
const LIGHT: MediaProbeInfo = {
  ...LONG,
  durationSec: 8,
  width: 1280,
  height: 720,
  fps: 30,
  codec: "h264",
};

interface FakeTranscoder extends MediaTranscoder {
  proxies: Array<{
    sourcePath: string;
    outputPath: string;
    width: number;
    height: number;
    fps?: number;
  }>;
}

const fakeTranscoder = (
  infoFor: (sourcePath: string) => MediaProbeInfo | null,
  options: { fail?: string } = {},
): FakeTranscoder => {
  const transcoder: FakeTranscoder = {
    id: "fake-ff",
    proxies: [],
    probe: async (sourcePath) => infoFor(sourcePath),
    makeProxy: async (request) => {
      transcoder.proxies.push(request);
      if (options.fail) return { ok: false, reason: options.fail };
      mkdirSync(join(request.outputPath, ".."), { recursive: true });
      writeFileSync(request.outputPath, `proxy ${request.width}x${request.height}`);
      return {
        ok: true,
        width: request.width,
        height: request.height,
        durationSec: infoFor(request.sourcePath)?.durationSec ?? 0,
        fps: request.fps ?? infoFor(request.sourcePath)?.fps ?? null,
      };
    },
    extractFrame: async () => ({ ok: true }),
    toWav: async () => ({ ok: true }),
    decodeMonoPcm: async () => null,
  };
  return transcoder;
};

const planWithVideos = (): ScenePlan => {
  let plan = parseScenePlan({
    version: 2,
    projectId: "uji-proxy",
    meta: { title: "Uji" },
    scenes: [
      {
        id: "a",
        narration: "Satu.",
        clips: [
          { id: "a-k1", type: "image", assetId: "assets/podcast.mp4", trimStartSec: 30 },
        ],
        layers: [
          {
            id: "lap",
            visual: { type: "image", assetId: "assets/podcast.mp4" },
            anchor: "kanan-bawah",
            width: 0.3,
            height: 0.3,
          },
        ],
      },
      {
        id: "b",
        narration: "Dua.",
        clips: [{ id: "b-k1", type: "image", assetId: "assets/broll.mp4" }],
      },
      {
        id: "c",
        narration: "Tiga.",
        clips: [{ id: "c-k1", type: "image", assetId: "assets/foto.png" }],
      },
    ],
  });
  const video = (file: string) => ({ file, kind: "video" as const, source: "local" });
  plan = setClipAsset(plan, "a-k1", video("assets/podcast.mp4"));
  plan = setLayerAsset(plan, "lap", video("assets/podcast.mp4"));
  plan = setClipAsset(plan, "b-k1", video("assets/broll.mp4"));
  plan = setClipAsset(plan, "c-k1", {
    file: "assets/foto.png",
    kind: "image",
    source: "local",
  });
  return plan;
};

describe("proxyCandidates", () => {
  it("satu entri per berkas VIDEO, gambar tidak ikut, lapisan yatim tidak ikut", () => {
    const plan = planWithVideos();
    expect(proxyCandidates(plan).map((job) => job.file)).toEqual([
      "assets/podcast.mp4",
      "assets/broll.mp4",
    ]);
    // Lapisan yang sudah dihapus dari scene meninggalkan entri renderState
    // (untuk undo) — berkasnya tidak boleh diproses lagi.
    const orphaned = structuredClone(plan);
    orphaned.scenes[0]!.layers = [];
    orphaned.renderState.layerAssets.lap!.file = "assets/yatim.mp4";
    expect(proxyCandidates(orphaned).map((job) => job.file)).not.toContain(
      "assets/yatim.mp4",
    );
  });
});

describe("runProxyStage", () => {
  it("membuat proxy untuk yang perlu, melewati yang ringan dengan alasannya, menulis ke semua pemakai", async () => {
    const { paths, db } = makeProject();
    const transcoder = fakeTranscoder((source) =>
      source.endsWith("podcast.mp4") ? LONG : LIGHT,
    );
    const { plan, results } = await runProxyStage({
      paths,
      plan: planWithVideos(),
      db,
      transcoder,
      log: silentLog,
    });

    expect(results.map((r) => [r.sceneId, r.status])).toEqual([
      ["assets/podcast.mp4", "done"],
      ["assets/broll.mp4", "skipped"],
    ]);
    expect(results[1]?.detail).toContain("tidak perlu");
    expect(results[1]?.detail).toContain("aslinya");

    // Permintaan ke transkoder: sisi pendek 540, laju dipangkas ke 30.
    expect(transcoder.proxies).toHaveLength(1);
    expect(transcoder.proxies[0]).toMatchObject({ width: 960, height: 540, fps: 30 });
    expect(transcoder.proxies[0]?.outputPath).toContain(paths.proxiesDir);

    const proxy = plan.renderState.clipAssets["a-k1"]?.proxy;
    expect(proxy?.file.startsWith(".dalang/proxies/")).toBe(true);
    expect(proxy?.file.endsWith("-540p.mp4")).toBe(true);
    expect(existsSync(join(paths.planDir, proxy?.file ?? ""))).toBe(true);
    // Lapisan yang memakai berkas yang sama ikut mendapat proxy-nya.
    expect(plan.renderState.layerAssets.lap?.proxy?.file).toBe(proxy?.file);
    // Fakta sumber tercatat untuk KEDUA berkas — juga yang tidak di-proxy.
    expect(plan.renderState.clipAssets["a-k1"]?.codec).toBe("hevc");
    expect(plan.renderState.clipAssets["b-k1"]?.codec).toBe("h264");
    expect(plan.renderState.clipAssets["b-k1"]?.proxy).toBeUndefined();
  });

  it("jalan kedua sepenuhnya dari cache; --force membuat ulang", async () => {
    const { paths, db } = makeProject();
    const transcoder = fakeTranscoder(() => LONG);
    const first = await runProxyStage({
      paths,
      plan: planWithVideos(),
      db,
      transcoder,
      log: silentLog,
    });
    const second = await runProxyStage({
      paths,
      plan: first.plan,
      db,
      transcoder,
      log: silentLog,
    });
    expect(second.results.every((r) => r.status === "cached")).toBe(true);
    expect(transcoder.proxies).toHaveLength(2); // dua berkas, sekali masing-masing
    expect(second.plan.renderState.clipAssets["a-k1"]?.proxy).toEqual(
      first.plan.renderState.clipAssets["a-k1"]?.proxy,
    );

    const forced = await runProxyStage({
      paths,
      plan: second.plan,
      db,
      transcoder,
      force: true,
      log: silentLog,
    });
    expect(forced.results.every((r) => r.status === "done")).toBe(true);
    expect(transcoder.proxies).toHaveLength(4);
  });

  it("cache yang berkas proxy-nya sudah dihapus dari disk dibuat ulang, bukan dipercaya", async () => {
    const { paths, db } = makeProject();
    const transcoder = fakeTranscoder(() => LONG);
    const first = await runProxyStage({
      paths,
      plan: planWithVideos(),
      db,
      transcoder,
      log: silentLog,
    });
    const proxyFile = first.plan.renderState.clipAssets["a-k1"]?.proxy?.file ?? "";
    rmSync(join(paths.planDir, proxyFile));

    const again = await runProxyStage({
      paths,
      plan: first.plan,
      db,
      transcoder,
      log: silentLog,
    });
    expect(again.results.find((r) => r.sceneId === "assets/podcast.mp4")?.status).toBe(
      "done",
    );
    expect(existsSync(join(paths.planDir, proxyFile))).toBe(true);
  });

  it("sumber yang berubah isi mendapat proxy baru dan proxy lamanya dibersihkan", async () => {
    const { paths, db } = makeProject();
    const transcoder = fakeTranscoder(() => LONG);
    const first = await runProxyStage({
      paths,
      plan: planWithVideos(),
      db,
      transcoder,
      log: silentLog,
    });
    const oldProxy = first.plan.renderState.clipAssets["a-k1"]?.proxy?.file ?? "";

    // Ganti isi (ukuran berubah) → hash berbeda → proxy baru.
    writeFileSync(
      join(paths.planDir, "assets/podcast.mp4"),
      "isi baru yang jauh lebih panjang dari sebelumnya",
    );
    const second = await runProxyStage({
      paths,
      plan: first.plan,
      db,
      transcoder,
      log: silentLog,
    });
    const newProxy = second.plan.renderState.clipAssets["a-k1"]?.proxy?.file ?? "";
    expect(newProxy).not.toBe(oldProxy);
    expect(existsSync(join(paths.planDir, newProxy))).toBe(true);
    expect(existsSync(join(paths.planDir, oldProxy))).toBe(false);
  });

  it("berkas yang berubah jadi ringan kehilangan proxy-nya (dan berkasnya)", async () => {
    const { paths, db } = makeProject();
    let info = LONG;
    const transcoder = fakeTranscoder(() => info);
    const first = await runProxyStage({
      paths,
      plan: planWithVideos(),
      db,
      transcoder,
      log: silentLog,
    });
    const oldProxy = first.plan.renderState.clipAssets["a-k1"]?.proxy?.file ?? "";
    expect(oldProxy).not.toBe("");

    info = LIGHT;
    writeFileSync(join(paths.planDir, "assets/podcast.mp4"), "versi ringan");
    const second = await runProxyStage({
      paths,
      plan: first.plan,
      db,
      transcoder,
      log: silentLog,
    });
    expect(second.plan.renderState.clipAssets["a-k1"]?.proxy).toBeUndefined();
    expect(second.plan.renderState.layerAssets.lap?.proxy).toBeUndefined();
    expect(existsSync(join(paths.planDir, oldProxy))).toBe(false);
  });

  it("kegagalan transkoder dilaporkan per berkas sebagai error, berkas lain tetap jalan", async () => {
    const { paths, db } = makeProject();
    const transcoder = fakeTranscoder(() => LONG, { fail: "libx264 menolak dimensi" });
    const { plan, results } = await runProxyStage({
      paths,
      plan: planWithVideos(),
      db,
      transcoder,
      log: silentLog,
    });
    expect(results.map((r) => r.status)).toEqual(["error", "error"]);
    expect(results[0]?.detail).toContain("libx264 menolak dimensi");
    expect(plan.renderState.clipAssets["a-k1"]?.proxy).toBeUndefined();
    expect(db.getRun("uji-proxy", "assets/podcast.mp4", "proxy")?.status).toBe("error");
  });

  it("tanpa transkoder: dilewati dan dikatakan, bukan diam", async () => {
    const { paths, db } = makeProject();
    const { plan, results } = await runProxyStage({
      paths,
      plan: planWithVideos(),
      db,
      log: silentLog,
    });
    expect(results.every((r) => r.status === "skipped")).toBe(true);
    expect(results[0]?.detail).toContain("tidak ada transkoder");
    expect(plan).toEqual(planWithVideos());
  });

  it("berkas hilang → error; berkas tanpa jalur video → error dengan alasannya", async () => {
    const { paths, db } = makeProject();
    rmSync(join(paths.planDir, "assets/broll.mp4"));
    const transcoder = fakeTranscoder((source) =>
      source.endsWith("podcast.mp4") ? { ...LONG, codec: null } : LONG,
    );
    const { results } = await runProxyStage({
      paths,
      plan: planWithVideos(),
      db,
      transcoder,
      log: silentLog,
    });
    expect(results).toEqual([
      expect.objectContaining({ sceneId: "assets/podcast.mp4", status: "error" }),
      expect.objectContaining({
        sceneId: "assets/broll.mp4",
        status: "error",
        detail: "berkas tidak ditemukan",
      }),
    ]);
    expect(results[0]?.detail).toContain("tidak punya jalur video");
  });

  it("`files` membatasi ke berkas yang diminta", async () => {
    const { paths, db } = makeProject();
    const transcoder = fakeTranscoder(() => LONG);
    const { results } = await runProxyStage({
      paths,
      plan: planWithVideos(),
      db,
      transcoder,
      files: ["assets/broll.mp4"],
      log: silentLog,
    });
    expect(results.map((r) => r.sceneId)).toEqual(["assets/broll.mp4"]);
  });

  it("isi ledger cukup untuk memulihkan proxy tanpa memeriksa ulang", async () => {
    const { paths, db } = makeProject();
    const transcoder = fakeTranscoder(() => LONG);
    await runProxyStage({
      paths,
      plan: planWithVideos(),
      db,
      transcoder,
      log: silentLog,
    });
    const run = db.getRun("uji-proxy", "assets/podcast.mp4", "proxy");
    const stored = JSON.parse(run?.outputJson ?? "{}");
    expect(stored.proxy.width).toBe(960);
    expect(stored.codec).toBe("hevc");
    expect(stored.reason).toContain("hevc");
    expect(readFileSync(join(paths.planDir, stored.proxy.file), "utf8")).toContain(
      "960x540",
    );
  });
});

describe("runProxyStage — kemajuan, kait per berkas, pembatalan (ADR-0028 §10)", () => {
  /** Transkoder palsu yang melaporkan kemajuan dan menghormati sinyal. */
  const progressiveTranscoder = (): FakeTranscoder => {
    const base = fakeTranscoder(() => LONG);
    const inner = base.makeProxy.bind(base);
    base.makeProxy = async (request, hooks) => {
      hooks?.onProgress?.(0.5);
      if (hooks?.signal?.aborted) return { ok: false, reason: "dibatalkan" };
      return inner(request, hooks);
    };
    return base;
  };

  it("melaporkan kemajuan per berkas dengan indeks/total, dan onFile membawa proxy-nya", async () => {
    const { paths, db } = makeProject();
    const progress: Array<{
      file: string;
      index: number;
      total: number;
      fraction: number;
    }> = [];
    const files: Array<{
      file: string;
      status: string;
      proxy: string | null | undefined;
    }> = [];
    await runProxyStage({
      paths,
      plan: planWithVideos(),
      db,
      transcoder: progressiveTranscoder(),
      log: silentLog,
      onProgress: (event) =>
        progress.push({
          file: event.file,
          index: event.index,
          total: event.total,
          fraction: event.fraction,
        }),
      onFile: (event) =>
        files.push({
          file: event.file,
          status: event.result.status,
          proxy: event.proxy === undefined ? undefined : (event.proxy?.file ?? null),
        }),
    });
    expect(
      progress.filter((p) => p.file === "assets/podcast.mp4").map((p) => p.fraction),
    ).toEqual([0, 0.5, 1]);
    expect(progress[0]).toMatchObject({ index: 1, total: 2 });
    expect(progress.at(-1)).toMatchObject({
      file: "assets/broll.mp4",
      index: 2,
      total: 2,
    });
    expect(files.map((f) => f.status)).toEqual(["done", "done"]);
    expect(files[0]?.proxy?.endsWith("-540p.mp4")).toBe(true);
    // Berkas sementara tidak tertinggal: yang ada hanya proxy jadinya.
    expect(
      readdirSync(paths.proxiesDir).every((name) => name.endsWith("-540p.mp4")),
    ).toBe(true);
  });

  it("pembatalan menghentikan berkas berikutnya dan melaporkannya sebagai dibatalkan, bukan gagal", async () => {
    const { paths, db } = makeProject();
    const controller = new AbortController();
    const { results, plan } = await runProxyStage({
      paths,
      plan: planWithVideos(),
      db,
      transcoder: progressiveTranscoder(),
      log: silentLog,
      signal: controller.signal,
      onFile: () => controller.abort(),
    });
    expect(results.map((r) => [r.sceneId, r.status])).toEqual([
      ["assets/podcast.mp4", "done"],
      ["assets/broll.mp4", "skipped"],
    ]);
    expect(results[1]?.detail).toContain("dibatalkan");
    expect(plan.renderState.clipAssets["a-k1"]?.proxy).toBeDefined();
    expect(plan.renderState.clipAssets["b-k1"]?.proxy).toBeUndefined();
  });

  it("pembatalan di tengah ffmpeg: dicatat dibatalkan, tanpa proxy setengah jadi, dan jalan berikutnya membuatnya lagi", async () => {
    const { paths, db } = makeProject();
    const controller = new AbortController();
    const transcoder = fakeTranscoder(() => LONG);
    transcoder.makeProxy = async (_request, hooks) => {
      controller.abort();
      hooks?.onProgress?.(0.3);
      return { ok: false, reason: "dibatalkan" };
    };
    const { results } = await runProxyStage({
      paths,
      plan: planWithVideos(),
      db,
      transcoder,
      log: silentLog,
      signal: controller.signal,
    });
    expect(results.map((r) => r.status)).toEqual(["skipped", "skipped"]);
    expect(results[0]?.detail).toContain("dibatalkan");
    expect(existsSync(paths.proxiesDir) ? readdirSync(paths.proxiesDir) : []).toEqual([]);

    // Ledger tidak menganggapnya selesai: jalan berikutnya membuat proxy sungguhan.
    const again = await runProxyStage({
      paths,
      plan: planWithVideos(),
      db,
      transcoder: fakeTranscoder(() => LONG),
      log: silentLog,
    });
    expect(again.results.map((r) => r.status)).toEqual(["done", "done"]);
  });
});
