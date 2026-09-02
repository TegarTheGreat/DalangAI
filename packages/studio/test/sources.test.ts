import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { MediaProbeInfo, MediaTranscoder } from "@dalang/pipeline";
import { afterEach, describe, expect, it } from "vitest";
import type {
  PeaksResponse,
  ProjectStatePayload,
  RegisterSourceResponse,
  SourcesResponse,
} from "../src/shared/api-types";
import { call, callJson, makeStudio, makeTempProject } from "./helpers";

/**
 * Sumber rekaman & proxy di panel MANUAL (ADR-0028).
 *
 * Yang dijaga: rekaman bisa masuk proyek TANPA agent (unggah streaming ke
 * disk, bukan data URL), pemasangannya jadi patch user yang bisa di-undo,
 * proxy-nya tercatat di renderState dan tersaji lewat mount media, thumbnail
 * dan gelombang di-cache di disk, dan mesin tanpa transkoder mengatakan apa
 * yang tidak bisa ia lakukan — bukan pura-pura.
 */

const LONG: MediaProbeInfo = {
  durationSec: 1800,
  width: 1920,
  height: 1080,
  fps: 30,
  codec: "hevc",
  hasAudio: true,
  audioCodec: "aac",
  channels: 2,
  sampleRate: 48000,
  bitrate: 8_000_000,
  sizeBytes: 1,
};

const JPEG_STUB = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

const fakeTranscoder = () => {
  const calls = { probe: 0, proxy: 0, frames: [] as number[], pcm: 0 };
  const transcoder: MediaTranscoder = {
    id: "fake-ff",
    probe: async (sourcePath) => {
      calls.probe += 1;
      return sourcePath.endsWith(".mp4") || sourcePath.endsWith(".mov") ? LONG : null;
    },
    makeProxy: async (request) => {
      calls.proxy += 1;
      mkdirSync(join(request.outputPath, ".."), { recursive: true });
      writeFileSync(request.outputPath, "proxy-uji");
      return {
        ok: true,
        width: request.width,
        height: request.height,
        durationSec: LONG.durationSec,
        fps: request.fps ?? LONG.fps,
      };
    },
    extractFrame: async (_source, atSec, outputPath) => {
      calls.frames.push(atSec);
      mkdirSync(join(outputPath, ".."), { recursive: true });
      writeFileSync(outputPath, JPEG_STUB);
      return { ok: true };
    },
    toWav: async () => ({ ok: true }),
    decodeMonoPcm: async () => {
      calls.pcm += 1;
      const pcm = new Int16Array(2000);
      for (let i = 0; i < pcm.length; i++) pcm[i] = i < 1000 ? 0 : 16384;
      return pcm;
    },
  };
  return { transcoder, calls };
};

const cleanups: Array<() => void> = [];
const boot = (options: { transcoder?: boolean } = { transcoder: true }) => {
  const { dir, planPath } = makeTempProject();
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "assets/podcast.mp4"), "rekaman palsu satu");
  writeFileSync(join(dir, "assets/catatan.txt"), "bukan media");
  const fake = fakeTranscoder();
  const studio = makeStudio(
    planPath,
    options.transcoder === false ? {} : { transcoder: () => fake.transcoder },
  );
  cleanups.push(() => {
    studio.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { studio, dir, planPath, calls: fake.calls };
};

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

const getProject = async (studio: ReturnType<typeof boot>["studio"]) =>
  (await callJson<ProjectStatePayload>(studio, "/api/project")).body;

describe("GET /api/sources", () => {
  it("mendaftar rekaman di folder proyek dengan fakta, pemakai, dan keputusan proxy", async () => {
    const { studio } = boot();
    const { status, body } = await callJson<SourcesResponse>(studio, "/api/sources");
    expect(status).toBe(200);
    expect(body.transcoder).toBe(true);
    expect(body.sources.map((s) => s.file)).toEqual(["assets/podcast.mp4"]);
    const source = body.sources[0]!;
    expect(source.kind).toBe("video");
    expect(source.probe?.codec).toBe("hevc");
    expect(source.usedBy).toEqual({ sceneIds: [], layerIds: [] });
    expect(source.proxy).toBeNull();
    expect(source.proxyDecision?.needed).toBe(true);
    expect(source.proxyDecision?.reason).toContain("hevc");
  });

  it("tanpa transkoder daftar tetap ada, dan transcoder=false dikatakan", async () => {
    const { studio } = boot({ transcoder: false });
    const { body } = await callJson<SourcesResponse>(studio, "/api/sources");
    expect(body.transcoder).toBe(false);
    // probeVideo palsu lama masih memberi durasi/dimensi untuk .mp4.
    expect(body.sources[0]?.probe?.durationSec).toBe(600);
    expect(body.sources[0]?.probe?.codec).toBeNull();
  });
});

/**
 * Unggahan dikirim sebagai Request MENTAH: helper `call` menulis header
 * content-type JSON untuk setiap body, dan yang diuji di sini justru body
 * biner beserta header content-length-nya.
 */
const upload = (
  studio: ReturnType<typeof boot>["studio"],
  name: string,
  body: Buffer,
  headers: Record<string, string> = {},
) =>
  Promise.resolve(
    studio.app.fetch(
      new Request(
        `http://studio.local/api/sources/upload?name=${encodeURIComponent(name)}`,
        {
          method: "POST",
          headers: { "content-type": "application/octet-stream", ...headers },
          body: new Uint8Array(body),
        },
      ),
    ),
  );

describe("POST /api/sources/upload (streaming)", () => {
  it("menulis body mentah ke assets/rekaman dengan nama ber-hash, lalu mendeskripsikannya", async () => {
    const { studio, dir } = boot();
    const bytes = Buffer.alloc(300_000, 7);
    const response = await upload(studio, "Wawancara Pagi.MOV", bytes);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: true; file: string; existed: boolean };
    expect(body.file).toMatch(/^assets\/rekaman\/wawancara-pagi-[0-9a-f]{10}\.mov$/);
    expect(body.existed).toBe(false);
    expect(readFileSync(join(dir, body.file)).equals(bytes)).toBe(true);
    // Tidak ada berkas sementara yang tertinggal.
    expect(existsSync(join(dir, "assets/rekaman"))).toBe(true);

    // Unggahan yang sama persis tidak disalin dua kali.
    const again = await upload(studio, "lain.mov", bytes);
    const second = (await again.json()) as { file: string; existed: boolean };
    expect(second.existed).toBe(true);
    expect(second.file).toBe(body.file);
  });

  it("menolak ekstensi yang bukan media dan berkas kosong", async () => {
    const { studio } = boot();
    expect((await upload(studio, "virus.exe", Buffer.from("x"))).status).toBe(400);
    expect((await upload(studio, "kosong.mp4", Buffer.alloc(0))).status).toBe(400);
  });

  it("menolak yang melampaui batas DALANG_MAX_UPLOAD_MB, sebelum maupun selama streaming", async () => {
    const { studio, dir } = boot();
    const before = process.env.DALANG_MAX_UPLOAD_MB;
    process.env.DALANG_MAX_UPLOAD_MB = "0.0001"; // ~105 byte
    try {
      const declared = await upload(studio, "besar.mp4", Buffer.alloc(10), {
        "content-length": "10000000",
      });
      expect(declared.status).toBe(413);
      const streamed = await upload(studio, "besar.mp4", Buffer.alloc(5000));
      expect(streamed.status).toBe(413);
      // Berkas parsial dibersihkan: folder rekaman tidak menyimpan sisa .part.
      const leftovers = existsSync(join(dir, "assets/rekaman"))
        ? readdirSync(join(dir, "assets/rekaman")).filter((name) =>
            name.endsWith(".part"),
          )
        : [];
      expect(leftovers).toEqual([]);
    } finally {
      if (before === undefined) delete process.env.DALANG_MAX_UPLOAD_MB;
      else process.env.DALANG_MAX_UPLOAD_MB = before;
    }
  });
});

describe("POST /api/sources/register", () => {
  it("memasang rekaman ke scene sebagai patch user ter-pin, membuat proxy, dan bisa di-undo", async () => {
    const { studio, dir, calls } = boot();
    const { status, body } = await callJson<RegisterSourceResponse>(
      studio,
      "/api/sources/register",
      {
        method: "POST",
        body: JSON.stringify({
          file: "assets/podcast.mp4",
          sceneId: "sc-batu",
          trimStartSec: 90,
        }),
      },
    );
    expect(status).toBe(200);
    expect(body.codec).toBe("hevc");
    expect(body.proxy).toMatchObject({ width: 960, height: 540 });
    expect(calls.proxy).toBe(1);
    expect(existsSync(join(dir, body.proxy?.file ?? ""))).toBe(true);

    const project = await getProject(studio);
    const scene = project.plan?.scenes.find((s) => s.id === "sc-batu");
    expect(scene?.visual.assetId).toBe("assets/podcast.mp4");
    expect(scene?.visual.pinned).toBe(true);
    expect(scene?.visual.trimStartSec).toBe(90);
    const asset = project.plan?.renderState.resolvedAssets["sc-batu"];
    expect(asset?.kind).toBe("video");
    expect(asset?.codec).toBe("hevc");
    expect(asset?.proxy?.file.startsWith(".dalang/proxies/")).toBe(true);
    expect(project.patchLog.recent.at(-1)?.origin).toBe("user");
    expect(
      project.stageRuns.some((run) => run.stage === "proxy" && run.status === "done"),
    ).toBe(true);

    // Daftar sumber kini menyebut pemakainya dan proxy-nya.
    const sources = (await callJson<SourcesResponse>(studio, "/api/sources")).body;
    expect(sources.sources[0]?.usedBy.sceneIds).toEqual(["sc-batu"]);
    expect(sources.sources[0]?.proxy?.width).toBe(960);

    // Urungkan mengembalikan visual scene; proxy (data turunan) boleh tinggal.
    await call(studio, "/api/undo", { method: "POST" });
    const undone = await getProject(studio);
    expect(undone.plan?.scenes.find((s) => s.id === "sc-batu")?.visual.pinned).toBe(
      false,
    );
  });

  it("memasang ke LAPISAN lewat layerId, dengan titik masuk lapisan", async () => {
    const { studio } = boot();
    await call(studio, "/api/patch", {
      method: "POST",
      body: JSON.stringify({
        ops: [
          {
            op: "updateScene",
            id: "sc-batu",
            patch: {
              layers: [
                {
                  id: "lap-uji",
                  visual: { type: "stock" },
                  anchor: "kanan-bawah",
                  width: 0.3,
                  height: 0.3,
                },
              ],
            },
          },
        ],
      }),
    });
    const { status } = await callJson<RegisterSourceResponse>(
      studio,
      "/api/sources/register",
      {
        method: "POST",
        body: JSON.stringify({
          file: "assets/podcast.mp4",
          sceneId: "sc-batu",
          layerId: "lap-uji",
          trimStartSec: 12.5,
        }),
      },
    );
    expect(status).toBe(200);
    const project = await getProject(studio);
    const layer = project.plan?.scenes.find((s) => s.id === "sc-batu")?.layers[0];
    expect(layer?.visual.assetId).toBe("assets/podcast.mp4");
    expect(layer?.visual.pinned).toBe(true);
    expect(layer?.visual.trimStartSec).toBe(12.5);
    expect(project.plan?.renderState.layerAssets["lap-uji"]?.proxy?.width).toBe(960);
  });

  it("menolak path keluar folder, berkas hilang, bukan-video, scene terkunci", async () => {
    const { studio } = boot();
    const post = (body: unknown) =>
      callJson<{ error: string }>(studio, "/api/sources/register", {
        method: "POST",
        body: JSON.stringify(body),
      });
    expect((await post({ file: "../rahasia.mp4", sceneId: "sc-batu" })).status).toBe(400);
    expect(
      (await post({ file: "assets/tidak-ada.mp4", sceneId: "sc-batu" })).status,
    ).toBe(404);
    expect((await post({ file: "assets/catatan.txt", sceneId: "sc-batu" })).status).toBe(
      400,
    );
    await call(studio, "/api/patch", {
      method: "POST",
      body: JSON.stringify({ ops: [{ op: "lockScene", id: "sc-batu", locked: true }] }),
    });
    const locked = await post({ file: "assets/podcast.mp4", sceneId: "sc-batu" });
    expect(locked.status).toBe(400);
    expect(locked.body.error).toContain("terkunci");
  });

  it("tanpa transkoder tetap memasang, tanpa proxy, dan mengatakannya", async () => {
    const { studio } = boot({ transcoder: false });
    const { body } = await callJson<RegisterSourceResponse>(
      studio,
      "/api/sources/register",
      {
        method: "POST",
        body: JSON.stringify({ file: "assets/podcast.mp4", sceneId: "sc-batu" }),
      },
    );
    expect(body.ok).toBe(true);
    expect(body.proxy).toBeNull();
    expect(body.proxyNote).toContain("tidak ada transkoder");
    const project = await getProject(studio);
    expect(project.plan?.renderState.resolvedAssets["sc-batu"]?.durationSec).toBe(600);
  });
});

describe("thumbnail, gelombang, mount proxy", () => {
  it("thumb: bingkai pada detik yang diminta, di-cache di .dalang/thumbs, dipangkas ke durasi", async () => {
    const { studio, dir, calls } = boot();
    const first = await call(
      studio,
      "/api/sources/thumb?file=assets/podcast.mp4&t=600&h=54",
    );
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await first.arrayBuffer()).equals(JPEG_STUB)).toBe(true);
    expect(calls.frames).toEqual([600]);
    // Kedua kalinya dari cache: transkoder tidak dipanggil lagi.
    await call(studio, "/api/sources/thumb?file=assets/podcast.mp4&t=600&h=54");
    expect(calls.frames).toEqual([600]);
    expect(existsSync(join(dir, ".dalang/thumbs"))).toBe(true);
    // Di luar durasi dipangkas, bukan ditolak.
    await call(studio, "/api/sources/thumb?file=assets/podcast.mp4&t=99999&h=54");
    expect(calls.frames[1]).toBeLessThan(LONG.durationSec);
    // Path keluar folder ditolak.
    expect((await call(studio, "/api/sources/thumb?file=../x.mp4")).status).toBe(400);
  });

  it("peaks: puncak per keranjang dari PCM mono, di-cache, dan hasAudio jujur", async () => {
    const { studio, calls } = boot();
    const { status, body } = await callJson<PeaksResponse>(
      studio,
      "/api/sources/peaks?file=assets/podcast.mp4&buckets=20",
    );
    expect(status).toBe(200);
    expect(body.peaks).toHaveLength(20);
    // Separuh pertama sunyi, separuh kedua setengah skala.
    expect(body.peaks.slice(0, 10).every((p) => p === 0)).toBe(true);
    expect(body.peaks.slice(10).every((p) => p === 0.5)).toBe(true);
    expect(body.hasAudio).toBe(true);
    expect(body.durationSec).toBe(LONG.durationSec);
    await callJson<PeaksResponse>(
      studio,
      "/api/sources/peaks?file=assets/podcast.mp4&buckets=20",
    );
    expect(calls.pcm).toBe(1);
  });

  it("tanpa transkoder: thumb dan peaks menjawab 501 dengan alasan", async () => {
    const { studio } = boot({ transcoder: false });
    expect(
      (await call(studio, "/api/sources/thumb?file=assets/podcast.mp4&t=1")).status,
    ).toBe(501);
    expect(
      (await call(studio, "/api/sources/peaks?file=assets/podcast.mp4")).status,
    ).toBe(501);
  });

  it("proxy tersaji lewat /.dalang/proxies/*, tapi pipeline.db tetap tertutup", async () => {
    const { studio } = boot();
    const { body } = await callJson<RegisterSourceResponse>(
      studio,
      "/api/sources/register",
      {
        method: "POST",
        body: JSON.stringify({ file: "assets/podcast.mp4", sceneId: "sc-batu" }),
      },
    );
    const served = await call(studio, `/${body.proxy?.file}`);
    expect(served.status).toBe(200);
    expect(await served.text()).toBe("proxy-uji");
    expect((await call(studio, "/.dalang/pipeline.db")).status).toBe(404);
    expect((await call(studio, "/.dalang/thumbs/apa-saja.jpg")).status).toBe(404);
  });
});

describe("POST /api/pipeline/proxies", () => {
  it("menjalankan tahap proxy untuk semua berkas video plan dan menyiarkan hasilnya", async () => {
    const { studio, calls } = boot();
    await call(studio, "/api/sources/register", {
      method: "POST",
      body: JSON.stringify({ file: "assets/podcast.mp4", sceneId: "sc-batu" }),
    });
    const { status, body } = await callJson<{ results: Array<{ status: string }> }>(
      studio,
      "/api/pipeline/proxies",
      { method: "POST", body: JSON.stringify({}) },
    );
    expect(status).toBe(200);
    expect(body.results.map((r) => r.status)).toEqual(["cached"]);
    const forced = await callJson<{ results: Array<{ status: string }> }>(
      studio,
      "/api/pipeline/proxies",
      { method: "POST", body: JSON.stringify({ force: true }) },
    );
    expect(forced.body.results.map((r) => r.status)).toEqual(["done"]);
    expect(calls.proxy).toBe(2);
  });
});
