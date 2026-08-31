import type { GraphicAnchor, TextPosition, VideoLayer } from "./scene-plan";
import { GRAPHIC_ANCHORS } from "./scene-plan";

/**
 * Geometri manipulasi langsung di kanvas (ADR-0024, roadmap §9.1).
 *
 * Aritmetikanya hidup di sini — bukan di komponen React — karena ini bagian
 * yang paling mudah salah dan paling mahal kalau salah: satu tanda minus yang
 * keliru membuat tempelan melompat ke sisi berlawanan saat dilepas, dan itu
 * tidak bisa dilihat dari kode, hanya dari tangan. Sebagai fungsi murni,
 * seluruh aturannya bisa diuji sebagai angka.
 *
 * Posisi selalu dinyatakan JANGKAR + geseran fraksional, tidak pernah piksel.
 * Alasannya sama dengan ADR-0018: satu nilai yang sama harus tetap benar di
 * 16:9, 9:16, dan 1:1 — kalau memakai piksel, tiap ganti rasio semua tempelan
 * harus ditata ulang.
 */

/** Titik dalam fraksi bingkai (0-1 dari kiri-atas). */
export interface FramePoint {
  x: number;
  y: number;
}

/** Margin aman preset, dalam FRAKSI lebar/tinggi bingkai. */
export interface SafeInsets {
  x: number;
  y: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Pembulatan agar patch stabil: geseran 0,1234567 hanya menambah derau diff. */
const fmt = (value: number): number => Number(value.toFixed(4));

/**
 * Tiga titik jangkar pada satu sumbu, dalam fraksi.
 *
 * Tepi memakai MARGIN AMAN, bukan 0 dan 1: itu tempat yang sama dengan yang
 * dipakai preset menaruh teks dan grafis, jadi menyeret sesuatu "ke pinggir"
 * mendaratkannya di kolom aman yang sama — bukan menempel di tepi layar.
 */
export const anchorBases = (safe: number): [number, number, number] => [
  safe,
  0.5,
  1 - safe,
];

/** Indeks jangkar terdekat pada satu sumbu, plus sisa geserannya. */
const nearestOnAxis = (
  value: number,
  safe: number,
): { index: 0 | 1 | 2; offset: number } => {
  const bases = anchorBases(safe);
  let index: 0 | 1 | 2 = 0;
  let best = Number.POSITIVE_INFINITY;
  ([0, 1, 2] as const).forEach((candidate) => {
    const distance = Math.abs(value - (bases[candidate] as number));
    if (distance < best) {
      best = distance;
      index = candidate;
    }
  });
  return { index, offset: value - (bases[index] as number) };
};

export interface GraphicPlacement {
  anchor: GraphicAnchor;
  offsetX: number;
  offsetY: number;
}

/**
 * Titik jatuh -> jangkar + geseran untuk GRAFIS.
 *
 * Jangkarnya dipilih ulang, tidak dipertahankan. Kalau tidak: menyeret
 * tempelan dari kanan-bawah ke kiri-atas butuh geseran hampir -1, sementara
 * skema membatasi geseran di ±0,5 — jadi tempelannya akan berhenti di
 * tengah jalan tanpa alasan yang bisa dilihat pengguna.
 */
export const placeGraphic = (point: FramePoint, safe: SafeInsets): GraphicPlacement => {
  const horizontal = nearestOnAxis(clamp(point.x, 0, 1), safe.x);
  const vertical = nearestOnAxis(clamp(point.y, 0, 1), safe.y);
  // Urutan GRAPHIC_ANCHORS: baris atas, tengah, bawah; tiap baris kiri→kanan.
  const anchor = GRAPHIC_ANCHORS[vertical.index * 3 + horizontal.index] as GraphicAnchor;
  return {
    anchor,
    offsetX: fmt(clamp(horizontal.offset, -0.5, 0.5)),
    offsetY: fmt(clamp(vertical.offset, -0.5, 0.5)),
  };
};

export interface TextPlacement {
  position: TextPosition;
  offsetX: number;
  offsetY: number;
}

const TEXT_POSITION_BY_INDEX: readonly TextPosition[] = ["top", "center", "bottom"];

/**
 * Titik jatuh -> posisi + geseran untuk TEKS.
 *
 * `align` sengaja TIDAK ikut berubah saat diseret. Perataan adalah keputusan
 * tipografi (rata kiri, tengah, kanan di dalam kolomnya), bukan keputusan
 * letak — dan mengubahnya diam-diam saat orang menggeser blok teks akan
 * mengubah rupa paragrafnya tanpa diminta.
 */
export const placeText = (point: FramePoint, safe: SafeInsets): TextPlacement => {
  const horizontal = nearestOnAxis(clamp(point.x, 0, 1), safe.x);
  const vertical = nearestOnAxis(clamp(point.y, 0, 1), safe.y);
  return {
    position: TEXT_POSITION_BY_INDEX[vertical.index] as TextPosition,
    offsetX: fmt(clamp(horizontal.offset, -0.5, 0.5)),
    offsetY: fmt(clamp(vertical.offset, -0.5, 0.5)),
  };
};

/** Garis bantu yang bisa ditempeli saat menyeret, dalam fraksi. */
export interface SnapLines {
  x: number[];
  y: number[];
}

export const snapLinesFor = (safe: SafeInsets): SnapLines => ({
  x: anchorBases(safe.x),
  y: anchorBases(safe.y),
});

/**
 * Menempelkan satu nilai ke garis bantu terdekat bila jaraknya di dalam
 * `threshold`; kalau tidak, nilainya lewat apa adanya.
 *
 * Ambangnya dalam FRAKSI, bukan piksel, supaya rasa menempelnya sama di
 * jendela kecil dan besar — di piksel, preview 320px akan terasa lengket
 * sementara preview 900px terasa licin.
 */
export const snapToLines = (
  value: number,
  lines: number[],
  threshold: number,
): number => {
  let best = value;
  let bestDistance = threshold;
  for (const line of lines) {
    const distance = Math.abs(value - line);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = line;
    }
  }
  return best;
};

/** Garis bantu yang SEDANG menempel, untuk digambar sebagai panduan. */
export const activeSnapLines = (
  point: FramePoint,
  lines: SnapLines,
  threshold: number,
): SnapLines => ({
  x: lines.x.filter((line) => Math.abs(point.x - line) < threshold),
  y: lines.y.filter((line) => Math.abs(point.y - line) < threshold),
});

/**
 * Kotak satu LAPISAN video (ADR-0025) sebagai fraksi bingkai: kiri-atas,
 * lebar, tinggi.
 *
 * Ada di sini, bukan di preset, karena lapisan manipulasi langsung butuh tahu
 * di mana kotaknya SEBELUM ada yang menggambarnya — saat lapisan baru dibuat
 * dan asetnya belum ter-resolve, tidak ada elemen DOM untuk diukur. Rumusnya
 * mengikuti jangkar yang sama dengan `layerBoxStyle` di paket templates.
 */
export const layerRect = (
  layer: Pick<VideoLayer, "anchor" | "width" | "height" | "offsetX" | "offsetY">,
  safe: SafeInsets,
): { x: number; y: number; width: number; height: number } => {
  const index = GRAPHIC_ANCHORS.indexOf(layer.anchor);
  const column = index % 3;
  const row = Math.floor(index / 3);
  const left =
    column === 0
      ? safe.x
      : column === 2
        ? 1 - safe.x - layer.width
        : 0.5 - layer.width / 2;
  const top =
    row === 0 ? safe.y : row === 2 ? 1 - safe.y - layer.height : 0.5 - layer.height / 2;
  return {
    x: fmt(left + layer.offsetX),
    y: fmt(top + layer.offsetY),
    width: layer.width,
    height: layer.height,
  };
};

/**
 * Kebalikan `layerRect`: kotak (kiri-atas + ukuran) -> jangkar + geseran.
 *
 * Dipakai saat sebuah lapisan diseret atau diubah ukurannya di kanvas. Sama
 * seperti teks dan grafis, jangkarnya DIPILIH ULANG dari titik pusat kotak —
 * bukan dipertahankan — supaya menyeret dari satu sudut ke sudut seberangnya
 * tidak menabrak batas geseran ±0,5.
 */
export const placeLayer = (
  rect: { x: number; y: number; width: number; height: number },
  safe: SafeInsets,
): { anchor: GraphicAnchor; offsetX: number; offsetY: number } => {
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const horizontal = nearestOnAxis(clamp(center.x, 0, 1), safe.x);
  const vertical = nearestOnAxis(clamp(center.y, 0, 1), safe.y);
  const anchor = GRAPHIC_ANCHORS[vertical.index * 3 + horizontal.index] as GraphicAnchor;
  // Geserannya diukur dari POSISI KOTAK yang dituntut jangkar itu, bukan dari
  // pusatnya: `layerRect` menempatkan tepi kiri di margin aman untuk jangkar
  // kiri, jadi memakai selisih pusat akan menggeser kotak sebesar setengah
  // lebarnya pada setiap penempatan.
  const base = layerRect(
    { anchor, width: rect.width, height: rect.height, offsetX: 0, offsetY: 0 },
    safe,
  );
  return {
    anchor,
    offsetX: fmt(clamp(rect.x - base.x, -0.5, 0.5)),
    offsetY: fmt(clamp(rect.y - base.y, -0.5, 0.5)),
  };
};
