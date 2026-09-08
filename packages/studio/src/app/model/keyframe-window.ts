import type { ScenePlan } from "@dalang/core";
import { clipFrameSpans, computeFrameLayout } from "@dalang/templates/layout";

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

/**
 * Posisi playhead sebagai fraksi jendela sebuah KLIP (ADR-0036).
 *
 * Jendela klip bukan `startFrac`/`endFrac` melainkan petak yang dihitung
 * `clipFrameSpans` — rumus yang sama dengan yang dipakai ClipStrip saat
 * merender. Scene berklip satu jatuh ke petak tunggal 0..durasi scene, jadi
 * jalurnya cuma satu untuk kedua keadaan.
 */
export const clipProgress = (
  plan: ScenePlan,
  sceneId: string,
  clipId: string,
  frame: number,
): number | null => {
  const index = plan.scenes.findIndex((scene) => scene.id === sceneId);
  const scene = plan.scenes[index];
  if (!scene) return null;
  const layout = computeFrameLayout(plan);
  const sceneStart = layout.sceneStarts[index] ?? 0;
  const sceneFrames = layout.sceneFrames[index] ?? 0;
  if (sceneFrames <= 0) return null;
  const span = clipFrameSpans(scene, sceneFrames).find(
    (candidate) => candidate.id === clipId,
  );
  if (!span || span.frames <= 1) return null;
  const from = sceneStart + span.startFrame;
  const local = frame - from;
  if (local < 0 || local > span.frames - 1) return null;
  return local / (span.frames - 1);
};
