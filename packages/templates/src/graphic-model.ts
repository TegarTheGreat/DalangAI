import type { Graphic, GraphicAnchor } from "@dalang/core";
import type { CSSProperties } from "react";
import { easeSettle, kf } from "./anim";

/**
 * Model penempatan & gerak grafis tempelan (ADR-0018).
 *
 * Murni: tidak menyentuh React maupun Remotion, jadi seluruh aturan posisi dan
 * animasinya bisa diuji sebagai angka — bukan diperiksa dengan mata di video.
 *
 * Posisi dinyatakan sebagai JANGKAR + geseran fraksional, bukan koordinat
 * piksel. Dengan begitu satu nilai yang sama tetap benar di 16:9, 9:16, dan
 * 1:1 tanpa dihitung ulang — kalau memakai piksel, tiap ganti rasio semua
 * tempelan harus ditata ulang.
 */

interface AnchorSpec {
  /** Nilai CSS inset; null = tidak diatur di sumbu itu. */
  top: string | null;
  bottom: string | null;
  left: string | null;
  right: string | null;
  /** Geseran untuk memusatkan diri sendiri pada sumbu yang di tengah. */
  translate: string;
}

/** Sisipan tepi: grafis tidak pernah menempel persis di pinggir frame. */
export const GRAPHIC_EDGE_INSET = "4.5%";

const ANCHORS: Record<GraphicAnchor, AnchorSpec> = {
  "kiri-atas": {
    top: GRAPHIC_EDGE_INSET,
    bottom: null,
    left: GRAPHIC_EDGE_INSET,
    right: null,
    translate: "0 0",
  },
  "tengah-atas": {
    top: GRAPHIC_EDGE_INSET,
    bottom: null,
    left: "50%",
    right: null,
    translate: "-50% 0",
  },
  "kanan-atas": {
    top: GRAPHIC_EDGE_INSET,
    bottom: null,
    left: null,
    right: GRAPHIC_EDGE_INSET,
    translate: "0 0",
  },
  "kiri-tengah": {
    top: "50%",
    bottom: null,
    left: GRAPHIC_EDGE_INSET,
    right: null,
    translate: "0 -50%",
  },
  tengah: {
    top: "50%",
    bottom: null,
    left: "50%",
    right: null,
    translate: "-50% -50%",
  },
  "kanan-tengah": {
    top: "50%",
    bottom: null,
    left: null,
    right: GRAPHIC_EDGE_INSET,
    translate: "0 -50%",
  },
  "kiri-bawah": {
    top: null,
    bottom: GRAPHIC_EDGE_INSET,
    left: GRAPHIC_EDGE_INSET,
    right: null,
    translate: "0 0",
  },
  "tengah-bawah": {
    top: null,
    bottom: GRAPHIC_EDGE_INSET,
    left: "50%",
    right: null,
    translate: "-50% 0",
  },
  "kanan-bawah": {
    top: null,
    bottom: GRAPHIC_EDGE_INSET,
    left: null,
    right: GRAPHIC_EDGE_INSET,
    translate: "0 0",
  },
};

export const anchorSpec = (anchor: GraphicAnchor): AnchorSpec => ANCHORS[anchor];

/** Pembulatan agar keluaran stabil byte-per-byte antar render. */
const fmt = (value: number): number => Number(value.toFixed(4));

export interface GraphicMotion {
  /** Skala tambahan dari animasi masuk/denyut. */
  scale: number;
  /** Rotasi total (derajat) = rotate statis + gerak. */
  rotate: number;
  /** Geseran vertikal tambahan dalam fraksi tinggi grafis. */
  liftFrac: number;
  opacity: number;
}

/**
 * Gerak grafis pada satu frame.
 *
 * `progress` adalah kemajuan 0-1 di dalam jendela tampil grafis, sehingga
 * animasi tidak bergantung pada panjang scene: tempelan 1 detik dan 10 detik
 * sama-sama masuk dengan tempo yang enak.
 */
export const graphicMotion = (
  graphic: Graphic,
  frame: number,
  windowFrames: number,
): GraphicMotion => {
  const enterFrames = Math.min(14, Math.max(6, Math.round(windowFrames * 0.18)));
  const enter = kf(
    frame,
    [
      [0, 0],
      [enterFrames, 1],
    ],
    easeSettle,
  );

  // Semua animasi berbagi kemunculan yang sama; yang membedakan hanya gerak
  // lanjutannya, supaya satu scene dengan beberapa tempelan tetap terasa satu
  // bahasa gerak.
  const base: GraphicMotion = {
    scale: 1,
    rotate: graphic.rotate,
    liftFrac: 0,
    opacity: fmt(enter * graphic.opacity),
  };

  switch (graphic.anim) {
    case "diam":
      return { ...base, opacity: fmt(graphic.opacity) };
    case "pop":
      // Sedikit melewati 1 lalu kembali — terasa "mendarat", bukan muncul.
      return {
        ...base,
        scale: fmt(0.72 + enter * 0.28 + Math.sin(enter * Math.PI) * 0.06),
      };
    case "apung":
      return {
        ...base,
        scale: fmt(0.9 + enter * 0.1),
        liftFrac: fmt(Math.sin(frame * 0.05) * 0.05),
      };
    case "putar":
      return {
        ...base,
        scale: fmt(0.9 + enter * 0.1),
        rotate: fmt(graphic.rotate + frame * 0.6),
      };
    case "denyut":
      return {
        ...base,
        scale: fmt((0.9 + enter * 0.1) * (1 + Math.sin(frame * 0.12) * 0.045)),
      };
    default:
      return base;
  }
};

/**
 * Gaya CSS penuh untuk satu grafis. `frameHeight` dipakai agar `size` yang
 * berupa fraksi berubah jadi piksel nyata.
 */
export const graphicStyle = (
  graphic: Graphic,
  motion: GraphicMotion,
  frameWidth: number,
  frameHeight: number,
): CSSProperties => {
  const spec = anchorSpec(graphic.anchor);
  const sizePx = fmt(graphic.size * frameHeight);
  const dx = fmt(graphic.offsetX * frameWidth);
  const dy = fmt((graphic.offsetY + motion.liftFrac * graphic.size) * frameHeight);

  return {
    position: "absolute",
    ...(spec.top === null ? {} : { top: spec.top }),
    ...(spec.bottom === null ? {} : { bottom: spec.bottom }),
    ...(spec.left === null ? {} : { left: spec.left }),
    ...(spec.right === null ? {} : { right: spec.right }),
    width: sizePx,
    height: sizePx,
    opacity: motion.opacity,
    // Geseran jangkar dan geseran pengguna digabung dalam SATU translate agar
    // urutannya pasti; scale dan rotate dipisah supaya keduanya berputar pada
    // pusat grafis, bukan pada titik jangkar.
    translate: `calc(${spec.translate.split(" ")[0]} + ${dx}px) calc(${spec.translate.split(" ")[1]} + ${dy}px)`,
    scale: motion.scale,
    rotate: `${motion.rotate}deg`,
  };
};

/** Jendela tampil grafis dalam frame, dari fraksi durasi scene. */
export const graphicWindow = (
  graphic: Graphic,
  durationInFrames: number,
): { from: number; frames: number } => {
  const from = Math.round(graphic.startFrac * durationInFrames);
  const to = Math.round(graphic.endFrac * durationInFrames);
  return { from, frames: Math.max(1, to - from) };
};

/** Apakah rujukan grafis menunjuk ikon Iconify (bukan aset gambar). */
export const isIconRef = (ref: string): boolean => ref.startsWith("iconify:");

/** "iconify:mdi:home" -> "mdi:home"; selain itu null. */
export const iconIdOf = (ref: string): string | null =>
  isIconRef(ref) ? ref.slice("iconify:".length) : null;
