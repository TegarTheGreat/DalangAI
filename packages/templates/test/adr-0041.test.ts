import { parseScenePlan, type ScenePlanInput } from "@dalang/core";
import { describe, expect, it } from "vitest";
import {
  EFFECT_EPSILON,
  filterToCss,
  grainCss,
  hasOverlayEffect,
  vignetteCss,
} from "../src/filters";
import { FONT_CHOICES } from "../src/fonts";
import { motionTransform } from "../src/motion-model";
import { SITE_ASSET_DIRS } from "../src/paths";
import { BUNDLED_SFX, resolveSfxFile, SFX_LIBRARY_PREFIX } from "../src/sfx";
import { presentationFor } from "../src/transitions";
import { animPieceStyle, captionStyleSpec } from "../src/type-style";

/**
 * Pengayaan (ADR-0041).
 *
 * Yang dijaga di sini bukan seleranya — apakah `senja` cukup jingga tidak bisa
 * diuji sebagai angka — melainkan hal-hal yang salahnya MENGGAGALKAN render
 * atau menggeser plan lama: pustaka bunyi yang berkasnya tidak ada, efek yang
 * menyala padahal nilainya nol, dan gerak baru yang diam-diam mengubah gerak
 * lama.
 */

const palette = {
  ink: "#fff",
  inkSoft: "#aaa",
  accent: "#e8a33d",
  onAccent: "#111",
  plate: "rgba(10, 11, 16, 0.8)",
};

describe("pustaka efek suara bawaan", () => {
  it("tiap entri menunjuk berkas yang BENAR-BENAR ada di public/sfx", async () => {
    // Pustaka yang menunjuk berkas hilang lolos setiap tes bentuk, lalu
    // menggagalkan render dengan pesan "file not found".
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { templatesPublicDir } = await import("../src/paths");
    for (const sound of BUNDLED_SFX) {
      expect(existsSync(join(templatesPublicDir, sound.file))).toBe(true);
    }
  });

  it("folder sfx terdaftar sebagai aset SITUS — kalau tidak, preview 404", () => {
    expect((SITE_ASSET_DIRS as readonly string[]).includes("sfx")).toBe(true);
  });

  it("id pustaka menghasilkan berkas ter-bundle; id asing tidak", () => {
    const whoosh = resolveSfxFile(`${SFX_LIBRARY_PREFIX}whoosh`);
    expect(whoosh).toMatchObject({ file: "sfx/whoosh.wav", bundled: true });
    expect(resolveSfxFile(`${SFX_LIBRARY_PREFIX}tidak-ada`)).toBeNull();
    // Bukan id pustaka sama sekali: null, supaya pemanggil jatuh ke jalur
    // aset plan alih-alih mengira ia bunyi bawaan.
    expect(resolveSfxFile("openverse:abc")).toBeNull();
  });

  it("LUFS hanya ada untuk bunyi yang cukup panjang diukur", () => {
    // Kenyaringan TERINTEGRASI tidak punya arti di bawah satu blok 400 ms;
    // angka yang dipaksa keluar dari sana akan dipakai seolah-olah berarti.
    for (const sound of BUNDLED_SFX) {
      if (sound.durationSec < 0.4) expect(sound.lufs).toBeUndefined();
      else expect(typeof sound.lufs).toBe("number");
    }
  });
});

describe("efek lapisan: vignette dan butiran", () => {
  const filterOf = (over: Partial<Record<string, number>> = {}) =>
    parseScenePlan({
      version: 2,
      projectId: "p",
      meta: { title: "T" },
      audio: {},
      scenes: [
        {
          id: "a",
          narration: "x",
          clips: [{ id: "a1", type: "solid", filter: { preset: "none", ...over } }],
        },
      ],
    } as ScenePlanInput).scenes[0]?.clips[0]?.filter;

  it("nol berarti TIDAK ada lapisan sama sekali", () => {
    // Plan lama tidak boleh membayar satu lapisan pun — itu yang menjaga
    // gerbang paritas byte tetap hijau.
    expect(hasOverlayEffect(filterOf())).toBe(false);
    expect(hasOverlayEffect(undefined)).toBe(false);
  });

  it("sisa nilai di bawah ambang juga dianggap mati", () => {
    expect(hasOverlayEffect(filterOf({ vignette: EFFECT_EPSILON / 2 }))).toBe(false);
    expect(hasOverlayEffect(filterOf({ vignette: EFFECT_EPSILON }))).toBe(true);
  });

  it("vignette menggelapkan TEPI, dan kekuatannya naik bersama nilainya", () => {
    const lemah = vignetteCss(0.2).background ?? "";
    const kuat = vignetteCss(0.9).background ?? "";
    expect(lemah).toContain("radial-gradient");
    const angka = (css: string) =>
      Number(
        css
          .match(/rgba\(0,0,0,([\d.]+)\)/g)
          ?.pop()
          ?.match(/([\d.]+)\)/)?.[1],
      );
    expect(angka(kuat)).toBeGreaterThan(angka(lemah));
  });

  it("butiran memakai seed TETAP — pola yang berubah tiap bingkai bukan film, itu kompresi rusak", () => {
    const a = grainCss(0.5).backgroundImage ?? "";
    const b = grainCss(0.5).backgroundImage ?? "";
    expect(a).toBe(b);
    expect(decodeURIComponent(a)).toContain("seed='7'");
    expect(grainCss(0.8).opacity).not.toBe(grainCss(0.2).opacity);
  });

  it("tiap preset warna baru menghasilkan rantai filter yang BERBEDA", () => {
    // Preset yang tidak terdaftar di PRESET_CSS menghasilkan string kosong dan
    // terlihat persis seperti "none" — cacat yang tidak menggagalkan apa pun.
    const dasar = filterOf();
    if (!dasar) throw new Error("filter tidak terurai");
    const terlihat = new Map<string, string>();
    for (const preset of ["noir", "senja", "malam", "pudar", "pastel"] as const) {
      const css = filterToCss({ ...dasar, preset }).filter ?? "";
      expect(css).not.toBe("");
      terlihat.set(preset, css);
    }
    expect(new Set(terlihat.values()).size).toBe(5);
    // Dan tidak satu pun sama dengan preset lama.
    const lama = filterToCss({ ...dasar, preset: "mono" }).filter ?? "";
    expect([...terlihat.values()]).not.toContain(lama);
  });
});

describe("transisi baru", () => {
  it("tiap tipe punya presentation — tipe tanpa peta akan undefined saat render", () => {
    for (const type of ["clock-wipe", "flip-left", "flip-up"] as const) {
      const presentation = presentationFor(type, { width: 1080, height: 1920 });
      expect(presentation).toBeTruthy();
      expect(typeof presentation.component).toBe("function");
    }
  });

  it("clock-wipe MEMAKAI ukuran bingkai yang diberikan", () => {
    // Kalau ukurannya diabaikan, sapuannya akan berjari-jari salah di 16:9.
    const a = presentationFor("clock-wipe", { width: 1080, height: 1920 });
    const b = presentationFor("clock-wipe", { width: 1920, height: 1080 });
    expect(a.props).not.toEqual(b.props);
  });
});

describe("gerak baru", () => {
  const clip = (motion: string) =>
    ({ motion, flipH: false, focusX: 0.5, focusY: 0.5 }) as never;

  it("punch-in BERHENTI sesudah hentakannya — diam itu penekanannya", () => {
    const tengah = motionTransform(clip("punch-in"), 0.5);
    const akhir = motionTransform(clip("punch-in"), 1);
    expect(tengah.scale).toBe(akhir.scale);
    expect(Number(akhir.scale)).toBeGreaterThan(1.1);
  });

  it("tilt memutar, dan hanya tilt yang memutar", () => {
    expect(motionTransform(clip("tilt"), 0.9).rotate).toBeDefined();
    for (const motion of ["none", "kenburns-in", "pan-left", "drift", "pan-diagonal"]) {
      expect(motionTransform(clip(motion), 0.5).rotate).toBeUndefined();
    }
  });

  it("gerak LAMA tidak bergeser satu angka pun", () => {
    // Kalau bergeser, setiap plan yang sudah ada ikut bergeser — dan gerbang
    // paritas byte yang menangkapnya, jauh sesudah kerusakannya dibuat.
    expect(motionTransform(clip("kenburns-in"), 0.5).scale).toBe("1.08");
    // Progress 0,25 — bukan 0,5, yang kebetulan nol untuk semua pan dan
    // karena itu tidak membuktikan apa pun.
    expect(motionTransform(clip("pan-left"), 0.25).translate).toBe("1.1% 0%");
    expect(motionTransform(clip("pan-up"), 0.75).translate).toBe("0% -1.1%");
  });
});

describe("gaya caption dan animasi teks baru", () => {
  it("pita memberi LATAR pada barisnya, bukan pada kata aktif saja", () => {
    const spec = captionStyleSpec("pita", palette);
    expect(spec.block.background).toBe(palette.plate);
    expect(spec.block.display).toBe("inline");
  });

  it("karaoke menyisakan JEJAK: kata yang lewat tetap beraksen", () => {
    const spec = captionStyleSpec("karaoke", palette);
    expect(spec.token("past").color).toBe(palette.accent);
    expect(spec.token("future").color).toBe(palette.inkSoft);
  });

  it("blur-in benar-benar tajam di akhir, bukan menyisakan kabur", () => {
    const akhir = animPieceStyle("blur-in", 0, 999);
    expect(akhir?.filter).toBe("none");
    const awal = animPieceStyle("blur-in", 0, 1);
    expect(String(awal?.filter)).toContain("blur(");
  });

  it("slide-in bergeser mendatar lalu berhenti di nol", () => {
    expect(animPieceStyle("slide-in", 0, 999)?.translate).toBe("0.000em 0");
    expect(animPieceStyle("slide-in", 0, 0)?.translate).not.toBe("0.000em 0");
  });
});

describe("font ter-bundle", () => {
  it("tiap keluarga menunjuk berkas yang ada", async () => {
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { templatesPublicDir } = await import("../src/paths");
    expect(FONT_CHOICES.length).toBe(9);
    for (const choice of FONT_CHOICES) {
      expect(existsSync(join(templatesPublicDir, choice.file))).toBe(true);
    }
  });
});
