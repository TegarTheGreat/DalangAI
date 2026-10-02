import type { VisualFilter } from "@dalang/core";

/**
 * ADR-0011: filter visual scene → CSS. Murni & diuji unit; dipakai Backdrop
 * di Player DAN renderer (satu sumber kebenaran tampilan).
 *
 * Hidup di akar paket, bukan di dalam satu preset: filter adalah kontrak data
 * §5.1 yang berlaku untuk semua gaya, dan sejak ADR-0025 lapisan video juga
 * memakainya — lapisan berlaku di KEDUA preset.
 */

const PRESET_CSS: Record<string, string[]> = {
  none: [],
  warm: ["sepia(0.18)", "saturate(1.15)", "hue-rotate(-8deg)", "brightness(1.03)"],
  cool: ["saturate(1.05)", "hue-rotate(9deg)", "brightness(1.01)", "contrast(1.03)"],
  mono: ["grayscale(1)", "contrast(1.06)"],
  vivid: ["saturate(1.45)", "contrast(1.08)"],
  film: ["sepia(0.12)", "contrast(1.12)", "brightness(0.97)", "saturate(0.9)"],
  // ADR-0041. Kelimanya murni fungsi filter CSS, jadi preview Player dan
  // render final tetap satu sumber kebenaran — sama seperti enam yang lama.
  noir: ["grayscale(1)", "contrast(1.5)", "brightness(0.92)"],
  senja: ["sepia(0.3)", "saturate(1.3)", "hue-rotate(-18deg)", "brightness(1.05)"],
  malam: ["saturate(0.75)", "hue-rotate(18deg)", "brightness(0.78)", "contrast(1.12)"],
  pudar: ["saturate(0.7)", "contrast(0.85)", "brightness(1.08)", "sepia(0.08)"],
  pastel: ["saturate(0.85)", "brightness(1.12)", "contrast(0.92)", "sepia(0.06)"],
};

/**
 * Ambang di bawah mana sebuah efek dianggap MATI (ADR-0041).
 *
 * Bukan `> 0`: nilai 0,004 yang tersisa dari slider yang diseret balik akan
 * tetap memasang lapisan penuh bingkai yang tidak terlihat sama sekali — dan
 * lapisan yang tidak terlihat tetap dibayar tiap bingkai oleh compositor.
 */
export const EFFECT_EPSILON = 0.01;

export interface FilterCss {
  filter?: string;
  opacity?: number;
}

/** True kalau filter ini butuh lapisan gambar tambahan (vignette/grain). */
export const hasOverlayEffect = (filter: VisualFilter | undefined): boolean =>
  filter !== undefined &&
  (filter.vignette >= EFFECT_EPSILON || filter.grain >= EFFECT_EPSILON);

/**
 * CSS lapisan VIGNETTE — gradien radial gelap di tepi.
 *
 * Kekuatan memetakan ke opasitas tepi, BUKAN ke jari-jari: vignette yang
 * jari-jarinya berubah akan memotong subjek di tengah pada nilai tinggi,
 * sedangkan yang opasitasnya berubah cuma menggelapkan sudut — yang memang
 * gunanya.
 */
export const vignetteCss = (strength: number): Record<string, string> => ({
  background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 38%, rgba(0,0,0,${(
    strength * 0.85
  ).toFixed(3)}) 100%)`,
});

/**
 * CSS lapisan BUTIRAN — noise SVG ber-seed tetap.
 *
 * `feTurbulence` dengan seed tetap menghasilkan pola yang SAMA di tiap
 * bingkai. Itu disengaja: butiran yang berubah tiap bingkai terlihat seperti
 * kompresi rusak, bukan seperti film — dan ia juga menghancurkan efisiensi
 * enkode video, karena tiap bingkai jadi berbeda dari tetangganya.
 */
export const grainCss = (strength: number): Record<string, string> => {
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'>" +
    "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' " +
    "numOctaves='3' stitchTiles='stitch' seed='7'/></filter>" +
    "<rect width='180' height='180' filter='url(#n)'/></svg>";
  return {
    backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`,
    backgroundRepeat: "repeat",
    opacity: String(Number((strength * 0.34).toFixed(3))),
    mixBlendMode: "overlay",
  };
};

export const filterToCss = (filter: VisualFilter | undefined): FilterCss => {
  if (!filter) return {};
  const parts = [...(PRESET_CSS[filter.preset] ?? [])];
  if (filter.brightness !== 1) parts.push(`brightness(${filter.brightness})`);
  if (filter.contrast !== 1) parts.push(`contrast(${filter.contrast})`);
  if (filter.saturation !== 1) parts.push(`saturate(${filter.saturation})`);
  if (filter.blur > 0) parts.push(`blur(${filter.blur}px)`);
  return {
    ...(parts.length > 0 ? { filter: parts.join(" ") } : {}),
    ...(filter.opacity !== 1 ? { opacity: filter.opacity } : {}),
  };
};
