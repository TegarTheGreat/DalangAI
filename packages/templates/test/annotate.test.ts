import { describe, expect, it } from "vitest";
import {
  ANNOTATION_ENTER_FRAMES,
  activeZoom,
  annotationPresence,
  annotationWindow,
  arrowSide,
  stepNumbers,
  ZOOM_MAX_SCALE,
  zoomTransform,
} from "../src/presets/tutorial-01/annotate";

const FPS = 30;

const zoomAt = (startSec: number, endSec?: number) => ({
  type: "zoom" as const,
  target: { x: 0.6, y: 0.1, w: 0.2, h: 0.1 },
  timing: endSec === undefined ? { startSec } : { startSec, endSec },
});

describe("annotationWindow", () => {
  it("endSec kosong = bertahan sampai akhir scene; nilai di luar diklem", () => {
    expect(annotationWindow(zoomAt(1), 150, FPS)).toEqual({ from: 30, to: 150 });
    expect(annotationWindow(zoomAt(1, 3), 150, FPS)).toEqual({ from: 30, to: 90 });
    expect(annotationWindow(zoomAt(99, 120), 150, FPS)).toEqual({
      from: 149,
      to: 150,
    });
  });
});

describe("annotationPresence", () => {
  it("0 di luar jendela, naik ease saat masuk, penuh setelah enter", () => {
    const window = { from: 30, to: 150 };
    expect(annotationPresence(29, window, 150)).toBe(0);
    expect(annotationPresence(150, window, 150)).toBe(0);
    const mid = annotationPresence(30 + ANNOTATION_ENTER_FRAMES / 2, window, 150);
    expect(mid).toBeGreaterThan(0.5); // ease-out: separuh waktu > separuh nilai
    expect(annotationPresence(30 + ANNOTATION_ENTER_FRAMES, window, 150)).toBe(1);
  });

  it("jendela yang berakhir sebelum akhir scene memudar keluar", () => {
    const window = { from: 0, to: 60 };
    expect(annotationPresence(59, window, 300)).toBeLessThan(0.7);
    // Jendela sampai akhir scene TIDAK memudar (transisi scene mengambil alih).
    expect(annotationPresence(299, { from: 0, to: 300 }, 300)).toBe(1);
  });
});

describe("zoomTransform", () => {
  it("target di pusat → tanpa translasi; skala sesuai coverage", () => {
    const t = zoomTransform({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, 1600, 900, 1);
    expect(t.translateX).toBeCloseTo(0, 6);
    expect(t.translateY).toBeCloseTo(0, 6);
    expect(t.scale).toBeCloseTo(0.66 / 0.2, 3);
  });

  it("target kecil diklem ke ZOOM_MAX_SCALE; presence 0 = netral", () => {
    const tiny = zoomTransform({ x: 0.1, y: 0.1, w: 0.03, h: 0.03 }, 1600, 900, 1);
    expect(tiny.scale).toBe(ZOOM_MAX_SCALE);
    const idle = zoomTransform({ x: 0.1, y: 0.1, w: 0.03, h: 0.03 }, 1600, 900, 0);
    expect(idle).toEqual({ scale: 1, translateX: 0, translateY: 0 });
  });

  it("translasi membawa pusat target ke pusat stage", () => {
    const t = zoomTransform({ x: 0.7, y: 0.1, w: 0.2, h: 0.2 }, 1000, 500, 1);
    // cx=0.8, cy=0.2 → tx = -(0.3)*1000, ty = -(-0.3)*500
    expect(t.translateX).toBeCloseTo(-300, 4);
    expect(t.translateY).toBeCloseTo(150, 4);
  });

  it("pan diklem: target tepi tidak menyingkap area di luar gambar", () => {
    // Target tinggi di tepi kiri (kasus kartu brief): skala dibatasi tinggi.
    const t = zoomTransform({ x: 0.01, y: 0.12, w: 0.19, h: 0.5 }, 1600, 900, 1);
    const maxTx = ((t.scale - 1) * 1600) / (2 * t.scale);
    expect(t.translateX).toBeCloseTo(maxTx, 4); // ingin lebih jauh, tapi diklem
    // Tepi kiri gambar tetap di x<=0 layar: 800 + s*(-800 + tx) <= 0.
    expect(800 + t.scale * (-800 + t.translateX)).toBeLessThanOrEqual(0.001);
  });
});

describe("activeZoom", () => {
  it("tanpa anotasi zoom aktif → transform netral", () => {
    expect(activeZoom([], 10, 300, FPS, 1600, 900)).toEqual({
      scale: 1,
      translateX: 0,
      translateY: 0,
    });
    // highlight tidak memicu kamera
    const highlight = { ...zoomAt(0), type: "highlight" as const };
    expect(activeZoom([highlight], 60, 300, FPS, 1600, 900).scale).toBe(1);
  });

  it("anotasi zoom aktif menggerakkan kamera", () => {
    const zoomed = activeZoom([zoomAt(0)], 120, 300, FPS, 1600, 900);
    expect(zoomed.scale).toBeGreaterThan(2);
  });
});

describe("arrowSide & stepNumbers", () => {
  it("panah memilih sisi cukup lapang dengan preferensi bawah > horizontal > atas", () => {
    // Ruang bawah lapang -> dari bawah, konvensi tutorial.
    expect(arrowSide({ x: 0.75, y: 0.4, w: 0.2, h: 0.2 })).toBe("bottom");
    // Target dekat dasar (timeline): bawah sempit -> horizontal.
    expect(arrowSide({ x: 0.4, y: 0.78, w: 0.2, h: 0.18 })).toBe("left");
    // Terkurung di pojok kiri-bawah: satu-satunya yang muat adalah kanan.
    expect(arrowSide({ x: 0.02, y: 0.8, w: 0.06, h: 0.17 })).toBe("right");
    // Tidak ada yang muat -> sisi paling lapang.
    expect(arrowSide({ x: 0.05, y: 0.05, w: 0.9, h: 0.85 })).toBe("bottom");
  });

  it("nomor langkah melewati scene template-anim", () => {
    const plan = {
      scenes: [
        { id: "t", clips: [{ id: "t-k1", type: "template-anim" }] },
        { id: "a", clips: [{ id: "a-k1", type: "screenshot" }] },
        { id: "b", clips: [{ id: "b-k1", type: "screenshot" }] },
        { id: "o", clips: [{ id: "o-k1", type: "template-anim" }] },
      ],
    } as never;
    const steps = stepNumbers(plan);
    expect(steps.get("a")).toEqual({ step: 1, total: 2 });
    expect(steps.get("b")).toEqual({ step: 2, total: 2 });
    expect(steps.has("t")).toBe(false);
  });
});
