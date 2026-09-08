import type { ScenePlan } from "@dalang/core";
import { computeFrameLayout } from "@dalang/templates/layout";

/**
 * Posisi playhead sebagai fraksi jendela tampil sebuah elemen (ADR-0027).
 *
 * `null` berarti playhead sedang DI LUAR jendela itu — dan pemanggilnya
 * mematikan tombol keyframe karena itu. Menaruh keyframe di waktu yang tidak
 * sedang dilihat orang adalah cara tercepat membuat animasi yang "tidak
 * terjadi": titiknya ada, cuma di detik yang tidak pernah dipandang.
 *
 * Dihitung dari `computeFrameLayout` yang SAMA dengan renderer, bukan dari
 * durasi yang ditaksir ulang di sini — dua rumus panjang scene akan menaruh
 * keyframe di tempat yang berbeda dari tempat ia nanti ter-render.
 */
export const windowProgress = (
  plan: ScenePlan,
  sceneId: string,
  element: { startFrac: number; endFrac: number },
  frame: number,
): number | null => {
  const index = plan.scenes.findIndex((scene) => scene.id === sceneId);
  if (index < 0) return null;
  const layout = computeFrameLayout(plan);
  const sceneStart = layout.sceneStarts[index] ?? 0;
  const sceneFrames = layout.sceneFrames[index] ?? 0;
  if (sceneFrames <= 0) return null;

  const from = sceneStart + Math.round(element.startFrac * sceneFrames);
  const to = sceneStart + Math.round(element.endFrac * sceneFrames);
  const span = to - from;
  if (span <= 0) return null;
  if (frame < from || frame > to) return null;
  return Math.min(1, Math.max(0, (frame - from) / span));
};
