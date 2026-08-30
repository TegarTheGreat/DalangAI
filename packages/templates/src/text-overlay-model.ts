import type { TextOverlay } from "@dalang/core";

/**
 * ADR-0013: semantik gaya teks overlay yang SAMA lintas preset — faktor
 * ukuran, perataan, dan penekanan. Warna/latar konkretnya milik theme
 * masing-masing preset.
 */

export const TEXT_SIZE_FACTOR: Record<TextOverlay["size"], number> = {
  s: 0.78,
  m: 1,
  l: 1.3,
};

/**
 * Gaya perataan horizontal. `container` untuk kontainer satu-teks
 * (alignItems), `self` untuk anak flex saat beberapa teks berbagi posisi
 * (alignSelf per teks), `block` untuk blok teksnya sendiri.
 */
export const alignStyles = (
  align: TextOverlay["align"],
): {
  container: React.CSSProperties;
  self: React.CSSProperties;
  block: React.CSSProperties;
} => {
  switch (align) {
    case "left":
      return {
        container: { alignItems: "flex-start" },
        self: { alignSelf: "flex-start" },
        block: { textAlign: "left", textWrap: "pretty" },
      };
    case "right":
      return {
        container: { alignItems: "flex-end" },
        self: { alignSelf: "flex-end" },
        block: { textAlign: "right", textWrap: "pretty" },
      };
    case "center":
      return {
        container: { alignItems: "center" },
        self: { alignSelf: "center" },
        block: { textAlign: "center" },
      };
  }
};

/** Urutan tetap posisi vertikal untuk pengelompokan teks per posisi. */
export const TEXT_POSITIONS: readonly TextOverlay["position"][] = [
  "top",
  "center",
  "bottom",
] as const;

export interface EmphasisPalette {
  /** Latar chip untuk emphasis "box". */
  boxBg: string;
  /** Warna teks di atas chip (kosong = warisi warna peran). */
  boxInk?: string;
  /** Warna garis untuk emphasis "underline". */
  accent: string;
}

export const emphasisStyle = (
  emphasis: TextOverlay["emphasis"],
  palette: EmphasisPalette,
): React.CSSProperties => {
  switch (emphasis) {
    case "box":
      return {
        background: palette.boxBg,
        ...(palette.boxInk ? { color: palette.boxInk } : {}),
        padding: "0.32em 0.75em",
        borderRadius: "0.28em",
        textShadow: "none",
        boxDecorationBreak: "clone",
        WebkitBoxDecorationBreak: "clone",
      };
    case "underline":
      return {
        paddingBottom: "0.14em",
        borderBottom: `0.09em solid ${palette.accent}`,
      };
    case "none":
      return {};
  }
};
