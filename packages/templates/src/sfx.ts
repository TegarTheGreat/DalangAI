import type { ScenePlan } from "@dalang/core";
import type { FrameLayout } from "./layout";

/**
 * Penempatan efek suara pada garis waktu render (ADR-0018).
 *
 * Cue ditulis relatif terhadap SCENE ("1,5 detik setelah scene b mulai"),
 * bukan terhadap garis waktu global. Fungsi ini yang menerjemahkannya jadi
 * frame absolut. Akibatnya menggeser, memotong, atau memanjangkan scene
 * membuat bunyinya ikut pindah tanpa satu pun angka perlu disunting ulang —
 * dan cue yang scene-nya sudah dihapus otomatis hilang, tidak jadi yatim.
 *
 * Murni: hanya angka, jadi bisa diuji tanpa merender.
 */

export interface PlacedSfx {
  cueId: string;
  /** Berkas relatif terhadap public dir render. */
  file: string;
  /** Frame absolut mulai berbunyi. */
  fromFrame: number;
  volume: number;
}

export const placeSfxCues = (
  plan: ScenePlan,
  layout: FrameLayout,
  fps: number,
): PlacedSfx[] => {
  const startOf = new Map<string, number>();
  plan.scenes.forEach((scene, index) => {
    startOf.set(scene.id, layout.sceneStarts[index] ?? 0);
  });

  const placed: PlacedSfx[] = [];
  for (const cue of plan.audio.sfx) {
    const sceneStart = startOf.get(cue.sceneId);
    // Cue yatim (scene-nya sudah tidak ada) dilewati diam-diam: plan tetap
    // sah, render tetap jalan, dan Studio yang menampilkan statusnya.
    if (sceneStart === undefined) continue;
    const asset = plan.renderState.sfxAssets[cue.id];
    if (!asset) continue;
    placed.push({
      cueId: cue.id,
      file: asset.file,
      fromFrame: sceneStart + Math.round(cue.atSec * fps),
      volume: cue.volume,
    });
  }
  return placed;
};
