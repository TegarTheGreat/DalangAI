import type { Visual } from "@dalang/core";

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

  const objectPosition = `${(visual.focusX * 100).toFixed(1)}% ${(visual.focusY * 100).toFixed(1)}%`;
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
