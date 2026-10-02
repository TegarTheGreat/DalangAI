import type { VisualFilter } from "@dalang/core";
import { AbsoluteFill } from "remotion";
import { EFFECT_EPSILON, grainCss, hasOverlayEffect, vignetteCss } from "./filters";

/**
 * Efek yang TIDAK BISA dinyatakan sebagai fungsi `filter` CSS (ADR-0041):
 * vignette dan butiran film.
 *
 * Keduanya digambar sebagai lapisan di atas gambarnya, bukan sebagai filter,
 * karena memang tidak ada fungsi filter yang menggelapkan tepi saja atau
 * menambah noise. Karena itu ia komponen tersendiri yang dipakai KETIGA preset
 * — kalau tiap preset menggambarnya sendiri, ketiganya akan menyimpang, dan
 * yang menyimpang duluan pasti preset yang paling jarang dirender.
 *
 * Tidak merender apa pun saat kedua efeknya mati, jadi plan yang tidak
 * memakainya tidak membayar satu lapisan pun — dan gerbang paritas byte yang
 * menjaga plan lama tetap hijau.
 */
export const ClipEffects: React.FC<{ filter: VisualFilter | undefined }> = ({
  filter,
}) => {
  if (!hasOverlayEffect(filter) || !filter) return null;
  return (
    <>
      {filter.vignette >= EFFECT_EPSILON ? (
        <AbsoluteFill style={vignetteCss(filter.vignette)} />
      ) : null}
      {filter.grain >= EFFECT_EPSILON ? (
        <AbsoluteFill style={grainCss(filter.grain)} />
      ) : null}
    </>
  );
};
