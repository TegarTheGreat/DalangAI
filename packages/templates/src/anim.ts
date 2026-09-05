import { Easing, interpolate } from "remotion";

/**
 * Util animasi bersama (ADR-0015) — SATU bahasa gerak untuk semua preset.
 * Semua kurva dinamai berdasarkan rasa, bukan angka bezier, supaya pemakaian
 * di komponen terbaca sebagai keputusan sutradara.
 */

/** Settle lembut di akhir — masuknya elemen (teks, chip, kartu). */
export const easeSettle = Easing.bezier(0.16, 1, 0.3, 1);
/** Lambat-cepat-lambat — transisi & gerak kamera. */
export const easeGlide = Easing.bezier(0.45, 0.05, 0.25, 1);
/** Dolly halus — Ken Burns / pan. */
export const easeDolly = Easing.bezier(0.33, 0, 0.25, 1);

export type Keyframe = readonly [frame: number, value: number];

/**
 * Interpolasi keyframe piecewise dengan satu easing per segmen, di-clamp di
 * kedua ujung. Frame keyframe harus menaik; nilai di luar rentang memakai
 * nilai ujung (tanpa ekstrapolasi — deterministik dan aman).
 */
export const kf = (
  frame: number,
  keyframes: readonly Keyframe[],
  easing: (t: number) => number = easeSettle,
): number => {
  if (keyframes.length === 0) return 0;
  const first = keyframes[0] as Keyframe;
  const last = keyframes[keyframes.length - 1] as Keyframe;
  if (keyframes.length === 1 || frame <= first[0]) return first[1];
  if (frame >= last[0]) return last[1];
  for (let i = 1; i < keyframes.length; i++) {
    const [f1, v1] = keyframes[i] as Keyframe;
    const [f0, v0] = keyframes[i - 1] as Keyframe;
    if (frame <= f1) {
      return interpolate(frame, [f0, f1], [v0, v1], {
        easing,
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    }
  }
  return last[1];
};

/**
 * Jendela masuk-keluar standar: 0→1 selama `enterFrames`, 1→0 pada
 * `exitFrames` terakhir sebelum `end`; keduanya ber-easing settle.
 */
export const enterExit = (
  frame: number,
  start: number,
  end: number,
  enterFrames: number,
  exitFrames: number,
): { progress: number; opacity: number } => {
  const enter = kf(frame, [
    [start, 0],
    [start + enterFrames, 1],
  ]);
  const exit = kf(
    frame,
    [
      [end - exitFrames, 1],
      [end, 0],
    ],
    easeGlide,
  );
  return { progress: enter, opacity: Math.min(enter, exit) };
};
