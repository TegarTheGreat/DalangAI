import { DIMENSIONS, type ScenePlan } from "@dalang/core";
import { computeFrameLayout, FPS, sceneSettledFrame } from "@dalang/templates/layout";

/**
 * Metadata Player diturunkan dari plan — logika yang SAMA dengan
 * calculateDalangMetadata renderer (templates/layout), jadi preview dan
 * render tak pernah beda durasi/dimensi.
 */

export interface PlanMeta {
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  sceneStarts: number[];
  /**
   * Frame pertama tiap scene tampil UTUH (transisi masuk selesai). Ke sinilah
   * klik klip melompat: pada `sceneStarts` scene sebelumnya masih menutupi
   * dan renderer pun masih menganggapnya yang aktif.
   */
  sceneSettledStarts: number[];
  sceneFrames: number[];
  totalSec: number;
}

export const planMeta = (plan: ScenePlan): PlanMeta => {
  const layout = computeFrameLayout(plan);
  const { width, height } = DIMENSIONS[plan.meta.aspectRatio];
  return {
    durationInFrames: layout.totalFrames,
    fps: FPS,
    width,
    height,
    sceneStarts: layout.sceneStarts,
    sceneSettledStarts: layout.sceneStarts.map((_, index) =>
      sceneSettledFrame(layout, index),
    ),
    sceneFrames: layout.sceneFrames,
    totalSec: layout.totalFrames / FPS,
  };
};

/** Frame perwakilan sebuah scene untuk thumbnail (lewati transisi masuk). */
export const sceneThumbFrame = (meta: PlanMeta, index: number): number => {
  const start = meta.sceneStarts[index] ?? 0;
  const frames = meta.sceneFrames[index] ?? 1;
  return start + Math.min(24, Math.max(0, Math.floor(frames / 2)));
};
