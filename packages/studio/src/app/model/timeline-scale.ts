import type { PlanMeta } from "./plan-meta";

/**
 * Pemetaan frame <-> piksel untuk timeline editor.
 *
 * Klip digambar BERURUTAN (dengan celah kecil) walau scene aslinya saling
 * tindih 15 frame saat transisi — pemetaan piecewise-linear per scene
 * menjaga playhead & scrub tetap akurat: posisi di dalam klip i =
 * fraksi frame di dalam scene i.
 */

export const CLIP_GAP_PX = 2;

export interface ClipBox {
  x: number;
  w: number;
}

export const clipBoxes = (
  meta: PlanMeta,
  pxPerSec: number,
  minClipPx = 56,
): ClipBox[] => {
  const boxes: ClipBox[] = [];
  let x = 0;
  for (const frames of meta.sceneFrames) {
    const w = Math.max(minClipPx, Math.round((frames / meta.fps) * pxPerSec));
    boxes.push({ x, w });
    x += w + CLIP_GAP_PX;
  }
  return boxes;
};

export const timelineWidth = (boxes: ClipBox[]): number => {
  const last = boxes.at(-1);
  return last ? last.x + last.w : 0;
};

/** Scene aktif untuk sebuah frame (scene terakhir yang sudah mulai). */
const sceneIndexAt = (meta: PlanMeta, frame: number): number => {
  let index = 0;
  for (let i = 0; i < meta.sceneStarts.length; i++) {
    if (frame >= (meta.sceneStarts[i] ?? 0)) index = i;
  }
  return index;
};

export const frameToX = (frame: number, meta: PlanMeta, boxes: ClipBox[]): number => {
  if (boxes.length === 0) return 0;
  const index = sceneIndexAt(meta, frame);
  const box = boxes[index] as ClipBox;
  const start = meta.sceneStarts[index] ?? 0;
  const frames = Math.max(1, meta.sceneFrames[index] ?? 1);
  const fraction = Math.min(1, Math.max(0, (frame - start) / frames));
  return box.x + fraction * box.w;
};

export const xToFrame = (x: number, meta: PlanMeta, boxes: ClipBox[]): number => {
  if (boxes.length === 0) return 0;
  const first = boxes[0] as ClipBox;
  if (x <= first.x) return 0;
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i] as ClipBox;
    const isLast = i === boxes.length - 1;
    const end = box.x + box.w + (isLast ? 0 : CLIP_GAP_PX);
    if (x < end || isLast) {
      const fraction = Math.min(1, Math.max(0, (x - box.x) / box.w));
      const start = meta.sceneStarts[i] ?? 0;
      const frames = meta.sceneFrames[i] ?? 1;
      const frame = Math.round(start + fraction * frames);
      return Math.min(frame, meta.durationInFrames - 1);
    }
  }
  return meta.durationInFrames - 1;
};

/** Frame-frame perwakilan untuk filmstrip sebuah klip. */
export const filmstripFrames = (
  meta: PlanMeta,
  index: number,
  count: number,
): number[] => {
  const start = meta.sceneStarts[index] ?? 0;
  const frames = Math.max(1, meta.sceneFrames[index] ?? 1);
  const n = Math.max(1, count);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    // titik tengah tiap segmen — hindari frame transisi paling tepi
    out.push(start + Math.min(frames - 1, Math.round(((i + 0.5) / n) * frames)));
  }
  return out;
};

/** Posisi tick ruler: minor tiap detik, label tiap `labelEverySec`. */
export const rulerTicks = (
  meta: PlanMeta,
  boxes: ClipBox[],
  labelEverySec = 5,
): { x: number; sec: number; label: boolean }[] => {
  const ticks: { x: number; sec: number; label: boolean }[] = [];
  const totalSec = Math.floor(meta.durationInFrames / meta.fps);
  for (let sec = 0; sec <= totalSec; sec++) {
    ticks.push({
      x: frameToX(sec * meta.fps, meta, boxes),
      sec,
      label: sec % labelEverySec === 0,
    });
  }
  return ticks;
};
