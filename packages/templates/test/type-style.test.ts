import { parseScenePlan } from "@dalang/core";
import { describe, expect, it } from "vitest";
import {
  animPieceStyle,
  captionStyleOf,
  captionStyleSpec,
  splitForAnim,
  strokeShadow,
  textLookStyle,
} from "../src/type-style";

const palette = {
  ink: "#fff",
  inkSoft: "#aaa",
  accent: "#e4a64c",
  onAccent: "#111",
};

const sceneWithCaptionStyle = (style: string) =>
  parseScenePlan({
    version: 1,
    projectId: "p",
    meta: { title: "T" },
    scenes: [
      {
        id: "a",
        narration: "x",
        visual: { type: "solid" },
        duration: 3,
        caption: { style },
      },
    ],
  }).scenes[0] as never;

describe("captionStyleOf", () => {
  it("gaya dikenal dipakai; 'inherit' (plan lama) & nilai asing jatuh ke klasik", () => {
    expect(captionStyleOf(sceneWithCaptionStyle("tegas"))).toBe("tegas");
    expect(captionStyleOf(sceneWithCaptionStyle("chip"))).toBe("chip");
    expect(captionStyleOf(sceneWithCaptionStyle("inherit"))).toBe("klasik");
    expect(captionStyleOf(sceneWithCaptionStyle("entah-apa"))).toBe("klasik");
  });
});

describe("captionStyleSpec", () => {
  it("klasik: kata aktif beraksen, lampau terang, mendatang redup", () => {
    const spec = captionStyleSpec("klasik", palette);
    expect(spec.token("active").color).toBe(palette.accent);
    expect(spec.token("past").color).toBe(palette.ink);
    expect(spec.token("future").color).toBe(palette.inkSoft);
    expect(spec.sizeFactor).toBe(1);
  });

  it("tegas: kapital, tebal, ber-garis-luar, kata aktif membesar", () => {
    const spec = captionStyleSpec("tegas", palette);
    expect(spec.block.textTransform).toBe("uppercase");
    expect(spec.block.fontWeight).toBe(900);
    expect(String(spec.block.textShadow)).toContain("4px");
    expect(spec.token("active").scale).toBe("1.09");
    expect(spec.token("past").scale).toBe("1");
    expect(spec.sizeFactor).toBeGreaterThan(1);
    // inline-block mengempiskan spasi tepi — token membawa spasinya sendiri.
    expect(spec.token("active").whiteSpace).toBe("pre");
    // scale tidak menambah lebar layout: padding menjaga jarak antar kata.
    expect(spec.token("active").padding).toBe("0 0.09em");
    expect(spec.token("past").padding).toBe("0 0.09em");
  });

  it("chip: hanya kata aktif punya latar aksen + warna kontras", () => {
    const spec = captionStyleSpec("chip", palette);
    expect(spec.token("active").background).toBe(palette.accent);
    expect(spec.token("active").color).toBe(palette.onAccent);
    expect(spec.token("past").background).toBeUndefined();
  });

  it("halus: tanpa karaoke — semua status sewarna", () => {
    const spec = captionStyleSpec("halus", palette);
    expect(spec.token("active").color).toBe(spec.token("future").color);
  });
});

describe("strokeShadow", () => {
  it("0 = kosong; >0 menghasilkan 8 arah", () => {
    expect(strokeShadow(0, "#000")).toBe("");
    expect(strokeShadow(3, "#000").split(", ")).toHaveLength(8);
  });
});

describe("splitForAnim", () => {
  it("fade satu blok, pop/rise per kata (spasi dipertahankan), typewriter per karakter", () => {
    expect(splitForAnim("aku kamu", "fade")).toEqual(["aku kamu"]);
    expect(splitForAnim("aku kamu", "pop")).toEqual(["aku", " ", "kamu"]);
    expect(splitForAnim("ab", "typewriter")).toEqual(["a", "b"]);
  });
});

describe("animPieceStyle", () => {
  it("pop: berjenjang — potongan awal sudah penuh saat potongan akhir mulai", () => {
    const first = animPieceStyle("pop", 0, 12);
    const third = animPieceStyle("pop", 3, 12);
    expect(first?.opacity).toBe(1);
    expect(Number(third?.opacity)).toBeLessThan(1);
    expect(Number(third?.opacity)).toBeGreaterThan(0);
  });

  it("pop/rise: potongan mempertahankan spasi (inline-block tidak mengempiskan)", () => {
    expect(animPieceStyle("pop", 0, 0)?.whiteSpace).toBe("pre");
    expect(animPieceStyle("rise", 0, 0)?.whiteSpace).toBe("pre");
  });

  it("rise: naik dari bawah, berakhir tanpa geser", () => {
    expect(animPieceStyle("rise", 0, 0)?.translate).toBe("0 0.500em");
    expect(animPieceStyle("rise", 0, 60)?.translate).toBe("0 0.000em");
  });

  it("typewriter: karakter belum giliran = null (tidak dirender)", () => {
    expect(animPieceStyle("typewriter", 5, 0)).toBeNull();
    expect(animPieceStyle("typewriter", 5, 15)).toEqual({});
  });

  it("fade: tanpa gaya tambahan (blok ditangani enterExit)", () => {
    expect(animPieceStyle("fade", 0, 5)).toEqual({});
  });
});

describe("textLookStyle", () => {
  it("default netral = objek kosong", () => {
    expect(
      textLookStyle(
        { color: null, stroke: 0, uppercase: false, tracking: 0 },
        { strokeColor: "#000" },
      ),
    ).toEqual({});
  });

  it("warna, kapital, kerapatan, dan garis luar diterapkan", () => {
    const style = textLookStyle(
      { color: "#ff0000", stroke: 2, uppercase: true, tracking: 0.1 },
      { strokeColor: "#000", baseTracking: "0.02" },
    );
    expect(style.color).toBe("#ff0000");
    expect(style.textTransform).toBe("uppercase");
    expect(style.letterSpacing).toBe("0.120em");
    expect(String(style.textShadow)).toContain("2px");
  });
});
