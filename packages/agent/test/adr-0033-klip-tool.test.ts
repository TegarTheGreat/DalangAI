import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type ScenePlan,
  type ScenePlanInput,
  setClipAsset,
  setTranscript,
  type Transcript,
} from "@dalang/core";
import { afterEach, describe, expect, it } from "vitest";
import { buildAgentTools } from "../src/index";
import { basicPlan, execOptions, makeDeps, tempProject } from "./helpers";

/**
 * Tool rekaman terhadap scene BERKLIP BANYAK (ADR-0033).
 *
 * Sebelum berkas ini ada, semuanya membaca klip pertama diam-diam, dan
 * cutByWords bahkan selalu GAGAL di scene berklip banyak — ia menulis angka ke
 * `scene.duration`, yang ditolak skema (§2). Yang paling menyakitkan: scene
 * berklip banyak justru lahir dari memotong rekaman panjang, yaitu satu-satunya
 * tempat tool-tool ini benar-benar dipakai.
 */

let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups) fn();
  cleanups = [];
});

type AnyTool = { execute: (input: unknown, options: unknown) => Promise<unknown> };
const exec = (tools: Record<string, unknown>, name: string, input: unknown) =>
  (tools[name] as AnyTool).execute(input, execOptions) as Promise<
    Record<string, unknown>
  >;

const TRANSCRIPT: Transcript = {
  source: "uji",
  language: "id",
  durationSec: 90,
  words: [
    { word: "Bagian", startSec: 30, endSec: 30.4 },
    { word: "yang", startSec: 30.5, endSec: 30.7 },
    { word: "paling", startSec: 30.8, endSec: 31.2 },
    { word: "penting", startSec: 31.3, endSec: 31.9 },
  ],
  segments: [],
};

const MULTI: ScenePlanInput = basicPlan({
  scenes: [
    {
      id: "sc-wawancara",
      narration: "Satu gagasan, tiga potongan dari wawancara yang sama.",
      duration: "auto",
      clips: [
        { id: "k1", type: "stock", durationSec: 4, trimStartSec: 0 },
        { id: "k2", type: "stock", durationSec: 3, trimStartSec: 12 },
        { id: "k3", type: "stock", durationSec: 5, trimStartSec: 40 },
      ],
    },
  ],
});

/** Proyek berklip tiga; rekaman betul-betul ditulis ke disk untuk klip kedua. */
const withMultiClip = (options: { transcript?: boolean } = {}) => {
  const project = tempProject(MULTI);
  cleanups.push(project.cleanup);
  const file = "media/wawancara.mp4";
  const abs = join(project.session.paths.planDir, file);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, "isi-rekaman-palsu");

  let plan = setClipAsset(project.session.plan as ScenePlan, "k2", {
    file,
    kind: "video",
    source: "local",
    durationSec: 90,
  });
  if (options.transcript !== false) plan = setTranscript(plan, file, TRANSCRIPT);
  project.session.plan = plan;
  return project;
};

describe("ADR-0033 · cutByWords di scene berklip banyak", () => {
  it("memotong KLIP yang disebut dan membiarkan durasi scene tetap auto", async () => {
    const { session } = withMultiClip();
    const tools = buildAgentTools(session, makeDeps({}).deps);
    const hasil = await exec(tools, "cutByWords", {
      sceneId: "sc-wawancara",
      clipId: "k2",
      dariDetik: 30,
      sampaiDetik: 31.9,
    });
    expect(hasil.ok).toBe(true);
    expect(hasil.klip).toBe("k2");
    expect(hasil.durasiKlipDetik).toBeCloseTo(1.9, 3);
    // Kunci perbaikannya: tidak ada angka yang mendarat di scene.duration.
    expect(hasil.durasiSceneDetik).toBeUndefined();

    const scene = session.plan?.scenes.find((item) => item.id === "sc-wawancara");
    expect(scene?.duration).toBe("auto");
    expect(scene?.clips[1]?.trimStartSec).toBe(30);
    expect(scene?.clips[1]?.durationSec).toBeCloseTo(1.9, 3);
    // Potongan tetangga tidak ikut tersentuh; yang bergeser cuma posisinya.
    expect(scene?.clips[0]?.durationSec).toBe(4);
    expect(scene?.clips[2]?.durationSec).toBe(5);
    expect(String(hasil.teksTerpakai)).toContain("paling penting");
  });

  it("undo mengembalikan titik masuk DAN panjang potongan itu", async () => {
    const { session } = withMultiClip();
    const tools = buildAgentTools(session, makeDeps({}).deps);
    await exec(tools, "cutByWords", {
      sceneId: "sc-wawancara",
      clipId: "k2",
      dariDetik: 30,
      sampaiDetik: 31.9,
    });
    // Dipastikan potongannya BENAR-BENAR berubah dulu; undo yang membatalkan
    // sesuatu yang tidak pernah terjadi selalu terlihat berhasil.
    const sesudah = session.plan?.scenes.find((item) => item.id === "sc-wawancara");
    expect(sesudah?.clips[1]?.trimStartSec).toBe(30);
    expect(sesudah?.clips[1]?.durationSec).toBeCloseTo(1.9, 3);

    session.undo();
    const scene = session.plan?.scenes.find((item) => item.id === "sc-wawancara");
    expect(scene?.clips[1]?.trimStartSec).toBe(12);
    expect(scene?.clips[1]?.durationSec).toBe(3);
  });

  it("tanpa clipId yang disasar potongan pertama, tetap sebagai durasi KLIP", async () => {
    const { session } = withMultiClip();
    const tools = buildAgentTools(session, makeDeps({}).deps);
    const hasil = await exec(tools, "cutByWords", {
      sceneId: "sc-wawancara",
      dariDetik: 2,
      sampaiDetik: 4.5,
    });
    expect(hasil.ok).toBe(true);
    expect(hasil.klip).toBe("k1");
    const scene = session.plan?.scenes.find((item) => item.id === "sc-wawancara");
    expect(scene?.duration).toBe("auto");
    expect(scene?.clips[0]?.durationSec).toBeCloseTo(2.5, 3);
  });

  it("klip yang tidak ada ditolak dengan daftar potongan yang ada", async () => {
    const { session } = withMultiClip();
    const tools = buildAgentTools(session, makeDeps({}).deps);
    const hasil = await exec(tools, "cutByWords", {
      sceneId: "sc-wawancara",
      clipId: "k-hantu",
      dariDetik: 1,
      sampaiDetik: 2,
    });
    expect(hasil.ok).toBe(false);
    expect(String(hasil.error)).toContain("k-hantu");
    expect(String(hasil.error)).toContain("k1, k2, k3");
  });
});

describe("ADR-0033 · getTranscript & findMoments per potongan", () => {
  it("membaca transkrip milik KLIP yang disebut, bukan klip pertama", async () => {
    const { session } = withMultiClip();
    const tools = buildAgentTools(session, makeDeps({}).deps);

    // Klip pertama tidak punya rekaman sama sekali: kalau tool ini masih
    // membaca klip pertama diam-diam, yang keluar adalah "belum punya
    // transkrip" — jawaban yang salah tentang potongan yang benar.
    const tanpaKlip = await exec(tools, "getTranscript", { sceneId: "sc-wawancara" });
    expect(tanpaKlip.ok).toBe(false);
    expect(String(tanpaKlip.error)).toContain("k1");

    const hasil = await exec(tools, "getTranscript", {
      sceneId: "sc-wawancara",
      clipId: "k2",
    });
    expect(hasil.ok).toBe(true);
    expect(hasil.klip).toBe("k2");
    expect(hasil.file).toBe("media/wawancara.mp4");
  });

  it("findMoments mencari di transkrip potongan yang disebut", async () => {
    const { session } = withMultiClip();
    const tools = buildAgentTools(session, makeDeps({}).deps);
    const hasil = await exec(tools, "findMoments", {
      sceneId: "sc-wawancara",
      clipId: "k2",
      frasa: "paling penting",
    });
    expect(hasil.ok).toBe(true);
    expect(hasil.jumlah).toBe(1);
  });
});
