import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseScenePlan } from "@dalang/core";
import { afterEach, describe, expect, it } from "vitest";
import { estimateLambdaCost } from "../src/cost";
import { contentTypeFor } from "../src/mime";
import { createLambdaRenderTarget, uploadPlanAssets } from "../src/render";
import {
  fakeAssetStore,
  fakeLambdaClient,
  instantSleep,
  planWithAssets,
  tempProject,
} from "./helpers";

/**
 * Target render cloud (ADR-0019).
 *
 * Yang diuji adalah URUTAN LANGKAHNYA — unggah, mulai, pantau, unduh — dan
 * janji-janji yang membuatnya aman: aset tidak diunggah dua kali, alamat aset
 * benar-benar sampai ke komposisi, kegagalan Lambda menjadi galat yang jelas,
 * dan render tidak menggantung selamanya. Panggilan AWS-nya palsu; yang tidak
 * bisa diuji di sini hanya apakah AWS menepati dokumentasinya.
 */

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

const project = () => {
  const p = tempProject();
  cleanups.push(() => rmSync(p.dir, { recursive: true, force: true }));
  return p;
};

const target = (overrides: Parameters<typeof fakeLambdaClient>[0] = {}) => {
  const assets = fakeAssetStore();
  const lambda = fakeLambdaClient(overrides);
  return {
    assets,
    lambda,
    render: createLambdaRenderTarget(
      {
        serveUrl: "https://situs.test/sites/dalang",
        compositionId: "Dalang",
        memorySizeInMb: 2048,
        framesPerLambda: 20,
        pollIntervalMs: 1,
      },
      { client: lambda.client, assets: assets.store, sleep: instantSleep },
    ),
  };
};

describe("unggah aset plan", () => {
  it("mengunggah setiap berkas sekali dengan content-type yang benar", async () => {
    const { planPath } = project();
    const { store, uploads } = fakeAssetStore();
    const out = await uploadPlanAssets(planPath, parseScenePlan(planWithAssets()), store);
    expect(out.uploaded).toBe(2);
    expect(out.skipped).toBe(0);
    expect(uploads).toEqual(["assets/a.png|image/png", "assets/b.png|image/png"]);
  });

  /**
   * Render kedua atas proyek yang sama tidak boleh membayar ongkos unggah lagi.
   * Ini yang membuat iterasi di cloud terasa murah, bukan hanya mungkin.
   */
  it("render kedua memakai ulang aset yang isinya tidak berubah", async () => {
    const { planPath } = project();
    const { store, uploads } = fakeAssetStore();
    const plan = parseScenePlan(planWithAssets());
    await uploadPlanAssets(planPath, plan, store);
    const second = await uploadPlanAssets(planPath, plan, store);
    expect(second.uploaded).toBe(0);
    expect(second.skipped).toBe(2);
    expect(uploads).toHaveLength(2);
  });

  it("aset yang hilang dari disk ditolak dengan path yang jelas", async () => {
    const { dir, planPath } = project();
    rmSync(join(dir, "assets/a.png"));
    await expect(
      uploadPlanAssets(
        planPath,
        parseScenePlan(planWithAssets()),
        fakeAssetStore().store,
      ),
    ).rejects.toThrow(/assets\/a\.png/);
  });
});

describe("render di Lambda", () => {
  it("alamat aset ikut ke komposisi — tanpa itu videonya kosong", async () => {
    const { planPath } = project();
    const t = target();
    await t.render.render({
      planPath,
      outputLocation: join(planPath, "..", "out.mp4"),
      profile: "final",
    });
    const input = t.lambda.starts[0];
    // URL per berkas, bukan satu URL dasar: bawaan yang aman adalah tanda
    // tangan berumur pendek, dan tanda tangannya berbeda tiap objek.
    expect(input?.inputProps.assetUrls).toEqual({
      "assets/a.png": "https://bucket.test/proyek-lambda/assets/a.png?sig=palsu",
      "assets/b.png": "https://bucket.test/proyek-lambda/assets/b.png?sig=palsu",
    });
    expect(input?.serveUrl).toBe("https://situs.test/sites/dalang");
    expect(input?.codec).toBe("h264");
  });

  it("format ekspor menentukan codec video DAN audio", async () => {
    const { planPath } = project();
    const t = target();
    await t.render.render({
      planPath,
      outputLocation: join(planPath, "..", "out.webm"),
      profile: "final",
      settings: { format: "webm" },
    });
    expect(t.lambda.starts[0]?.codec).toBe("vp9");
    expect(t.lambda.starts[0]?.audioCodec).toBe("opus");
  });

  it("memantau sampai selesai lalu mengunduh hasilnya", async () => {
    const { planPath } = project();
    const t = target({ downloadBytes: 4242 });
    const result = await t.render.render({
      planPath,
      outputLocation: join(planPath, "..", "out.mp4"),
      profile: "final",
    });
    expect(t.lambda.polls()).toBeGreaterThan(1);
    expect(result.sizeBytes).toBe(4242);
    expect(result.durationInFrames).toBeGreaterThan(0);
  });

  it("melaporkan tahap unggah, render, dan unduh", async () => {
    const { planPath } = project();
    const t = target();
    const stages: string[] = [];
    await t.render.render({
      planPath,
      outputLocation: join(planPath, "..", "out.mp4"),
      profile: "final",
      onProgress: (event) => stages.push(event.stage),
    });
    expect(new Set(stages)).toEqual(new Set(["uploading", "rendering", "downloading"]));
  });

  it("kegagalan fatal Lambda jadi galat yang memuat pesan aslinya", async () => {
    const { planPath } = project();
    const t = target({
      progress: [
        {
          fatalErrorEncountered: true,
          errors: [{ message: "Chromium kehabisan memori" }],
        },
      ],
    });
    await expect(
      t.render.render({
        planPath,
        outputLocation: join(planPath, "..", "out.mp4"),
        profile: "final",
      }),
    ).rejects.toThrow(/Chromium kehabisan memori/);
  });

  /**
   * Tanpa batas waktu, render yang macet di AWS menggantung proses pemanggil
   * selamanya — dan di Studio itu berarti panel yang terkunci tanpa penjelasan.
   */
  it("berhenti dengan galat bila render tak kunjung selesai", async () => {
    const { planPath } = project();
    const assets = fakeAssetStore();
    const lambda = fakeLambdaClient({ progress: [{ overallProgress: 0.1 }] });
    let clock = 0;
    const render = createLambdaRenderTarget(
      {
        serveUrl: "https://situs.test/s",
        compositionId: "Dalang",
        memorySizeInMb: 2048,
        framesPerLambda: 20,
        pollIntervalMs: 1,
        timeoutMs: 50,
      },
      {
        client: lambda.client,
        assets: assets.store,
        sleep: instantSleep,
        now: () => {
          clock += 30;
          return clock;
        },
      },
    );
    await expect(
      render.render({
        planPath,
        outputLocation: join(planPath, "..", "out.mp4"),
        profile: "final",
      }),
    ).rejects.toThrow(/batas/);
  });

  it("estimasi biaya bisa dijawab tanpa menjalankan render", async () => {
    const { planPath } = project();
    const t = target();
    const estimate = await t.render.estimateCost({
      planPath,
      outputLocation: "/tmp/x.mp4",
      profile: "final",
    });
    expect(estimate.usd).toBeGreaterThan(0);
    expect(estimate.detail).toContain("invokasi Lambda");
    // Tidak ada satu pun panggilan AWS untuk sekadar menyebut harga.
    expect(t.lambda.starts).toHaveLength(0);
  });
});

describe("estimasi biaya", () => {
  it("naik seiring durasi, dan memuat invokasi penggabung", () => {
    const pendek = estimateLambdaCost({
      durationInFrames: 300,
      fps: 30,
      framesPerLambda: 20,
      memorySizeInMb: 2048,
    });
    const panjang = estimateLambdaCost({
      durationInFrames: 3000,
      fps: 30,
      framesPerLambda: 20,
      memorySizeInMb: 2048,
    });
    expect(panjang.usd).toBeGreaterThan(pendek.usd);
    // 300/20 = 15 chunk + 1 fungsi utama.
    expect(pendek.lambdasInvoked).toBe(16);
  });

  it("memori lebih besar berarti GB-detik lebih besar", () => {
    const kecil = estimateLambdaCost({
      durationInFrames: 600,
      fps: 30,
      framesPerLambda: 20,
      memorySizeInMb: 1024,
    });
    const besar = estimateLambdaCost({
      durationInFrames: 600,
      fps: 30,
      framesPerLambda: 20,
      memorySizeInMb: 4096,
    });
    expect(besar.gbSeconds).toBeCloseTo(kecil.gbSeconds * 4, 2);
  });

  it("dibulatkan ke ATAS — gerbang biaya tidak boleh terlalu optimistis", () => {
    const out = estimateLambdaCost({
      durationInFrames: 1,
      fps: 30,
      framesPerLambda: 20,
      memorySizeInMb: 2048,
    });
    expect(out.usd).toBeGreaterThan(0);
  });
});

describe("content-type", () => {
  it("mengenali media yang dipakai plan, dan punya jatuh-tempo yang aman", () => {
    expect(contentTypeFor("a/b.mp4")).toBe("video/mp4");
    expect(contentTypeFor("x.WAV")).toBe("audio/wav");
    expect(contentTypeFor("ikon.svg")).toBe("image/svg+xml");
    expect(contentTypeFor("tanpa-ekstensi")).toBe("application/octet-stream");
  });
});

/**
 * Sulih suara di Lambda (ADR-0040).
 *
 * Kegagalan yang dijaga di sini tidak punya pesan galat: `language` pernah
 * diterima kontrak `RenderRequest` tanpa disentuh target ini, sehingga
 * `--bahasa en --target lambda` diam-diam merender bahasa utama — dan
 * tagihannya terbayar untuk video yang salah. Satu-satunya cara menangkapnya
 * adalah memeriksa APA yang sampai ke Lambda, bukan apakah panggilannya
 * berhasil.
 */
describe("render Lambda dalam bahasa sulih", () => {
  const dubbedProject = () => {
    const input = planWithAssets();
    input.scenes[0] = {
      ...input.scenes[0],
      id: "sc-001",
      narration: "Satu.",
      dubs: {
        en: "One, said slowly and at a considerably greater length than the original.",
      },
      clips: [{ id: "sc-001-k1", type: "image" }],
      // "auto": durasi harus IKUT narasinya. Fixture dasar mematok 5 detik,
      // dan durasi yang dipatok memang sama di semua bahasa — tes yang
      // memakainya tidak akan pernah bisa melihat selisihnya.
      duration: "auto",
    } as never;
    input.renderState = {
      ...input.renderState,
      narrationAudio: {
        "sc-001": { file: "narasi/id-sc-001.wav", durationSec: 1 },
      },
      dubAudio: {
        en: { "sc-001": { file: "narasi/en-sc-001.wav", durationSec: 90 } },
      },
    } as never;
    const p = tempProject(input);
    for (const file of ["narasi/id-sc-001.wav", "narasi/en-sc-001.wav"]) {
      const abs = join(p.dir, file);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, `suara-${file}`);
    }
    cleanups.push(() => rmSync(p.dir, { recursive: true, force: true }));
    return p;
  };

  it("yang dikirim ke komposisi adalah plan BAHASA ITU, bukan bahasa utama", async () => {
    const { planPath } = dubbedProject();
    const t = target();
    await t.render.render({
      planPath,
      outputLocation: join(planPath, "..", "out.mp4"),
      profile: "final",
      language: "en",
    });
    const sent = t.lambda.starts[0]?.inputProps.plan as {
      meta: { language: string };
      scenes: Array<{ narration: string }>;
    };
    expect(sent.meta.language).toBe("en");
    expect(sent.scenes[0]?.narration).toContain("said slowly");
  });

  it("yang DIUNGGAH adalah suara bahasa itu — bukan suara bahasa utama", async () => {
    const { planPath } = dubbedProject();
    const t = target();
    await t.render.render({
      planPath,
      outputLocation: join(planPath, "..", "out.mp4"),
      profile: "final",
      language: "en",
    });
    const urls = t.lambda.starts[0]?.inputProps.assetUrls as Record<string, string>;
    expect(Object.keys(urls)).toContain("narasi/en-sc-001.wav");
    // Mengunggah suara yang salah = membayar S3 untuk berkas yang tidak
    // dipakai, DAN memutar yang salah kalau komposisinya mencarinya.
    expect(Object.keys(urls)).not.toContain("narasi/id-sc-001.wav");
  });

  it("tanpa language, perilakunya persis seperti sebelumnya (bahasa utama)", async () => {
    const { planPath } = dubbedProject();
    const t = target();
    await t.render.render({
      planPath,
      outputLocation: join(planPath, "..", "out.mp4"),
      profile: "final",
    });
    const sent = t.lambda.starts[0]?.inputProps.plan as { meta: { language: string } };
    expect(sent.meta.language).toBe("id");
    const urls = t.lambda.starts[0]?.inputProps.assetUrls as Record<string, string>;
    expect(Object.keys(urls)).toContain("narasi/id-sc-001.wav");
  });

  it("estimasi biaya memakai DURASI bahasa itu", async () => {
    // Gerbang anggaran yang menaksir dari durasi yang salah adalah gerbang
    // yang salah — dan di sini selisihnya besar (1 dtk vs 6 dtk narasi).
    const { planPath } = dubbedProject();
    const t = target();
    const utama = await t.render.estimateCost({
      planPath,
      outputLocation: "x.mp4",
      profile: "final",
    });
    const sulih = await t.render.estimateCost({
      planPath,
      outputLocation: "x.mp4",
      profile: "final",
      language: "en",
    });
    expect(sulih.usd).not.toBe(utama.usd);
  });
});
