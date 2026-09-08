import type { Annotation } from "@dalang/core";

/**
 * Geometri seret anotasi tutorial (mencabut batas ADR-0024 "anotasi tidak bisa
 * diseret").
 *
 * Anotasi berbeda dari teks/grafis/lapisan: targetnya adalah persegi
 * ternormalisasi terhadap BINGKAI SCREENSHOT (kartu di dalam frame), bukan
 * terhadap frame video. Karena itu Studio mengukur dua kotak dari DOM —
 * bingkainya (`data-dalang-annotation-frame`) dan penanda tiap anotasi
 * (`data-dalang-annotation`) — lalu semua hitungan di sini bekerja pada
 * PIKSEL relatif bingkai itu. Murni supaya bisa diuji tanpa DOM.
 */

export interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Ukuran terkecil target, fraksi bingkai — di bawah ini ring/panah tak terlihat. */
export const MIN_ANNOTATION_SIDE = 0.02;

const round4 = (value: number): number => Number(value.toFixed(4));
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Target baru setelah kotak (dalam piksel kotak pemutar) DIGESER sejauh
 * `dx, dy` piksel. Ukurannya tetap; posisinya dipangkas supaya seluruh kotak
 * tetap di dalam bingkai.
 */
export const movedAnnotationTarget = (
  frame: PxRect,
  rect: PxRect,
  dx: number,
  dy: number,
): Annotation["target"] => {
  const w = clamp(rect.w / frame.w, MIN_ANNOTATION_SIDE, 1);
  const h = clamp(rect.h / frame.h, MIN_ANNOTATION_SIDE, 1);
  const x = clamp((rect.x + dx - frame.x) / frame.w, 0, 1 - w);
  const y = clamp((rect.y + dy - frame.y) / frame.h, 0, 1 - h);
  return { x: round4(x), y: round4(y), w: round4(w), h: round4(h) };
};

/**
 * Target baru setelah sudut kanan-bawah kotak DITARIK sejauh `dx, dy` piksel.
 * Sudut kiri-atas tetap; lebar/tinggi dipangkas ke minimum dan ke tepi bingkai.
 */
export const resizedAnnotationTarget = (
  frame: PxRect,
  rect: PxRect,
  dx: number,
  dy: number,
): Annotation["target"] => {
  const x = clamp((rect.x - frame.x) / frame.w, 0, 1 - MIN_ANNOTATION_SIDE);
  const y = clamp((rect.y - frame.y) / frame.h, 0, 1 - MIN_ANNOTATION_SIDE);
  const w = clamp((rect.w + dx) / frame.w, MIN_ANNOTATION_SIDE, 1 - x);
  const h = clamp((rect.h + dy) / frame.h, MIN_ANNOTATION_SIDE, 1 - y);
  return { x: round4(x), y: round4(y), w: round4(w), h: round4(h) };
};

/** Dua target dianggap sama bila selisih tiap sisinya di bawah seperseribu. */
export const sameTarget = (a: Annotation["target"], b: Annotation["target"]): boolean =>
  Math.abs(a.x - b.x) < 0.001 &&
  Math.abs(a.y - b.y) < 0.001 &&
  Math.abs(a.w - b.w) < 0.001 &&
  Math.abs(a.h - b.h) < 0.001;
