import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ScenePlanInput } from "@dalang/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  layerOrientation,
  PipelineDb,
  projectPaths,
  readPlanFile,
  runAssetStage,
} from "../src/index";
import { fakeStock, makeTempProject, silentLog } from "./helpers";

/**
 * ADR-0025: resolve aset untuk LAPISAN video.
 *
 * Yang dijaga di sini adalah tiga hal yang mudah tergelincir: orientasi
 * pencarian diturunkan dari kotak lapisan (bukan rasio video), lapisan stock
 * tanpa kueri ditolak alih-alih diberi kueri narasi, dan cache tiap lapisan
 * berdiri sendiri walau dua lapisan hidup di satu scene.
 */

let cleanupFns: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanupFns) fn();
  cleanupFns = [];
});

const planWith = (layers: unknown[]): ScenePlanInput => ({
  version: 1,
  projectId: "proj-lapisan",
  meta: { title: "Uji Lapisan" },
  audio: {},
  scenes: [
    {
      id: "sc-001",
      narration: "Kalimat pertama.",
      visual: { type: "solid" },
      layers,
    } as never,
  ],
});

const setup = (layers: unknown[]) => {
  const project = makeTempProject(planWith(layers));
  cleanupFns.push(project.cleanup);
  const paths = projectPaths(project.planPath);
  const plan = readPlanFile(paths.planPath);
  const db = new PipelineDb(":memory:");
  cleanupFns.push(() => db.close());
  return { project, paths, plan, db };
};

describe("layerOrientation", () => {
  /**
   * Diturunkan dari KOTAKNYA, bukan dari rasio video: sisipan 0,2 x 0,55 di
   * bingkai 16:9 adalah kotak tegak, dan meminta stok landscape untuknya
   * memotong habis isinya di setiap sisipan.
   */
  it("kotak lebar = landscape, kotak tegak = portrait, kotak seimbang = square", () => {
    expect(layerOrientation({ width: 0.34, height: 0.34 }, "16:9")).toBe("landscape");
    expect(layerOrientation({ width: 0.2, height: 0.55 }, "16:9")).toBe("portrait");
    expect(layerOrientation({ width: 0.3, height: 0.53 }, "16:9")).toBe("square");
    // Bingkai tegak membalik kesimpulannya untuk kotak yang sama.
    expect(layerOrientation({ width: 0.34, height: 0.34 }, "9:16")).toBe("portrait");
  });
});

describe("runAssetStage untuk lapisan", () => {
  it("lapisan stock ter-resolve ke layerAssets, dikunci per id lapisan", async () => {
    const { paths, plan, db } = setup([
      { id: "lap-1", visual: { type: "stock", query: "rain window" } },
      { id: "lap-2", visual: { type: "stock", query: "coffee pour" } },
    ]);
    const provider = fakeStock("pexels-palsu");
    const { plan: next, results } = await runAssetStage({
      paths,
      plan,
      providers: [provider],
      db,
      log: silentLog,
    });

    const rows = results.filter((row) => row.layerId !== undefined);
    expect(rows.map((row) => row.status)).toEqual(["done", "done"]);
    expect(Object.keys(next.renderState.layerAssets).sort()).toEqual(["lap-1", "lap-2"]);
    // Dua lapisan, dua kueri berbeda: bukti kuncinya per lapisan, bukan per scene.
    expect(provider.searchCalls.map((call) => call.query)).toEqual([
      "rain window",
      "coffee pour",
    ]);
    expect(next.scenes[0]?.layers[0]?.visual.assetId).toBeTruthy();
  });

  /**
   * Kueri lapisan TIDAK diturunkan dari narasi. Kalau diturunkan, ia akan sama
   * persis dengan kueri visual dasarnya — dan sisipan yang isinya sama dengan
   * latarnya bukan B-roll, itu cuma gambar yang sama dua kali.
   */
  it("lapisan stock tanpa kueri jadi ERROR yang menyebutkan alasannya", async () => {
    const { paths, plan, db } = setup([{ id: "lap-1", visual: { type: "stock" } }]);
    const { results } = await runAssetStage({
      paths,
      plan,
      providers: [fakeStock("pexels-palsu")],
      db,
      log: silentLog,
    });
    const row = results.find((entry) => entry.layerId === "lap-1");
    expect(row?.status).toBe("error");
    expect(row?.detail).toContain("tidak diturunkan dari narasi");
  });

  it("lapisan ter-pin dilewati — pilihan eksplisit tidak ditimpa auto-resolve", async () => {
    const { paths, plan, db } = setup([
      { id: "lap-1", visual: { type: "stock", query: "rain", pinned: true } },
    ]);
    const { results } = await runAssetStage({
      paths,
      plan,
      providers: [fakeStock("pexels-palsu")],
      db,
      log: silentLog,
    });
    expect(results.find((row) => row.layerId === "lap-1")?.status).toBe("skipped");
  });

  it("lapisan lokal memakai berkas di folder proyek apa adanya", async () => {
    const { project, paths, plan, db } = setup([
      { id: "lap-1", visual: { type: "image", assetId: "assets/logo.png" } },
    ]);
    mkdirSync(join(project.dir, "assets"), { recursive: true });
    writeFileSync(join(project.dir, "assets", "logo.png"), new Uint8Array([1, 2, 3]));
    const { plan: next, results } = await runAssetStage({
      paths,
      plan,
      providers: [],
      db,
      log: silentLog,
    });
    expect(results.find((row) => row.layerId === "lap-1")?.status).toBe("done");
    expect(next.renderState.layerAssets["lap-1"]?.file).toBe("assets/logo.png");
    expect(next.renderState.layerAssets["lap-1"]?.source).toBe("local");
  });

  it("berkas lokal yang tidak ada dilaporkan, bukan didiamkan", async () => {
    const { paths, plan, db } = setup([
      { id: "lap-1", visual: { type: "image", assetId: "assets/hilang.png" } },
    ]);
    const { results } = await runAssetStage({
      paths,
      plan,
      providers: [],
      db,
      log: silentLog,
    });
    const row = results.find((entry) => entry.layerId === "lap-1");
    expect(row?.status).toBe("error");
    expect(row?.detail).toContain("tidak ditemukan");
  });

  it("scene terkunci membuat lapisannya ikut dilewati", async () => {
    const { paths, plan, db } = setup([
      { id: "lap-1", visual: { type: "stock", query: "rain" } },
    ]);
    const locked = { ...plan, scenes: [{ ...plan.scenes[0]!, locked: true }] };
    const { results } = await runAssetStage({
      paths,
      plan: locked,
      providers: [fakeStock("pexels-palsu")],
      db,
      log: silentLog,
    });
    expect(results.find((row) => row.layerId === "lap-1")?.detail).toBe("scene terkunci");
  });
});
