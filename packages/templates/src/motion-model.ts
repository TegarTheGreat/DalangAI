import type { Clip, Visual } from "@dalang/core";
import { interpolate } from "remotion";
import { easeDolly } from "./anim";
import { evaluateTracks, isAnimated, trackProgress } from "./keyframe-model";

/**
 * ADR-0015: matematika gerak kamera aset — murni & diuji unit, dipakai
 * Backdrop di Player DAN renderer. `progress` sudah ber-easing (0-1).
 * flipH dibalik lewat komponen-x properti `scale` ("x y"); titik fokus
 * memilih bagian gambar yang dipertahankan crop `cover`.
 */

export interface MotionTransform {
  /** Nilai properti CSS `scale` ("s" atau "x y"), atau undefined. */
  scale?: string;
  /** Nilai properti CSS `translate`, atau undefined. */
  translate?: string;
  objectPosition: string;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Buang noise float supaya nilai CSS deterministik & terbaca. */
const fmt = (n: number): string => String(Number(n.toFixed(4)));

/** Titik gambar yang dipertahankan crop `cover`. */
const focusPosition = (visual: Pick<Visual, "focusX" | "focusY">): string =>
  `${(visual.focusX * 100).toFixed(1)}% ${(visual.focusY * 100).toFixed(1)}%`;

export const motionTransform = (
  visual: Pick<Visual, "motion" | "flipH" | "focusX" | "focusY">,
  progress: number,
): MotionTransform => {
  let scale: number | undefined;
  let translate: string | undefined;

  switch (visual.motion) {
    case "kenburns-in":
      scale = 1.03 + progress * 0.1;
      break;
    case "kenburns-out":
      scale = 1.13 - progress * 0.1;
      break;
    case "pan-left":
      scale = 1.1;
      translate = `${lerp(2.2, -2.2, progress)}% 0%`;
      break;
    case "pan-right":
      scale = 1.1;
      translate = `${lerp(-2.2, 2.2, progress)}% 0%`;
      break;
    case "pan-up":
      scale = 1.1;
      translate = `0% ${lerp(2.2, -2.2, progress)}%`;
      break;
    case "pan-down":
      scale = 1.1;
      translate = `0% ${lerp(-2.2, 2.2, progress)}%`;
      break;
    case "drift": {
      // Setengah orbit pelan: mulai kanan, melengkung lewat bawah, berakhir kiri.
      const angle = progress * Math.PI;
      scale = 1.08;
      translate = `${(Math.cos(angle) * 1.2).toFixed(3)}% ${(Math.sin(angle) * 0.8).toFixed(3)}%`;
      break;
    }
    case "none":
      break;
  }

  const objectPosition = focusPosition(visual);
  if (visual.flipH) {
    const s = scale ?? 1;
    return {
      scale: `${fmt(-s)} ${fmt(s)}`,
      ...(translate ? { translate } : {}),
      objectPosition,
    };
  }
  return {
    ...(scale !== undefined ? { scale: fmt(scale) } : {}),
    ...(translate ? { translate } : {}),
    objectPosition,
  };
};

/**
 * Properti yang membentuk JALUR KAMERA. Sisanya (`opacity`) tidak.
 *
 * Pemisahan ini yang menentukan kapan preset `motion` masih berlaku — lihat
 * `clipCamera`.
 */
export const CAMERA_PROPERTIES = ["zoom", "offsetX", "offsetY"] as const;

export interface ClipCamera extends MotionTransform {
  /**
   * Opasitas dari track, atau `undefined` kalau tidak ada track opasitas.
   *
   * `undefined`, BUKAN 1 — sama seperti `evaluateTracks` sengaja tidak
   * mengisi properti yang tidak di-track. Opasitas statis visual dasar hidup
   * di `filter.opacity` (ADR-0011), dan pemanggil harus bisa membedakan
   * "track menyuruh penuh" dari "tidak ada track, pakai filternya". Kalau
   * fungsi ini mengembalikan 1, setiap klip berfilter transparan akan
   * mendadak menjadi legap.
   */
  opacity: number | undefined;
  /** Jalur kameranya datang dari keyframe, bukan dari preset `motion`. */
  keyed: boolean;
}

/**
 * Kamera visual dasar sebuah klip pada satu frame (ADR-0036).
 *
 * Aturannya BERBEDA dari grafis dan lapisan, dan bedanya disengaja. Di sana
 * tiap properti berdiri sendiri, jadi satu track hanya mengambil alih satu
 * properti. Di sini `motion` bukan kumpulan properti melainkan SATU gerakan
 * kamera bernama: "pan-left" adalah skala 1,1 DAN geseran 2,2% yang diputuskan
 * bersama. Membiarkan satu track mengambil alih separuhnya menghasilkan gerak
 * yang bukan preset dan bukan pula yang digambar keyframe — dan tidak ada yang
 * bisa menebak bentuknya dari plan.
 *
 * Jadi: begitu SALAH SATU properti kamera punya track, seluruh jalur kamera
 * jadi milik keyframe dan preset diabaikan. `opacity` berdiri di luar itu —
 * ia tidak menggerakkan kamera, jadi memberinya track tidak merenggut gerak
 * yang sudah dipilih orang.
 *
 * `flipH` dan titik fokus tetap berlaku: keduanya PEMBINGKAIAN, bukan gerak.
 */
export const clipCamera = (
  clip: Pick<Clip, "motion" | "flipH" | "focusX" | "focusY" | "tracks">,
  frame: number,
  durationInFrames: number,
): ClipCamera => {
  // Jam keyframe LINEAR, jam preset ber-easing. Bukan kelalaian: tiap segmen
  // keyframe sudah membawa easing-nya sendiri, dan melewatkannya lewat
  // easeDolly berarti mengenakan easing dua kali — "linear" pun akan
  // melambat di ujung, dan tidak akan ada satu pun tempat di plan yang
  // menjelaskan kenapa.
  const animated = evaluateTracks(clip.tracks, trackProgress(frame, durationInFrames));
  const opacity = animated.opacity;

  if (!CAMERA_PROPERTIES.some((property) => isAnimated(clip.tracks, property))) {
    const progress = interpolate(frame, [0, Math.max(durationInFrames, 1)], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: easeDolly,
    });
    return { ...motionTransform(clip, progress), opacity, keyed: false };
  }

  // Properti kamera yang tidak di-track duduk di NETRAL, bukan di nilai
  // presetnya: preset sudah diabaikan seluruhnya di cabang ini.
  const zoom = animated.zoom ?? 1;
  const x = animated.offsetX ?? 0;
  const y = animated.offsetY ?? 0;
  return {
    scale: clip.flipH ? `${fmt(-zoom)} ${fmt(zoom)}` : fmt(zoom),
    translate: `${fmt(x * 100)}% ${fmt(y * 100)}%`,
    objectPosition: focusPosition(clip),
    opacity,
    keyed: true,
  };
};
