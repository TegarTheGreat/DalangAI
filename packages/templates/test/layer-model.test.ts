import { videoLayerSchema } from "@dalang/core";
import { describe, expect, it } from "vitest";
import {
  layerBoxStyle,
  layerMotion,
  layerRadius,
  layerSize,
  layerWindow,
  slideFrom,
} from "../src/layer-model";

/**
 * ADR-0025: geometri & gerak lapisan video.
 *
 * Semuanya diuji sebagai ANGKA. Bagian ini paling mudah salah dan paling mahal
 * kalau salah — satu tanda minus keliru membuat sisipan mendarat di sisi
 * berlawanan, dan itu tidak terlihat dari kode, hanya dari video.
 */

const layer = (over: Record<string, unknown> = {}) =>
  videoLayerSchema.parse({ id: "lap-1", visual: { type: "stock" }, ...over });

const frame = { width: 1920, height: 1080, marginX: 120, marginTop: 90 };

describe("jendela tampil", () => {
  it("fraksi durasi scene jadi frame; jendela nol tetap minimal satu frame", () => {
    expect(layerWindow(layer({ startFrac: 0.25, endFrac: 0.75 }), 200)).toEqual({
      from: 50,
      frames: 100,
    });
    expect(layerWindow(layer({ startFrac: 0.5, endFrac: 0.5 }), 200).frames).toBe(1);
  });
});

describe("gerak masuk", () => {
  it("diam tidak pernah memudar, bahkan di frame pertama", () => {
    expect(layerMotion(layer({ entrance: "diam", opacity: 0.8 }), 0, 90).opacity).toBe(
      0.8,
    );
  });

  it("fade mulai dari nol dan sampai penuh di akhir jendela masuk", () => {
    const fade = layer({ entrance: "fade" });
    expect(layerMotion(fade, 0, 90).opacity).toBe(0);
    expect(layerMotion(fade, 40, 90).opacity).toBe(1);
  });

  it("pop membesar dari 0,86 ke 1 tanpa pernah melewatinya", () => {
    const pop = layer({ entrance: "pop" });
    expect(layerMotion(pop, 0, 90).scale).toBeCloseTo(0.86, 4);
    expect(layerMotion(pop, 60, 90).scale).toBeCloseTo(1, 4);
  });

  /**
   * Sisipan yang menggeser masuk SAMBIL memudar terbaca sebagai dua animasi
   * yang bertengkar; `geser` karenanya opasitas penuh sejak frame pertama.
   */
  it("geser masuk dengan opasitas penuh dan berhenti tepat di tempatnya", () => {
    const geser = layer({ entrance: "geser", opacity: 1 });
    const awal = layerMotion(geser, 0, 90);
    expect(awal.opacity).toBe(1);
    expect(awal.slideX).not.toBe(0);
    const akhir = layerMotion(geser, 60, 90);
    expect(akhir.slideX).toBe(0);
    expect(akhir.slideY).toBe(0);
  });

  /**
   * Arah masuk diturunkan dari jangkar, bukan disimpan sebagai pilihan:
   * sisipan kanan-bawah yang masuk dari kiri-atas terlihat seperti kesalahan.
   */
  it("arah geser mengikuti jangkarnya; jangkar tengah naik sedikit", () => {
    expect(slideFrom(layer({ anchor: "kanan-bawah" }))).toEqual({ x: 0.5, y: 0.5 });
    expect(slideFrom(layer({ anchor: "kiri-atas" }))).toEqual({ x: -0.5, y: -0.5 });
    expect(slideFrom(layer({ anchor: "tengah" }))).toEqual({ x: 0, y: 0.35 });
  });
});

describe("kotak", () => {
  it("ukuran adalah fraksi lebar/tinggi bingkai, bukan satu angka", () => {
    expect(layerSize(layer({ width: 0.25, height: 0.5 }), frame)).toEqual({
      width: 480,
      height: 540,
    });
  });

  /**
   * `radius` fraksi sisi TERPENDEK. Kalau dihitung dari lebar, sisipan 16:9
   * dengan radius 0,5 akan minta sudut lebih besar dari tingginya sendiri dan
   * CSS memotongnya diam-diam ke bentuk yang tidak diminta.
   */
  it("radius memakai sisi terpendek; bentuk bulat selalu 50%", () => {
    expect(layerRadius(layer({ width: 0.5, height: 0.2, radius: 0.5 }), frame)).toBe(
      "108px",
    );
    expect(layerRadius(layer({ shape: "bulat" }), frame)).toBe("50%");
  });

  it("jangkar tepi memakai MARGIN AMAN, bukan tepi bingkai", () => {
    const style = layerBoxStyle(
      layer({ anchor: "kiri-atas" }),
      layerMotion(layer({ entrance: "diam" }), 0, 90),
      frame,
      "#fff",
    );
    expect(style.left).toBe(120);
    expect(style.top).toBe(90);
    expect(style.right).toBeUndefined();
  });

  it("jangkar tengah memakai 50% + geseran diri sendiri", () => {
    const style = layerBoxStyle(
      layer({ anchor: "tengah" }),
      layerMotion(layer({ entrance: "diam" }), 0, 90),
      frame,
      "#fff",
    );
    expect(style.left).toBe("50%");
    expect(String(style.translate)).toContain("-50%");
  });

  it("geseran pengguna dihitung dalam piksel bingkai", () => {
    // SATU lapisan untuk motion dan style: sejak ADR-0027 nilai terpakai tiap
    // properti diputuskan di `layerMotion`, jadi memberi keduanya lapisan
    // berbeda tidak berarti apa-apa — dan komponennya tidak pernah begitu.
    const item = layer({
      anchor: "kiri-atas",
      offsetX: 0.1,
      offsetY: -0.05,
      entrance: "diam",
    });
    const style = layerBoxStyle(item, layerMotion(item, 0, 90), frame, "#fff");
    // 0,1 x 1920 = 192px ; -0,05 x 1080 = -54px
    expect(String(style.translate)).toContain("192px");
    expect(String(style.translate)).toContain("-54px");
  });

  it("bingkai memakai warna aksen preset bila borderColor kosong", () => {
    const withBorder = layerBoxStyle(
      layer({ border: 0.005 }),
      layerMotion(layer({ entrance: "diam" }), 0, 90),
      frame,
      "#e8a33d",
    );
    expect(withBorder.border).toBe("5.4px solid #e8a33d");
    const noBorder = layerBoxStyle(
      layer({ border: 0 }),
      layerMotion(layer({ entrance: "diam" }), 0, 90),
      frame,
      "#e8a33d",
    );
    expect(noBorder.border).toBeUndefined();
  });

  /**
   * Kotak memotong isinya. Tanpa `overflow: hidden`, gerak Ken Burns di dalam
   * sisipan akan merayap keluar dari bingkainya sendiri.
   */
  it("kotak selalu memotong isinya", () => {
    const style = layerBoxStyle(layer(), layerMotion(layer(), 30, 90), frame, "#fff");
    expect(style.overflow).toBe("hidden");
  });
});
