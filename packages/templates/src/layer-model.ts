import type { VideoLayer } from "@dalang/core";
import type { CSSProperties } from "react";
import { easeSettle, kf } from "./anim";
import { anchorSpec, type GraphicFrame } from "./graphic-model";

/**
 * Model penempatan & gerak LAPISAN VIDEO (ADR-0025, roadmap §9.2).
 *
 * Murni: tidak menyentuh React maupun Remotion, jadi seluruh aturan kotak dan
 * animasinya bisa diuji sebagai angka — bukan diperiksa dengan mata di video.
 * Alasannya persis sama dengan grafis di ADR-0018, dan ia sengaja memakai
 * `anchorSpec` yang sama: sisipan dan tempelan yang dijangkarkan "kanan-bawah"
 * harus mendarat di tempat yang SAMA, kalau tidak menata keduanya berdampingan
 * jadi tebak-tebakan.
 *
 * Yang berbeda dari grafis hanya satu hal, dan itu disengaja: lapisan punya
 * LEBAR dan TINGGI sendiri (fraksi lebar/tinggi bingkai), bukan satu `size`.
 * Grafis adalah ikon persegi; sisipan video punya rasio sendiri, dan memaksa
 * kotaknya persegi akan memotong footage 16:9 di setiap sisipan.
 */

/** Buang derau float supaya nilai CSS deterministik antar render. */
const fmt = (value: number): number => Number(value.toFixed(4));

export interface LayerMotion {
  opacity: number;
  scale: number;
  /** Geseran masuk, dalam FRAKSI ukuran kotak (bukan piksel). */
  slideX: number;
  slideY: number;
}

/**
 * Arah masuk animasi `geser`: keluar dari bingkai, menuju jangkarnya.
 *
 * Diturunkan dari jangkar, bukan disimpan sebagai field sendiri. Sisipan di
 * kanan-bawah yang masuk dari kiri atas terlihat seperti kesalahan; menyimpan
 * arahnya sebagai pilihan berarti setiap pengguna harus mengarahkannya sendiri
 * dan sebagian besar akan salah. Jangkar tengah tidak punya sisi luar, jadi ia
 * naik sedikit — gerak yang sama dengan teks `rise`.
 */
export const slideFrom = (layer: VideoLayer): { x: number; y: number } => {
  const spec = anchorSpec(layer.anchor);
  const x = spec.horizontal === "awal" ? -1 : spec.horizontal === "akhir" ? 1 : 0;
  const y = spec.vertical === "awal" ? -1 : spec.vertical === "akhir" ? 1 : 0;
  if (x === 0 && y === 0) return { x: 0, y: 0.35 };
  return { x: x * 0.5, y: y * 0.5 };
};

/**
 * Gerak lapisan pada satu frame di dalam jendela tampilnya.
 *
 * `windowFrames` adalah panjang jendela, bukan panjang scene: sisipan 1 detik
 * dan 10 detik sama-sama masuk dengan tempo yang enak.
 */
export const layerMotion = (
  layer: VideoLayer,
  frame: number,
  windowFrames: number,
): LayerMotion => {
  const enterFrames = Math.min(16, Math.max(6, Math.round(windowFrames * 0.16)));
  const enter = kf(
    frame,
    [
      [0, 0],
      [enterFrames, 1],
    ],
    easeSettle,
  );
  const base: LayerMotion = {
    opacity: fmt(enter * layer.opacity),
    scale: 1,
    slideX: 0,
    slideY: 0,
  };

  switch (layer.entrance) {
    case "diam":
      return { ...base, opacity: fmt(layer.opacity) };
    case "fade":
      return base;
    case "pop":
      return { ...base, scale: fmt(0.86 + enter * 0.14) };
    case "geser": {
      const from = slideFrom(layer);
      return {
        ...base,
        // Opasitas penuh sejak awal: sisipan yang menggeser masuk SAMBIL
        // memudar terbaca sebagai dua animasi yang bertengkar.
        opacity: fmt(layer.opacity),
        slideX: fmt(from.x * (1 - enter)),
        slideY: fmt(from.y * (1 - enter)),
      };
    }
    default:
      return base;
  }
};

/** Jendela tampil lapisan dalam frame, dari fraksi durasi scene. */
export const layerWindow = (
  layer: VideoLayer,
  durationInFrames: number,
): { from: number; frames: number } => {
  const from = Math.round(layer.startFrac * durationInFrames);
  const to = Math.round(layer.endFrac * durationInFrames);
  return { from, frames: Math.max(1, to - from) };
};

/** Ukuran kotak lapisan dalam piksel bingkai. */
export const layerSize = (
  layer: VideoLayer,
  frame: GraphicFrame,
): { width: number; height: number } => ({
  width: fmt(layer.width * frame.width),
  height: fmt(layer.height * frame.height),
});

/**
 * Sudut membulat kotak, dalam piksel.
 *
 * `radius` adalah fraksi sisi TERPENDEK, bukan lebar: pada sisipan 16:9 yang
 * lebar, fraksi-lebar 0,5 akan menghasilkan sudut lebih besar dari tingginya
 * sendiri dan CSS akan memotongnya diam-diam ke bentuk yang tidak diminta.
 */
export const layerRadius = (layer: VideoLayer, frame: GraphicFrame): string => {
  if (layer.shape === "bulat") return "50%";
  const { width, height } = layerSize(layer, frame);
  return `${fmt(layer.radius * Math.min(width, height))}px`;
};

/**
 * Gaya CSS kotak lapisan (posisi, ukuran, bentuk, bingkai) — TANPA medianya.
 *
 * Kotak dan medianya sengaja dipisah: kotak memotong (`overflow: hidden`) dan
 * media di dalamnya bergerak sendiri lewat `motionTransform`. Kalau keduanya
 * satu elemen, Ken Burns di dalam sisipan akan menggeser BINGKAINYA, bukan
 * isinya — dan sisipan yang merayap keluar dari tempatnya terlihat rusak.
 */
export const layerBoxStyle = (
  layer: VideoLayer,
  motion: LayerMotion,
  frame: GraphicFrame,
  accent: string,
): CSSProperties => {
  const spec = anchorSpec(layer.anchor);
  const { width, height } = layerSize(layer, frame);
  const dx = fmt(layer.offsetX * frame.width + motion.slideX * width);
  const dy = fmt(layer.offsetY * frame.height + motion.slideY * height);
  const borderPx = fmt(layer.border * frame.height);

  const horizontal =
    spec.horizontal === "awal"
      ? { left: frame.marginX, shiftX: "0px" }
      : spec.horizontal === "akhir"
        ? { right: frame.marginX, shiftX: "0px" }
        : { left: "50%", shiftX: "-50%" };
  const vertical =
    spec.vertical === "awal"
      ? { top: frame.marginTop, shiftY: "0px" }
      : spec.vertical === "akhir"
        ? { bottom: frame.marginTop, shiftY: "0px" }
        : { top: "50%", shiftY: "-50%" };

  return {
    position: "absolute",
    ...("left" in horizontal ? { left: horizontal.left } : { right: horizontal.right }),
    ...("top" in vertical ? { top: vertical.top } : { bottom: vertical.bottom }),
    width,
    height,
    opacity: motion.opacity,
    overflow: "hidden",
    borderRadius: layerRadius(layer, frame),
    ...(borderPx > 0
      ? { border: `${borderPx}px solid ${layer.borderColor ?? accent}` }
      : {}),
    // Bayangan halus supaya sisipan terbaca sebagai lapisan DI ATAS, bukan
    // sebagai lubang di dalam gambarnya. Tidak ada di skema: ini keputusan
    // tampilan preset, bukan maksud kreatif yang perlu disimpan.
    boxShadow: "0 18px 48px rgba(0, 0, 0, 0.42)",
    translate: `calc(${horizontal.shiftX} + ${dx}px) calc(${vertical.shiftY} + ${dy}px)`,
    scale: motion.scale,
  };
};
