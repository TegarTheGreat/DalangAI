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
 *
 * Jangkar tepi memakai MARGIN AMAN preset, bukan sisipan tetap. Alasannya
 * terlihat di render sungguhan: sisipan datar 4,5% menaruh tempelan kiri-atas
 * tepat menimpa running head. Memakai margin yang sama dengan teks membuat
 * tempelan hidup di dalam kolom aman yang sama — dan ikut menyesuaikan diri
 * tiap rasio, karena margin itu memang sudah berbeda per rasio.
 */

/** Sisi jangkar pada satu sumbu. */
export type AnchorSide = "awal" | "tengah" | "akhir";

export interface AnchorSpec {
  /** Sumbu vertikal: awal = atas, akhir = bawah. */
  vertical: AnchorSide;
  /** Sumbu horizontal: awal = kiri, akhir = kanan. */
  horizontal: AnchorSide;
}

const ANCHORS: Record<GraphicAnchor, AnchorSpec> = {
  "kiri-atas": { vertical: "awal", horizontal: "awal" },
  "tengah-atas": { vertical: "awal", horizontal: "tengah" },
  "kanan-atas": { vertical: "awal", horizontal: "akhir" },
  "kiri-tengah": { vertical: "tengah", horizontal: "awal" },
  tengah: { vertical: "tengah", horizontal: "tengah" },
  "kanan-tengah": { vertical: "tengah", horizontal: "akhir" },
  "kiri-bawah": { vertical: "akhir", horizontal: "awal" },
  "tengah-bawah": { vertical: "akhir", horizontal: "tengah" },
  "kanan-bawah": { vertical: "akhir", horizontal: "akhir" },
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
 * Bingkai tempat grafis dipasang. Sengaja tipe minimal, bukan `AspectMetrics`
 * penuh: model ini murni geometri, dan hanya empat angka itu yang dibutuhkan.
 */
export interface GraphicFrame {
  width: number;
  height: number;
  /** Margin aman kiri/kanan (px) — sama dengan yang dipakai teks preset. */
  marginX: number;
  /** Margin aman atas (px); dipakai juga untuk bawah supaya simetris. */
  marginTop: number;
}

/**
 * Gaya CSS penuh untuk satu grafis. `size` berupa fraksi TINGGI frame, jadi
 * satu nilai bekerja di semua rasio.
 */
export const graphicStyle = (
  graphic: Graphic,
  motion: GraphicMotion,
  frame: GraphicFrame,
): CSSProperties => {
  const spec = anchorSpec(graphic.anchor);
  const sizePx = fmt(graphic.size * frame.height);
  const dx = fmt(graphic.offsetX * frame.width);
  const dy = fmt((graphic.offsetY + motion.liftFrac * graphic.size) * frame.height);

  // Sumbu horizontal: kiri/kanan memakai margin aman; tengah memakai 50% dan
  // menggeser dirinya sendiri setengah lebar.
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
    width: sizePx,
    height: sizePx,
    opacity: motion.opacity,
    // Geseran jangkar dan geseran pengguna digabung dalam SATU translate agar
    // urutannya pasti; scale dan rotate dipisah supaya keduanya berputar pada
    // pusat grafis, bukan pada titik jangkar.
    translate: `calc(${horizontal.shiftX} + ${dx}px) calc(${vertical.shiftY} + ${dy}px)`,
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
