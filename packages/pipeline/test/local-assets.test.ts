import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseScenePlan } from "@dalang/core";
import { Jimp } from "jimp";
import { afterEach, describe, expect, it } from "vitest";
import { runAssetStage } from "../src/asset-stage";
import { PipelineDb } from "../src/db";
import { imageDims } from "../src/image-dims";
import { projectPaths } from "../src/project-paths";

/** Ingest aset LOKAL (Fase 4 §9): screenshot/image dengan assetId path relatif. */

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup) fn();
  cleanup = [];
});

const makeProject = async () => {
  const dir = mkdtempSync(join(tmpdir(), "dalang-local-assets-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "assets"), { recursive: true });
  const png = await new Jimp({ width: 64, height: 36, color: 0x334455ff }).getBuffer(
    "image/png",
  );
  writeFileSync(join(dir, "assets/shot.png"), png);
  const paths = projectPaths(join(dir, "plan.json"));
  const db = new PipelineDb(":memory:");
  cleanup.push(() => db.close());
  return { dir, paths, db };
};

const planWith = (scenes: unknown[]) =>
  parseScenePlan({
    version: 1,
    projectId: "uji-lokal",
    meta: { title: "Uji" },
    scenes,
  } as never);

describe("runAssetStage — ingest aset lokal", () => {
  it("screenshot dengan assetId valid ter-resolve sebagai source local + dimensi terbaca", async () => {
    const { paths, db } = await makeProject();
    const plan = planWith([
      {
        id: "sc-shot",
        narration: "Langkah satu.",
        visual: { type: "screenshot", assetId: "assets/shot.png" },
      },
    ]);
    const { plan: next, results } = await runAssetStage({
      paths,
      plan,
      providers: [],
      db,
    });
    expect(results).toEqual([
      expect.objectContaining({ sceneId: "sc-shot", status: "done" }),
    ]);
    const asset = next.renderState.resolvedAssets["sc-shot"];
    expect(asset).toMatchObject({
      file: "assets/shot.png",
      kind: "image",
      source: "local",
      width: 64,
      height: 36,
    });
    // Idempoten: jalankan lagi -> cached, bukan ditulis ulang.
    const second = await runAssetStage({ paths, plan: next, providers: [], db });
    expect(second.results[0]?.status).toBe("cached");
  });

  it("assetId kosong / file hilang / path keluar proyek -> error jelas per scene", async () => {
    const { paths, db } = await makeProject();
    const plan = planWith([
      { id: "sc-a", narration: "x", visual: { type: "screenshot" } },
      {
        id: "sc-b",
        narration: "x",
        visual: { type: "image", assetId: "assets/tidak-ada.png" },
      },
      {
        id: "sc-c",
        narration: "x",
        visual: { type: "screenshot", assetId: "../keluar.png" },
      },
    ]);
    const { results } = await runAssetStage({ paths, plan, providers: [], db });
    const byId = Object.fromEntries(results.map((r) => [r.sceneId, r]));
    expect(byId["sc-a"]?.status).toBe("error");
    expect(byId["sc-a"]?.detail).toContain("assetId kosong");
    expect(byId["sc-b"]?.status).toBe("error");
    expect(byId["sc-b"]?.detail).toContain("tidak ditemukan");
    expect(byId["sc-c"]?.status).toBe("error");
    expect(byId["sc-c"]?.detail).toContain("relatif");
  });
});

describe("imageDims", () => {
  it("membaca dimensi PNG dan JPEG dari header; byte asing -> null", async () => {
    const png = await new Jimp({ width: 120, height: 45, color: 0xffffffff }).getBuffer(
      "image/png",
    );
    expect(imageDims(new Uint8Array(png))).toEqual({ width: 120, height: 45 });
    const jpeg = await new Jimp({ width: 33, height: 22, color: 0xff0000ff }).getBuffer(
      "image/jpeg",
    );
    expect(imageDims(new Uint8Array(jpeg))).toEqual({ width: 33, height: 22 });
    expect(imageDims(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});
