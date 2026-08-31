import type { ScenePlan } from "./scene-plan";

/**
 * Penamaan id grafis & cue efek suara (ADR-0018).
 *
 * KENAPA SE-PLAN, BUKAN SE-SCENE. `renderState.graphicAssets` dan
 * `renderState.sfxAssets` dikunci per id grafis/cue untuk SELURUH plan.
 * Penomoran per scene ("...-1" di setiap scene) karenanya membuat dua scene
 * berbagi satu entri berkas: ikon yang sama dengan warna berbeda saling
 * menimpa, dan menghapus salah satunya mencabut berkas milik yang lain.
 * Keduanya tidak terlihat di UI sampai video dirender.
 */

/** Slug aman untuk dijadikan bagian id: huruf, angka, tanda hubung. */
export const idSlug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "aset";

const unique = (taken: ReadonlySet<string>, base: string): string => {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
};

/** Id grafis yang belum dipakai scene mana pun MAUPUN renderState. */
export const uniqueGraphicId = (plan: ScenePlan, base: string): string =>
  unique(
    new Set([
      ...plan.scenes.flatMap((scene) => scene.graphics.map((graphic) => graphic.id)),
      ...Object.keys(plan.renderState.graphicAssets),
    ]),
    idSlug(base),
  );

/** Id cue efek suara yang belum dipakai plan MAUPUN renderState. */
export const uniqueSfxCueId = (plan: ScenePlan, base: string): string =>
  unique(
    new Set([
      ...plan.audio.sfx.map((cue) => cue.id),
      ...Object.keys(plan.renderState.sfxAssets),
    ]),
    idSlug(base),
  );

/** Id lapisan video yang belum dipakai plan MAUPUN renderState (ADR-0025). */
export const uniqueLayerId = (plan: ScenePlan, base: string): string =>
  unique(
    new Set([
      ...plan.scenes.flatMap((scene) => scene.layers.map((layer) => layer.id)),
      ...Object.keys(plan.renderState.layerAssets),
    ]),
    idSlug(base),
  );
