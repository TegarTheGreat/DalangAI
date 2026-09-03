import { parseScenePlan } from "@dalang/core";
import { describe, expect, it } from "vitest";
import {
  anchorSpec,
  graphicMotion,
  graphicStyle,
  graphicWindow,
  iconIdOf,
  isIconRef,
} from "../src/graphic-model";
import { computeFrameLayout, FPS } from "../src/layout";
import { placeSfxCues } from "../src/sfx";

/**
 * ADR-0018: penempatan grafis dan waktu efek suara. Semuanya diuji sebagai
 * ANGKA — ini justru bagian yang paling mudah salah dan paling sulit dilihat
 * dengan mata di video jadi.
 */

const graphic = (over: Record<string, unknown> = {}) => ({
  id: "g1",
  ref: "iconify:mdi:home",
  anchor: "kanan-bawah" as const,
  size: 0.12,
  offsetX: 0,
  offsetY: 0,
  rotate: 0,
  opacity: 1,
  color: null,
  anim: "pop" as const,
  // ADR-0027: tanpa track, jadi seluruh gerak di berkas ini tetap datang dari
  // preset `anim` — persis keadaan yang diuji ADR-0018.
  tracks: [],
  startFrac: 0,
  endFrac: 1,
  ...over,
});

/** Bingkai uji: angka margin nyata dari aspectMetrics 16:9 dan 9:16. */
const LANDSCAPE = { width: 1920, height: 1080, marginX: 144, marginTop: 96 };
const PORTRAIT = { width: 1080, height: 1920, marginX: 84, marginTop: 108 };

describe("jangkar grafis", () => {
  const styleAt = (anchor: Parameters<typeof anchorSpec>[0], frame = LANDSCAPE) =>
    graphicStyle(
      graphic({ anchor }),
      graphicMotion(graphic({ anim: "diam" }), 0, 60),
      frame,
    );

  it("sudut menempel dua tepi pada MARGIN AMAN, bukan tepi frame", () => {
    const style = styleAt("kiri-atas");
    expect(style.top).toBe(LANDSCAPE.marginTop);
    expect(style.left).toBe(LANDSCAPE.marginX);
    expect(style.bottom).toBeUndefined();
    expect(style.right).toBeUndefined();
    expect(String(style.translate)).toContain("0px");
  });

  /**
   * Regresi dari render sungguhan: sisipan datar 4,5% menaruh tempelan
   * kiri-atas tepat menimpa running head preset. Margin aman preset jauh lebih
   * dalam, dan itulah yang harus dipakai.
   */
  it("margin aman lebih dalam daripada sisipan datar 4,5% lama", () => {
    expect(LANDSCAPE.marginTop).toBeGreaterThan(0.045 * LANDSCAPE.height);
    expect(LANDSCAPE.marginX).toBeGreaterThan(0.045 * LANDSCAPE.width);
  });

  it("jangkar bawah/kanan memakai bottom/right, bukan top/left", () => {
    const style = styleAt("kanan-bawah");
    expect(style.bottom).toBe(LANDSCAPE.marginTop);
    expect(style.right).toBe(LANDSCAPE.marginX);
    expect(style.top).toBeUndefined();
    expect(style.left).toBeUndefined();
  });

  it("tengah memusatkan dirinya sendiri di kedua sumbu", () => {
    const style = styleAt("tengah");
    expect(style.left).toBe("50%");
    expect(style.top).toBe("50%");
    expect(String(style.translate)).toContain("-50%");
  });

  it("tepi tengah hanya memusatkan pada sumbu yang di tengah", () => {
    const atas = styleAt("tengah-atas");
    expect(atas.left).toBe("50%");
    expect(atas.top).toBe(LANDSCAPE.marginTop);

    const kiri = styleAt("kiri-tengah");
    expect(kiri.left).toBe(LANDSCAPE.marginX);
    expect(kiri.top).toBe("50%");
  });

  it("margin ikut rasio: potret memakai angka amannya sendiri", () => {
    const style = styleAt("kiri-atas", PORTRAIT);
    expect(style.top).toBe(PORTRAIT.marginTop);
    expect(style.left).toBe(PORTRAIT.marginX);
  });

  it("kesembilan jangkar terdefinisi", () => {
    for (const anchor of [
      "kiri-atas",
      "tengah-atas",
      "kanan-atas",
      "kiri-tengah",
      "tengah",
      "kanan-tengah",
      "kiri-bawah",
      "tengah-bawah",
      "kanan-bawah",
    ] as const) {
      expect(anchorSpec(anchor)).toBeDefined();
    }
  });
});

describe("ukuran grafis mengikuti tinggi frame, bukan piksel tetap", () => {
  it("size yang sama menghasilkan tinggi proporsional di rasio berbeda", () => {
    const motion = graphicMotion(graphic({ anim: "diam" }), 0, 60);
    const landscape = graphicStyle(graphic(), motion, LANDSCAPE);
    const portrait = graphicStyle(graphic(), motion, PORTRAIT);
    expect(landscape.height).toBeCloseTo(0.12 * 1080, 3);
    expect(portrait.height).toBeCloseTo(0.12 * 1920, 3);
    // Inilah gunanya: satu nilai tetap benar di dua rasio tanpa ditata ulang.
    expect(landscape.width).toBe(landscape.height);
  });

  it("geseran memakai lebar untuk X dan tinggi untuk Y", () => {
    // SATU grafis untuk motion dan style: sejak ADR-0027 nilai terpakai tiap
    // properti diputuskan di `graphicMotion` (supaya track punya satu tempat
    // untuk menang), jadi memberi keduanya grafis berbeda memang tidak berarti
    // apa-apa — dan komponen sungguhan tidak pernah melakukannya.
    const item = graphic({ anim: "diam", offsetX: 0.1, offsetY: -0.05 });
    const motion = graphicMotion(item, 0, 60);
    const style = graphicStyle(item, motion, LANDSCAPE);
    expect(String(style.translate)).toContain("192px");
    expect(String(style.translate)).toContain("-54px");
  });
});

describe("gerak grafis", () => {
  it('"diam" benar-benar diam dan langsung penuh', () => {
    const at0 = graphicMotion(graphic({ anim: "diam" }), 0, 60);
    const at30 = graphicMotion(graphic({ anim: "diam" }), 30, 60);
    expect(at0).toEqual(at30);
    expect(at0.opacity).toBe(1);
    expect(at0.scale).toBe(1);
  });

  it("pop masuk dari kecil lalu mendarat di sekitar 1", () => {
    const start = graphicMotion(graphic({ anim: "pop" }), 0, 60);
    const settled = graphicMotion(graphic({ anim: "pop" }), 40, 60);
    expect(start.scale).toBeLessThan(0.8);
    expect(settled.scale).toBeCloseTo(1, 1);
  });

  it("semua animasi memudar masuk, bukan muncul tiba-tiba", () => {
    for (const anim of ["pop", "apung", "putar", "denyut"] as const) {
      const at0 = graphicMotion(graphic({ anim }), 0, 60);
      const later = graphicMotion(graphic({ anim }), 30, 60);
      expect(at0.opacity).toBeLessThan(later.opacity);
    }
  });

  it("putar terus berputar; apung naik-turun; denyut berdenyut", () => {
    const spin = graphicMotion(graphic({ anim: "putar" }), 60, 120);
    expect(spin.rotate).toBeGreaterThan(0);

    const floatA = graphicMotion(graphic({ anim: "apung" }), 10, 120);
    const floatB = graphicMotion(graphic({ anim: "apung" }), 45, 120);
    expect(floatA.liftFrac).not.toBe(floatB.liftFrac);

    const pulseA = graphicMotion(graphic({ anim: "denyut" }), 10, 120);
    const pulseB = graphicMotion(graphic({ anim: "denyut" }), 35, 120);
    expect(pulseA.scale).not.toBe(pulseB.scale);
  });

  it("opacity grafis dihormati sebagai batas atas", () => {
    const motion = graphicMotion(graphic({ anim: "diam", opacity: 0.4 }), 30, 60);
    expect(motion.opacity).toBe(0.4);
  });

  it("keluaran dibulatkan supaya render stabil antar jalan", () => {
    const a = graphicMotion(graphic({ anim: "denyut" }), 17, 90);
    const b = graphicMotion(graphic({ anim: "denyut" }), 17, 90);
    expect(a).toEqual(b);
    expect(String(a.scale).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(4);
  });
});

describe("jendela tampil grafis", () => {
  it("fraksi diterjemahkan ke frame, minimal satu frame", () => {
    expect(graphicWindow(graphic({ startFrac: 0.25, endFrac: 0.75 }), 200)).toEqual({
      from: 50,
      frames: 100,
    });
    // Jendela nol tidak boleh membuat Sequence tak sah.
    expect(graphicWindow(graphic({ startFrac: 0.5, endFrac: 0.5 }), 200).frames).toBe(1);
  });
});

describe("rujukan ikon", () => {
  it("membedakan ikon dari aset gambar", () => {
    expect(isIconRef("iconify:mdi:home")).toBe(true);
    expect(isIconRef("giphy:abc123")).toBe(false);
    expect(iconIdOf("iconify:mdi:home")).toBe("mdi:home");
    expect(iconIdOf("giphy:abc123")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Efek suara
// ---------------------------------------------------------------------------

const planWithSfx = (sfx: unknown[], assets: Record<string, unknown> = {}) =>
  parseScenePlan({
    version: 2,
    projectId: "uji-sfx",
    meta: { title: "Uji SFX" },
    audio: { sfx },
    scenes: [
      {
        id: "a",
        narration: "Satu.",
        clips: [{ id: "a-k1", type: "solid" }],
        duration: 4,
      },
      { id: "b", narration: "Dua.", clips: [{ id: "b-k1", type: "solid" }], duration: 4 },
      {
        id: "c",
        narration: "Tiga.",
        clips: [{ id: "c-k1", type: "solid" }],
        duration: 4,
      },
    ],
    renderState: {
      narrationAudio: {},
      clipAssets: {},
      graphicAssets: {},
      sfxAssets: assets,
    },
  });

const sfxAsset = (file: string) => ({ file, kind: "audio" as const, source: "pustaka" });

describe("penempatan efek suara", () => {
  it("cue diletakkan relatif terhadap awal scene-nya", () => {
    const plan = planWithSfx(
      [{ id: "s1", assetId: "pustaka:whoosh", sceneId: "b", atSec: 1, volume: 0.5 }],
      { s1: sfxAsset("sfx/whoosh.wav") },
    );
    const layout = computeFrameLayout(plan);
    const [placed] = placeSfxCues(plan, layout, FPS);
    expect(placed?.fromFrame).toBe((layout.sceneStarts[1] ?? 0) + FPS);
    expect(placed?.volume).toBe(0.5);
    expect(placed?.file).toBe("sfx/whoosh.wav");
  });

  it("cue ikut bergeser saat scene sebelumnya memanjang", () => {
    const short = planWithSfx(
      [{ id: "s1", assetId: "pustaka:whoosh", sceneId: "c", atSec: 0 }],
      { s1: sfxAsset("sfx/whoosh.wav") },
    );
    const long = parseScenePlan({
      ...JSON.parse(JSON.stringify(short)),
      scenes: short.scenes.map((scene) =>
        scene.id === "a" ? { ...scene, duration: 12 } : scene,
      ),
    });
    const before = placeSfxCues(short, computeFrameLayout(short), FPS)[0]?.fromFrame ?? 0;
    const after = placeSfxCues(long, computeFrameLayout(long), FPS)[0]?.fromFrame ?? 0;
    // Inti kontraknya: tidak ada angka yang perlu disunting ulang.
    expect(after).toBeGreaterThan(before);
  });

  it("cue yatim (scene sudah dihapus) dilewati, bukan menggagalkan render", () => {
    const plan = planWithSfx(
      [{ id: "s1", assetId: "pustaka:whoosh", sceneId: "sudah-hilang", atSec: 0 }],
      { s1: sfxAsset("sfx/whoosh.wav") },
    );
    expect(placeSfxCues(plan, computeFrameLayout(plan), FPS)).toEqual([]);
  });

  it("cue tanpa berkas ter-resolve dilewati", () => {
    const plan = planWithSfx([
      { id: "s1", assetId: "pustaka:whoosh", sceneId: "a", atSec: 0 },
    ]);
    expect(placeSfxCues(plan, computeFrameLayout(plan), FPS)).toEqual([]);
  });

  it("banyak cue di scene sama tetap terurut sesuai waktunya", () => {
    const plan = planWithSfx(
      [
        { id: "s2", assetId: "pustaka:b", sceneId: "a", atSec: 2 },
        { id: "s1", assetId: "pustaka:a", sceneId: "a", atSec: 0.5 },
      ],
      { s1: sfxAsset("sfx/a.wav"), s2: sfxAsset("sfx/b.wav") },
    );
    const placed = placeSfxCues(plan, computeFrameLayout(plan), FPS);
    expect(placed).toHaveLength(2);
    const byId = new Map(placed.map((cue) => [cue.cueId, cue.fromFrame]));
    expect(byId.get("s1")).toBeLessThan(byId.get("s2") as number);
  });
});
