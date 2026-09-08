import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ScenePlanInput } from "@dalang/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  deriveQuery,
  orientationForAspect,
  PipelineDb,
  projectPaths,
  readPlanFile,
  runAssetStage,
} from "../src/index";
import { basicPlan, fakeStock, makeTempProject, silentLog } from "./helpers";

let cleanupFns: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanupFns) fn();
  cleanupFns = [];
});

const setup = (planOverrides: Partial<ScenePlanInput> = {}) => {
  const project = makeTempProject(basicPlan(planOverrides));
  cleanupFns.push(project.cleanup);
  const paths = projectPaths(project.planPath);
  const plan = readPlanFile(paths.planPath);
  const db = new PipelineDb(":memory:");
  cleanupFns.push(() => db.close());
  return { paths, plan, db };
};

describe("helpers", () => {
  it("maps aspect ratios to orientations", () => {
    expect(orientationForAspect("9:16")).toBe("portrait");
    expect(orientationForAspect("16:9")).toBe("landscape");
    expect(orientationForAspect("1:1")).toBe("square");
  });

  it("derives a query from the narration deterministically", () => {
    expect(
      deriveQuery("Di jantung Pulau Jawa berdiri mahakarya abad kesembilan yang megah"),
    ).toBe("Di jantung Pulau Jawa berdiri mahakarya abad kesembilan");
  });
});

describe("runAssetStage", () => {
  it("resolves stock scenes: video preferred, license + assetId recorded", async () => {
    const { paths, plan, db } = setup();
    const provider = fakeStock("pexels-palsu");
    const { plan: next, results } = await runAssetStage({
      paths,
      plan,
      providers: [provider],
      db,
      log: silentLog,
    });

    const result = results.find((r) => r.sceneId === "sc-001");
    expect(result).toMatchObject({ status: "done", provider: "pexels-palsu" });
    expect(provider.searchCalls[0]).toEqual({ query: "candi jawa", kind: "video" });

    const scene = next.scenes.find((s) => s.id === "sc-001")!;
    expect(scene.clips[0]?.assetId).toBe("pexels-palsu:video:42");
    expect(scene.clips[0]?.pinned).toBe(false); // auto-resolve never pins

    const asset = next.renderState.clipAssets["sc-001-k1"]!;
    expect(asset.license).toBe("pexels-palsu License");
    expect(asset.kind).toBe("video");
    expect(existsSync(join(paths.planDir, asset.file))).toBe(true);
  });

  it("falls through video→image and across providers", async () => {
    const { paths, plan, db } = setup();
    const videoless = fakeStock("utama", { kinds: ["image"] });
    const { plan: next, results } = await runAssetStage({
      paths,
      plan,
      providers: [videoless],
      db,
      log: silentLog,
    });
    expect(results.find((r) => r.sceneId === "sc-001")?.status).toBe("done");
    expect(next.renderState.clipAssets["sc-001-k1"]?.kind).toBe("image");

    const { paths: paths2, plan: plan2, db: db2 } = setup();
    const broken = fakeStock("utama", { failSearch: true });
    const backup = fakeStock("cadangan");
    const { results: results2 } = await runAssetStage({
      paths: paths2,
      plan: plan2,
      providers: [broken, backup],
      db: db2,
      log: silentLog,
    });
    expect(results2.find((r) => r.sceneId === "sc-001")).toMatchObject({
      status: "done",
      provider: "cadangan",
      fallback: true,
    });
  });

  it("never touches pinned or locked scenes", async () => {
    const { paths, plan, db } = setup({
      scenes: [
        {
          id: "sc-pin",
          narration: "Aset pilihan user.",
          clips: [
            {
              id: "sc-pin-k1",
              type: "stock",
              query: "x",
              assetId: "manual:1",
              pinned: true,
            },
          ],
        },
        {
          id: "sc-lock",
          locked: true,
          narration: "Scene terkunci.",
          clips: [{ id: "sc-lock-k1", type: "stock", query: "y" }],
        },
      ],
    });
    const provider = fakeStock("p");
    const { plan: next, results } = await runAssetStage({
      paths,
      plan,
      providers: [provider],
      db,
      log: silentLog,
    });
    expect(results.map((r) => r.status)).toEqual(["skipped", "skipped"]);
    expect(provider.searchCalls).toHaveLength(0);
    expect(next.scenes[0]?.clips[0]?.assetId).toBe("manual:1");
  });

  it("second run hits the cache; changed query re-resolves", async () => {
    const { paths, plan, db } = setup();
    const provider = fakeStock("p");
    const first = await runAssetStage({
      paths,
      plan,
      providers: [provider],
      db,
      log: silentLog,
    });
    const second = await runAssetStage({
      paths,
      plan: first.plan,
      providers: [provider],
      db,
      log: silentLog,
    });
    expect(second.results.find((r) => r.sceneId === "sc-001")?.status).toBe("cached");
    expect(provider.searchCalls).toHaveLength(1);

    const edited = structuredClone(second.plan);
    edited.scenes[0]!.clips[0]!.query = "kueri baru";
    const third = await runAssetStage({
      paths,
      plan: edited,
      providers: [provider],
      db,
      log: silentLog,
    });
    expect(third.results.find((r) => r.sceneId === "sc-001")?.status).toBe("done");
    expect(provider.searchCalls).toHaveLength(2);
  });

  it("derives the query from narration when none is set", async () => {
    const { paths, plan, db } = setup({
      scenes: [
        {
          id: "sc-001",
          narration: "Candi Borobudur berdiri megah di Jawa Tengah",
          clips: [{ id: "sc-001-k1", type: "stock" }],
        },
      ],
    });
    const provider = fakeStock("p");
    const { results } = await runAssetStage({
      paths,
      plan,
      providers: [provider],
      db,
      log: silentLog,
    });
    expect(provider.searchCalls[0]?.query).toBe(
      "Candi Borobudur berdiri megah di Jawa Tengah",
    );
    expect(results[0]?.detail).toContain("query turunan");
  });

  /**
   * Scene berklip banyak (ADR-0033).
   *
   * Yang diuji di sini adalah satu sifat yang gampang hilang tanpa terlihat:
   * tahap ini dulu membaca klip pertama saja, jadi potongan kedua dan
   * seterusnya tidak pernah dicarikan berkas — dan kegagalannya muncul jauh di
   * hilir, sebagai latar prosedural di tengah video.
   */
  const tigaKlip = () =>
    setup({
      scenes: [
        {
          id: "sc-001",
          narration: "Satu kalimat, tiga potongan gambar.",
          clips: [
            { id: "sc-001-k1", type: "stock", query: "candi jawa", durationSec: 3 },
            { id: "sc-001-k2", type: "stock", query: "relief batu", durationSec: 3 },
            { id: "sc-001-k3", type: "stock", query: "stupa fajar", durationSec: 3 },
          ],
        },
      ],
    });

  it("mencari berkas untuk SETIAP klip, bukan cuma yang pertama", async () => {
    const { paths, plan, db } = tigaKlip();
    const provider = fakeStock("p");
    const { plan: next, results } = await runAssetStage({
      paths,
      plan,
      providers: [provider],
      db,
      log: silentLog,
    });

    expect(provider.searchCalls.map((call) => call.query)).toEqual([
      "candi jawa",
      "relief batu",
      "stupa fajar",
    ]);
    expect(Object.keys(next.renderState.clipAssets).sort()).toEqual([
      "sc-001-k1",
      "sc-001-k2",
      "sc-001-k3",
    ]);
    // Tiga baris hasil, dan yang bukan klip pertama menyebut klipnya supaya
    // pembaca laporan tahu potongan mana yang gagal kalau ada yang gagal.
    expect(results.filter((row) => row.status === "done")).toHaveLength(3);
    expect(results.map((row) => row.clipId)).toEqual([
      "sc-001-k1",
      "sc-001-k2",
      "sc-001-k3",
    ]);
  });

  it("kunci cache klip pertama tetap id scene, klip berikutnya terpisah", async () => {
    const { paths, plan, db } = tigaKlip();
    await runAssetStage({
      paths,
      plan,
      providers: [fakeStock("p")],
      db,
      log: silentLog,
    });
    // Kunci lama dipertahankan untuk klip pertama: menggantinya berarti setiap
    // proyek yang sudah ada mengunduh ulang seluruh asetnya tanpa alasan.
    expect(db.getRun(plan.projectId, "sc-001", "assets")?.status).toBe("done");
    expect(db.getRun(plan.projectId, "sc-001@sc-001-k2", "assets")?.status).toBe("done");
    expect(db.getRun(plan.projectId, "sc-001@sc-001-k3", "assets")?.status).toBe("done");

    // Jalan kedua: semuanya dari cache, dan providernya tidak dipanggil lagi.
    const provider = fakeStock("p");
    const { results } = await runAssetStage({
      paths,
      plan,
      providers: [provider],
      db,
      log: silentLog,
    });
    expect(provider.searchCalls).toHaveLength(0);
    expect(results.every((row) => row.status === "cached")).toBe(true);
  });

  it("klip kedua tanpa query ditolak dengan alasannya, bukan diberi kueri narasi", async () => {
    const { paths, plan, db } = setup({
      scenes: [
        {
          id: "sc-001",
          narration: "Narasi yang cukup panjang untuk jadi kueri turunan.",
          clips: [
            { id: "sc-001-k1", type: "stock", durationSec: 3 },
            { id: "sc-001-k2", type: "stock", durationSec: 3 },
          ],
        },
      ],
    });
    const provider = fakeStock("p");
    const { results } = await runAssetStage({
      paths,
      plan,
      providers: [provider],
      db,
      log: silentLog,
    });
    // Klip pertama tetap boleh menurunkan kueri dari narasi.
    expect(provider.searchCalls[0]?.query).toBe(
      "Narasi yang cukup panjang untuk jadi kueri turunan.",
    );
    const kedua = results.find((row) => row.clipId === "sc-001-k2");
    expect(kedua?.status).toBe("error");
    expect(kedua?.detail).toContain("clip.query sendiri");
    // Dan tidak ada pencarian kedua dengan kueri yang sama.
    expect(provider.searchCalls).toHaveLength(1);
  });

  it("satu klip ter-pin tidak menghalangi potongan lain di scene yang sama", async () => {
    const { paths, plan, db } = setup({
      scenes: [
        {
          id: "sc-001",
          narration: "Satu kalimat, dua potongan.",
          clips: [
            {
              id: "sc-001-k1",
              type: "stock",
              query: "candi jawa",
              assetId: "pilihan-tangan",
              pinned: true,
              durationSec: 3,
            },
            { id: "sc-001-k2", type: "stock", query: "relief batu", durationSec: 3 },
          ],
        },
      ],
    });
    const { plan: next, results } = await runAssetStage({
      paths,
      plan,
      providers: [fakeStock("p")],
      db,
      log: silentLog,
    });
    expect(results.find((row) => row.clipId === "sc-001-k1")?.status).toBe("skipped");
    expect(results.find((row) => row.clipId === "sc-001-k2")?.status).toBe("done");
    expect(next.renderState.clipAssets["sc-001-k1"]).toBeUndefined();
    expect(next.renderState.clipAssets["sc-001-k2"]).toBeDefined();
  });

  it("errors clearly with an empty provider chain, per scene", async () => {
    const { paths, plan, db } = setup();
    const { results } = await runAssetStage({
      paths,
      plan,
      providers: [],
      db,
      log: silentLog,
    });
    const result = results.find((r) => r.sceneId === "sc-001");
    expect(result?.status).toBe("error");
    expect(result?.detail).toContain("PEXELS_API_KEY");
  });
});
