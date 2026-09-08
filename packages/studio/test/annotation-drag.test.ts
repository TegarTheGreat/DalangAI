import { describe, expect, it } from "vitest";
import {
  MIN_ANNOTATION_SIDE,
  movedAnnotationTarget,
  resizedAnnotationTarget,
  sameTarget,
} from "../src/app/model/annotation-drag";

/**
 * Seret anotasi (mencabut batas ADR-0024): hitungannya relatif BINGKAI
 * SCREENSHOT yang diukur dari DOM, bukan frame video. Angka dihitung tangan.
 */

// Bingkai screenshot 400x300 px, bermula di (100, 50) di dalam kotak pemutar.
const frame = { x: 100, y: 50, w: 400, h: 300 };
// Anotasi target {x:0.25,y:0.2,w:0.5,h:0.4} → piksel (200,110) 200x120.
const rect = { x: 200, y: 110, w: 200, h: 120 };

describe("movedAnnotationTarget", () => {
  it("menggeser posisi sebesar piksel yang diseret, ukuran tetap", () => {
    expect(movedAnnotationTarget(frame, rect, 40, -30)).toEqual({
      x: 0.35,
      y: 0.1,
      w: 0.5,
      h: 0.4,
    });
  });

  it("dipangkas supaya seluruh kotak tetap di dalam bingkai", () => {
    expect(movedAnnotationTarget(frame, rect, 5000, 5000)).toEqual({
      x: 0.5,
      y: 0.6,
      w: 0.5,
      h: 0.4,
    });
    expect(movedAnnotationTarget(frame, rect, -5000, -5000)).toEqual({
      x: 0,
      y: 0,
      w: 0.5,
      h: 0.4,
    });
  });
});

describe("resizedAnnotationTarget", () => {
  it("menarik sudut kanan-bawah; kiri-atas tetap", () => {
    expect(resizedAnnotationTarget(frame, rect, 40, 30)).toEqual({
      x: 0.25,
      y: 0.2,
      w: 0.6,
      h: 0.5,
    });
  });

  it("tidak lebih kecil dari minimum dan tidak melewati tepi bingkai", () => {
    const tiny = resizedAnnotationTarget(frame, rect, -1000, -1000);
    expect(tiny.w).toBe(MIN_ANNOTATION_SIDE);
    expect(tiny.h).toBe(MIN_ANNOTATION_SIDE);
    const huge = resizedAnnotationTarget(frame, rect, 5000, 5000);
    expect(huge.x + huge.w).toBeCloseTo(1, 5);
    expect(huge.y + huge.h).toBeCloseTo(1, 5);
  });
});

describe("sameTarget", () => {
  it("toleransi seperseribu — getaran sub-piksel bukan perubahan", () => {
    const a = { x: 0.25, y: 0.2, w: 0.5, h: 0.4 };
    expect(sameTarget(a, { ...a, x: 0.2504 })).toBe(true);
    expect(sameTarget(a, { ...a, x: 0.26 })).toBe(false);
  });
});
