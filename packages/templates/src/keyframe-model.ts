import type { AnimatableProperty, KeyframeEasing, KeyframeTrack } from "@dalang/core";
import { interpolate } from "remotion";
import { easeDolly, easeGlide, easeSettle } from "./anim";

/**
 * Evaluasi track keyframe (ADR-0027, roadmap §9.3).
 *
 * Murni: masuk track + kemajuan 0-1, keluar satu angka. Tidak menyentuh React
 * maupun Remotion selain `interpolate`, jadi seluruh aturannya bisa diuji
 * sebagai angka — bukan diperiksa dengan mata di video, tempat gerak yang
 * meleset paling mudah lolos.
 */

/**
 * Nama easing -> kurva. Nama, bukan empat angka bezier, supaya plan tetap
 * terbaca dan bahasa geraknya sama dengan preset (ADR-0015).
 */
export const KEYFRAME_EASING_FN: Record<KeyframeEasing, (t: number) => number> = {
  settle: easeSettle,
  glide: easeGlide,
  dolly: easeDolly,
  // Linear memang kadang yang benar: gerak konstan (putaran, ticker) terlihat
  // salah kalau diberi percepatan.
  linear: (t) => t,
};

/**
 * Nilai sebuah track pada kemajuan `progress` (0 = elemen muncul, 1 = hilang).
 *
 * Di luar titik pertama/terakhir nilainya DITAHAN, bukan diekstrapolasi.
 * Ekstrapolasi akan membawa properti ke luar rentang sahnya sendiri pada
 * frame-frame di tepi — persis hal yang dijaga skema saat menulis.
 */
export const trackValue = (track: KeyframeTrack, progress: number): number => {
  const points = track.points;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return 0;
  if (progress <= first.at) return first.value;
  if (progress >= last.at) return last.value;

  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    if (!from || !to) break;
    if (progress <= to.at) {
      // Easing diambil dari titik yang MEMULAI segmen: ia yang menggambarkan
      // bagaimana nilai bergerak meninggalkan titik itu.
      return interpolate(progress, [from.at, to.at], [from.value, to.value], {
        easing: KEYFRAME_EASING_FN[from.easing],
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    }
  }
  return last.value;
};

export type TrackValues = Partial<Record<AnimatableProperty, number>>;

/**
 * Nilai SEMUA track sebuah elemen pada satu kemajuan.
 *
 * Yang tidak punya track sengaja TIDAK muncul di hasilnya — bukan diisi nilai
 * bawaan. Pemanggilnya membedakan "dianimasikan" dari "tidak" dengan `??`,
 * dan itu satu-satunya cara aturan "track menang penuh atas preset" bisa
 * ditulis tanpa mengetahui nilai preset di sini.
 */
export const evaluateTracks = (
  tracks: readonly KeyframeTrack[],
  progress: number,
): TrackValues => {
  const out: TrackValues = {};
  for (const track of tracks) out[track.property] = trackValue(track, progress);
  return out;
};

/**
 * Kemajuan 0-1 sebuah elemen dari frame LOKAL jendelanya.
 *
 * Jendela sepanjang 1 frame akan membagi nol; hasilnya dipatok 0 supaya
 * elemen sependek itu memakai nilai keyframe pertamanya, bukan NaN yang
 * menjalar ke seluruh gaya CSS-nya dan membuat elemennya hilang tanpa jejak.
 */
export const trackProgress = (frame: number, windowFrames: number): number =>
  windowFrames <= 1 ? 0 : Math.min(1, Math.max(0, frame / (windowFrames - 1)));

/** Apakah properti ini dikendalikan track (dan karena itu preset diabaikan). */
export const isAnimated = (
  tracks: readonly KeyframeTrack[],
  property: AnimatableProperty,
): boolean => tracks.some((track) => track.property === property);
