import { describe, expect, it } from "vitest";
import {
  activeGuideLines,
  activeSnapLines,
  anchorBases,
  elementGuides,
  placeGraphic,
  placeText,
  safeGuides,
  snapLinesFor,
  snapToGuides,
  snapToLines,
} from "../src/canvas";

/**
 * Geometri manipulasi langsung (ADR-0024).
 *
 * Diuji sebagai ANGKA, bukan dilihat dengan mata di preview: satu tanda minus
 * yang keliru membuat tempelan melompat ke sisi berlawanan saat dilepas, dan
 * itu jenis cacat yang cuma ketahuan lewat tangan.
 */

const SAFE = { x: 0.06, y: 0.08 };

describe("jangkar dan geseran", () => {
  it("jangkar tepi memakai margin aman, bukan tepi layar", () => {
    // Menyeret sesuatu "ke pinggir" harus mendaratkannya di kolom aman yang
    // sama dengan tempat preset menaruh teks — bukan menempel di tepi.
    expect(anchorBases(0.06)).toEqual([0.06, 0.5, 0.94]);
  });

  it("titik tengah jatuh ke jangkar tengah dengan geseran nol", () => {
    expect(placeGraphic({ x: 0.5, y: 0.5 }, SAFE)).toEqual({
      anchor: "tengah",
      offsetX: 0,
      offsetY: 0,
    });
  });

  it("tiap sudut memilih jangkar yang benar", () => {
    expect(placeGraphic({ x: 0.02, y: 0.02 }, SAFE).anchor).toBe("kiri-atas");
    expect(placeGraphic({ x: 0.98, y: 0.02 }, SAFE).anchor).toBe("kanan-atas");
    expect(placeGraphic({ x: 0.02, y: 0.98 }, SAFE).anchor).toBe("kiri-bawah");
    expect(placeGraphic({ x: 0.98, y: 0.98 }, SAFE).anchor).toBe("kanan-bawah");
  });

  it("jangkar DIPILIH ULANG, supaya geseran tetap kecil", () => {
    // Kalau jangkarnya dipertahankan, menyeret dari kanan-bawah ke kiri-atas
    // butuh geseran hampir -1 sementara skema membatasinya di ±0,5 — tempelan
    // akan berhenti di tengah jalan tanpa alasan yang terlihat.
    const jauh = placeGraphic({ x: 0.1, y: 0.12 }, SAFE);
    expect(jauh.anchor).toBe("kiri-atas");
    expect(Math.abs(jauh.offsetX)).toBeLessThan(0.1);
    expect(Math.abs(jauh.offsetY)).toBeLessThan(0.1);
  });

  it("geseran menunjuk arah yang benar, bukan terbalik", () => {
    const kanan = placeGraphic({ x: 0.58, y: 0.5 }, SAFE);
    expect(kanan.anchor).toBe("tengah");
    expect(kanan.offsetX).toBeGreaterThan(0);
    const atas = placeGraphic({ x: 0.5, y: 0.42 }, SAFE);
    expect(atas.offsetY).toBeLessThan(0);
  });

  it("titik di luar bingkai dijepit, bukan menghasilkan nilai tak sah", () => {
    const hasil = placeGraphic({ x: -3, y: 9 }, SAFE);
    expect(hasil.offsetX).toBeGreaterThanOrEqual(-0.5);
    expect(hasil.offsetY).toBeLessThanOrEqual(0.5);
    expect(hasil.anchor).toBe("kiri-bawah");
  });

  it("geseran dibulatkan supaya diff patch tidak jadi derau", () => {
    const hasil = placeGraphic({ x: 0.5 + 1 / 3000, y: 0.5 }, SAFE);
    expect(
      String(hasil.offsetX).replace("-", "").split(".")[1]?.length ?? 0,
    ).toBeLessThanOrEqual(4);
  });
});

describe("penempatan teks", () => {
  it("memilih posisi vertikal terdekat", () => {
    expect(placeText({ x: 0.5, y: 0.05 }, SAFE).position).toBe("top");
    expect(placeText({ x: 0.5, y: 0.5 }, SAFE).position).toBe("center");
    expect(placeText({ x: 0.5, y: 0.95 }, SAFE).position).toBe("bottom");
  });

  it("TIDAK mengembalikan align: perataan itu keputusan tipografi, bukan letak", () => {
    // Mengubah align saat orang menggeser blok teks akan mengubah rupa
    // paragrafnya tanpa diminta.
    const hasil = placeText({ x: 0.1, y: 0.5 }, SAFE);
    expect(Object.keys(hasil).sort()).toEqual(["offsetX", "offsetY", "position"]);
  });
});

describe("garis bantu", () => {
  it("menempel hanya di dalam ambang", () => {
    const lines = snapLinesFor(SAFE);
    expect(snapToLines(0.505, lines.x, 0.012)).toBe(0.5);
    expect(snapToLines(0.55, lines.x, 0.012)).toBe(0.55);
  });

  it("melaporkan garis yang SEDANG menempel, untuk digambar", () => {
    const aktif = activeSnapLines({ x: 0.5, y: 0.2 }, snapLinesFor(SAFE), 0.012);
    expect(aktif.x).toEqual([0.5]);
    expect(aktif.y).toEqual([]);
  });
});

describe("penempelan ke elemen lain (ADR-0024, batas dicabut)", () => {
  const dragged = { x: 0, y: 0, w: 0.2, h: 0.1 };
  const other = { x: 0.3, y: 0.4, w: 0.4, h: 0.2 };

  it("menawarkan pusat, tepi sejajar, dan bersebelahan — dalam koordinat PUSAT elemen yang diseret", () => {
    const { x, y } = elementGuides(dragged, [other]);
    // x: pusat 0,5; kiri sejajar kiri 0,3 → pusat 0,4; kanan sejajar kanan
    // 0,7 → pusat 0,6; bersebelahan kanan 0,7 → pusat 0,8; kiri 0,3 → 0,2.
    expect(x.map((g) => [Number(g.at.toFixed(3)), Number(g.line.toFixed(3))])).toEqual([
      [0.5, 0.5],
      [0.4, 0.3],
      [0.6, 0.7],
      [0.8, 0.7],
      [0.2, 0.3],
    ]);
    expect(y.map((g) => Number(g.at.toFixed(3)))).toEqual([0.5, 0.45, 0.55, 0.65, 0.35]);
  });

  it("menempel ke panduan terdekat di dalam ambang, dan garis yang digambar adalah TEPI-nya", () => {
    const guides = elementGuides(dragged, [other]);
    expect(snapToGuides(0.405, guides.x, 0.012)).toBeCloseTo(0.4, 6);
    expect(snapToGuides(0.45, guides.x, 0.012)).toBe(0.45);
    const active = activeGuideLines({ x: 0.4, y: 0.9 }, guides, 0.012);
    expect(active.x).toEqual([0.3]);
    expect(active.y).toEqual([]);
  });

  it("panduan margin aman tetap ada, pusat dan garisnya sama", () => {
    const safe = safeGuides({ x: 0.06, y: 0.08 });
    expect(safe.x.map((g) => g.at)).toEqual([0.06, 0.5, 0.94]);
    expect(safe.x.every((g) => g.at === g.line)).toBe(true);
  });

  it("garis kembar dari dua elemen yang sejajar digambar sekali", () => {
    const twins = elementGuides(dragged, [other, { ...other, y: 0.7 }]);
    const active = activeGuideLines({ x: 0.5, y: 0 }, twins, 0.012);
    expect(active.x).toEqual([0.5]);
  });
});
