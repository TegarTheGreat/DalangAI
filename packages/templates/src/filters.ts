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
};

export interface FilterCss {
  filter?: string;
  opacity?: number;
}

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
