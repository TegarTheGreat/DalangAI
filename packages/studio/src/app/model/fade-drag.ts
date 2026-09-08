/**
 * Geometri pegangan fade di timeline (mencabut batas ADR-0026 "trek audio
 * tidak bisa di-fade lewat kanvas").
 *
 * Fade masuk diukur dari TEPI KIRI bar, fade keluar dari TEPI KANAN; keduanya
 * dalam detik, dibulatkan ke sepersepuluh (angka yang sama dengan slider di
 * panel), dipangkas ke batas skema (10 detik) dan ke setengah rentang bar —
 * dua fade yang saling menumpuk membuat klip tidak pernah mencapai volumenya.
 * Murni supaya bisa diuji tanpa DOM.
 */

/** Batas skema `fadeInSec`/`fadeOutSec`. */
export const MAX_FADE_SEC = 10;

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Fade terpanjang yang masuk akal untuk bar sepanjang `spanSec`. */
export const maxFadeFor = (spanSec: number): number =>
  Math.max(0, Math.min(MAX_FADE_SEC, spanSec / 2));

/** Pangkas & bulatkan nilai fade untuk bar sepanjang `spanSec`. */
export const nudgeFade = (sec: number, spanSec: number): number =>
  round1(Math.min(maxFadeFor(spanSec), Math.max(0, sec)));

/** Fade masuk dari jarak pointer ke tepi kiri bar (piksel). */
export const fadeFromLeft = (dxPx: number, pxPerSec: number, spanSec: number): number =>
  pxPerSec > 0 ? nudgeFade(dxPx / pxPerSec, spanSec) : 0;

/** Fade keluar dari jarak pointer ke tepi kanan bar (piksel). */
export const fadeFromRight = (dxPx: number, pxPerSec: number, spanSec: number): number =>
  pxPerSec > 0 ? nudgeFade(dxPx / pxPerSec, spanSec) : 0;
