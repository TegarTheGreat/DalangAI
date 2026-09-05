import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Jimp } from "jimp";
import { describe, expect, it } from "vitest";
import { buildAgentTools } from "../src/tools";
import { cropImage, parseBbox, parseVerification } from "../src/vision/grounding";
import {
  basicPlan,
  execOptions,
  makeDeps,
  resolvedScripted,
  tempProject,
  textStep,
} from "./helpers";

describe("parseBbox", () => {
  it("menerima JSON murni dan JSON di tengah prosa", () => {
    expect(parseBbox('{"x":0.1,"y":0.2,"w":0.3,"h":0.05}')).toEqual({
      x: 0.1,
      y: 0.2,
      w: 0.3,
      h: 0.05,
    });
    expect(
      parseBbox('Elemen ditemukan di {"x":0.5,"y":0.5,"w":0.1,"h":0.1} pada gambar.'),
    ).toEqual({ x: 0.5, y: 0.5, w: 0.1, h: 0.1 });
  });

  it("menormalkan nilai persen dan mengklem ke dalam gambar", () => {
    expect(parseBbox('{"x":50,"y":25,"w":20,"h":10}')).toEqual({
      x: 0.5,
      y: 0.25,
      w: 0.2,
      h: 0.1,
    });
    const clamped = parseBbox('{"x":0.9,"y":0.9,"w":0.5,"h":0.5}');
    expect(clamped).toEqual({
      x: 0.9,
      y: 0.9,
      w: expect.closeTo(0.1, 6),
      h: expect.closeTo(0.1, 6),
    });
  });

  it("menolak jawaban tanpa rect yang masuk akal", () => {
    expect(parseBbox("tidak ketemu")).toBeNull();
    expect(parseBbox('{"x":0.1,"y":0.2}')).toBeNull();
    expect(parseBbox('{"x":0.1,"y":0.2,"w":0,"h":0.3}')).toBeNull();
  });
});

describe("cropImage", () => {
  it("meng-crop rect ternormalisasi (plus padding) menjadi PNG valid", async () => {
    const image = new Jimp({ width: 200, height: 100, color: 0x224466ff });
    const bytes = new Uint8Array(await image.getBuffer("image/png"));
    const crop = await cropImage(bytes, { x: 0.25, y: 0.2, w: 0.5, h: 0.4 });
    // 0.5*200=100 + padding 2% dua sisi (8px) = ~108; tinggi 40 + 4 = ~44.
    expect(crop.width).toBeGreaterThanOrEqual(100);
    expect(crop.width).toBeLessThanOrEqual(112);
    expect(crop.height).toBeGreaterThanOrEqual(40);
    expect(crop.height).toBeLessThanOrEqual(48);
    const roundtrip = await Jimp.fromBuffer(Buffer.from(crop.png));
    expect(roundtrip.width).toBe(crop.width);
  });
});

describe("parseVerification", () => {
  it("YA/ya diterima; selain itu ditolak", () => {
    expect(parseVerification("YA")).toBe(true);
    expect(parseVerification("  ya, benar")).toBe(true);
    expect(parseVerification("TIDAK")).toBe(false);
    expect(parseVerification("mungkin")).toBe(false);
  });
});

describe("locateUiElement (alur grounding §9, model terskrip)", () => {
  const setupScreenshotProject = async () => {
    const plan = basicPlan();
    plan.scenes[0] = {
      id: "sc-001",
      narration: "Klik tombol Ekspor.",
      clips: [{ id: "sc-001-k1", type: "screenshot", assetId: "assets/shot.png" }],
    };
    const project = tempProject(plan);
    mkdirSync(join(project.dir, "assets"), { recursive: true });
    const image = new Jimp({ width: 320, height: 180, color: 0x101318ff });
    writeFileSync(
      join(project.dir, "assets/shot.png"),
      await image.getBuffer("image/png"),
    );
    // Materialkan clipAssets seperti hasil stage assets (ingest lokal).
    const withAsset = structuredClone(project.session.plan!);
    withAsset.renderState.clipAssets["sc-001-k1"] = {
      file: "assets/shot.png",
      kind: "image",
      source: "local",
      license: "uji",
      width: 320,
      height: 180,
    };
    writeFileSync(project.planPath, JSON.stringify(withAsset, null, 2));
    project.session.detectExternalEdit();
    return project;
  };

  it("bbox valid + verifikasi YA → target terverifikasi", async () => {
    const project = await setupScreenshotProject();
    try {
      const { deps } = makeDeps({});
      deps.volumeModel = resolvedScripted([
        textStep('{"x":0.7,"y":0.05,"w":0.2,"h":0.08}'),
        textStep("YA"),
      ]);
      const tools = buildAgentTools(project.session, deps);
      const output = (await tools.locateUiElement!.execute!(
        { sceneId: "sc-001", description: "tombol Ekspor amber di kanan atas" },
        execOptions,
      )) as { ok: boolean; target: unknown; verified: boolean };
      expect(output.ok).toBe(true);
      expect(output.verified).toBe(true);
      expect(output.target).toEqual({ x: 0.7, y: 0.05, w: 0.2, h: 0.08 });
    } finally {
      project.cleanup();
    }
  });

  it("verifikasi TIDAK → verified false + catatan koreksi (bukan error)", async () => {
    const project = await setupScreenshotProject();
    try {
      const { deps } = makeDeps({});
      deps.volumeModel = resolvedScripted([
        textStep('{"x":0.1,"y":0.1,"w":0.2,"h":0.2}'),
        textStep("TIDAK, itu logo."),
      ]);
      const tools = buildAgentTools(project.session, deps);
      const output = (await tools.locateUiElement!.execute!(
        { sceneId: "sc-001", description: "tombol Ekspor" },
        execOptions,
      )) as { ok: boolean; verified: boolean; catatan: string };
      expect(output.ok).toBe(true);
      expect(output.verified).toBe(false);
      expect(output.catatan).toContain("MENOLAK");
    } finally {
      project.cleanup();
    }
  });

  it("jawaban tanpa bbox → ok:false lewat wrapper (loop tetap hidup)", async () => {
    const project = await setupScreenshotProject();
    try {
      const { deps } = makeDeps({});
      deps.volumeModel = resolvedScripted([textStep("maaf, tidak ketemu")]);
      const tools = buildAgentTools(project.session, deps);
      const output = (await tools.locateUiElement!.execute!(
        { sceneId: "sc-001", description: "tombol Ekspor" },
        execOptions,
      )) as { ok: boolean; error: string };
      expect(output.ok).toBe(false);
      expect(output.error).toContain("bounding box");
    } finally {
      project.cleanup();
    }
  });
});
