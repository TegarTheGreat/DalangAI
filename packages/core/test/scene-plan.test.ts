import { describe, expect, it } from "vitest";
import {
  applyPatch,
  DIMENSIONS,
  migrateScenePlan,
  parseScenePlan,
  safeParseScenePlan,
} from "../src/index";
import { basePlanInput, makePlan } from "./fixtures";

describe("scene-plan schema v0", () => {
  it("parses a minimal plan and applies defaults", () => {
    const plan = makePlan();
    expect(plan.meta.stylePreset).toBe("documentary-01");
    expect(plan.scenes[0]?.locked).toBe(false);
    expect(plan.scenes[0]?.duration).toBe("auto");
    // ADR-0016: caption punya gaya nyata + ukuran + posisi (default netral).
    expect(plan.scenes[0]?.caption).toEqual({
      enabled: true,
      style: "klasik",
      size: "m",
      position: "bottom",
    });
    expect(plan.scenes[0]?.clips[0]?.assetId).toBeNull();
    expect(plan.scenes[0]?.clips[0]?.pinned).toBe(false);
    // ADR-0018/0025: grafis, lapisan, dan efek suara punya lumbung berkasnya
    // sendiri-sendiri.
    expect(plan.renderState).toEqual({
      narrationAudio: {},
      clipAssets: {},
      layerAssets: {},
      trackAssets: {},
      graphicAssets: {},
      sfxAssets: {},
      transcripts: {},
    });
    expect(plan.scenes[0]?.graphics).toEqual([]);
    expect(plan.audio.sfx).toEqual([]);
  });

  it("rejects duplicate scene ids", () => {
    const input = basePlanInput();
    input.scenes[1]!.id = "sc-001";
    const result = safeParseScenePlan(input);
    expect(result.success).toBe(false);
  });

  it("rejects unknown aspect ratios", () => {
    const input = basePlanInput();
    // @ts-expect-error — intentionally invalid
    input.meta.aspectRatio = "4:3";
    expect(safeParseScenePlan(input).success).toBe(false);
  });

  it("rejects unknown top-level fields (strict schema catches typos)", () => {
    const input = { ...basePlanInput(), scnes: [] } as unknown;
    expect(safeParseScenePlan(input).success).toBe(false);
  });

  it("rejects non-normalized annotation targets", () => {
    const input = basePlanInput();
    input.scenes[0]!.annotations = [
      {
        type: "zoom",
        target: { x: 0.5, y: 0.5, w: 1.5, h: 0.2 },
        timing: { startSec: 0 },
      },
    ];
    expect(safeParseScenePlan(input).success).toBe(false);
  });

  it("accepts renderState entries with license metadata", () => {
    const input = basePlanInput();
    input.renderState = {
      narrationAudio: {
        "sc-001": {
          file: "audio/sc-001.mp3",
          durationSec: 4.2,
          wordTimestamps: [{ word: "Borobudur", startSec: 0, endSec: 0.6 }],
        },
      },
      clipAssets: {
        "sc-001-k1": {
          file: "assets/borobudur.jpg",
          kind: "image",
          source: "pexels",
          license: "Pexels License",
          author: "Test Author",
        },
      },
    };
    const plan = parseScenePlan(input);
    expect(plan.renderState.clipAssets["sc-001-k1"]?.license).toBe("Pexels License");
  });

  it("throws a readable error message on invalid plans", () => {
    expect(() => parseScenePlan({ version: 1 })).toThrowError(/Scene-plan tidak valid/);
  });

  it("versi yang lebih baru ditolak dengan sebab yang jelas", () => {
    // Migrasi hanya berjalan MAJU (ADR-0033 §7). Plan dari Dalang yang lebih
    // baru tidak bisa diturunkan, dan menebak-nebak isinya jauh lebih buruk
    // daripada menyuruh orangnya memperbarui.
    expect(() => parseScenePlan({ version: 99 })).toThrowError(
      /lebih baru daripada yang didukung/,
    );
    expect(() => parseScenePlan({ version: "dua" })).toThrowError(/tidak didukung/);
  });

  it("plan versi 1 DIMIGRASIKAN, bukan ditolak (ADR-0033)", () => {
    const v1 = {
      version: 1,
      projectId: "proj-lama",
      meta: { title: "Judul", aspectRatio: "9:16", language: "id" },
      scenes: [
        {
          id: "sc-001",
          narration: "Satu.",
          visual: { type: "stock", query: "candi", motion: "kenburns-in" },
        },
      ],
      renderState: {
        narrationAudio: {},
        resolvedAssets: {
          "sc-001": { file: "assets/a.png", kind: "image", source: "local" },
        },
      },
    };
    const plan = parseScenePlan(v1);

    expect(plan.version).toBe(2);
    // clips[0] ADALAH visual yang lama — isinya utuh, bukan cuma bentuknya.
    expect(plan.scenes[0]?.clips).toHaveLength(1);
    expect(plan.scenes[0]?.clips[0]).toMatchObject({
      id: "sc-001-k1",
      type: "stock",
      query: "candi",
      motion: "kenburns-in",
    });
    // Berkasnya ikut pindah ke kunci KLIP, tidak hilang di tengah jalan.
    expect(plan.renderState.clipAssets["sc-001-k1"]?.file).toBe("assets/a.png");
    expect("resolvedAssets" in plan.renderState).toBe(false);
  });

  it("migrasi DETERMINISTIK: dijalankan dua kali hasilnya sama", () => {
    const v1 = {
      version: 1,
      projectId: "proj-lama",
      meta: { title: "Judul", aspectRatio: "9:16", language: "id" },
      scenes: [{ id: "sc-001", narration: "Satu.", visual: { type: "solid" } }],
      renderState: { narrationAudio: {}, resolvedAssets: {} },
    };
    // Sifat yang paling mudah rusak kalau id klipnya diundi, bukan dihitung:
    // jalan kedua akan memberi id lain dan clipAssets kehilangan jejaknya.
    const sekali = migrateScenePlan(v1);
    const duaKali = migrateScenePlan(migrateScenePlan(v1));
    expect(duaKali).toEqual(sekali);
    expect(parseScenePlan(duaKali)).toEqual(parseScenePlan(v1));
  });

  it("accepts an editor $schema field without leaking it into strictness", () => {
    const input = {
      ...basePlanInput(),
      $schema: "../../packages/core/schema/scene-plan.v2.schema.json",
    };
    const plan = parseScenePlan(input);
    expect(plan.$schema).toContain("scene-plan.v2");
  });

  it("exposes 1080p dimensions per aspect ratio", () => {
    expect(DIMENSIONS["9:16"]).toEqual({ width: 1080, height: 1920 });
    expect(DIMENSIONS["16:9"]).toEqual({ width: 1920, height: 1080 });
    expect(DIMENSIONS["1:1"]).toEqual({ width: 1080, height: 1080 });
  });
});

/**
 * Zona aman platform (ADR-0034) — kontrak skemanya.
 *
 * Sifat yang paling penting dijaga di sini: BAWAANNYA NOL. Fitur tata letak
 * yang menyala sendiri akan menggeser setiap plan yang sudah ada tanpa
 * diminta, termasuk yang dijaga gerbang paritas byte.
 */
describe("meta.safeArea", () => {
  const base = {
    version: 2,
    projectId: "p",
    meta: { title: "T" },
    scenes: [{ id: "sc-1", narration: "Satu.", clips: [{ id: "k1", type: "solid" }] }],
  };

  it("bawaannya nol di keempat sisi", () => {
    const plan = parseScenePlan(base);
    expect(plan.meta.safeArea).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });

  it("sisi yang tidak disebut tetap nol", () => {
    const plan = parseScenePlan({
      ...base,
      meta: { title: "T", safeArea: { bottom: 0.2 } },
    });
    expect(plan.meta.safeArea).toEqual({ top: 0, bottom: 0.2, left: 0, right: 0 });
  });

  it("menolak fraksi di atas 0,4 — dua sisi berhadapan harus menyisakan bidang", () => {
    expect(() =>
      parseScenePlan({ ...base, meta: { title: "T", safeArea: { bottom: 0.5 } } }),
    ).toThrow();
  });

  it("menolak fraksi negatif", () => {
    expect(() =>
      parseScenePlan({ ...base, meta: { title: "T", safeArea: { top: -0.1 } } }),
    ).toThrow();
  });

  it("setMeta mengganti zona aman UTUH, bukan menggabung per sisi", () => {
    // Empat sisi itu SATU keputusan ("video ini untuk platform apa"), jadi
    // undo satu langkah harus mengembalikan keputusan itu utuh — bukan
    // campuran dari dua keputusan berbeda.
    const plan = parseScenePlan({
      ...base,
      meta: { title: "T", safeArea: { top: 0.1, bottom: 0.2, left: 0, right: 0.16 } },
    });
    const { plan: sesudah } = applyPatch(
      plan,
      [{ op: "setMeta", patch: { safeArea: { bottom: 0.05 } } }],
      { origin: "user" },
    );
    expect(sesudah.meta.safeArea).toEqual({ top: 0, bottom: 0.05, left: 0, right: 0 });
  });
});
