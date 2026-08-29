import { DIMENSIONS, type ScenePlan } from "@dalang/core";
import { computeFrameLayout, FPS } from "@dalang/templates/layout";

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
