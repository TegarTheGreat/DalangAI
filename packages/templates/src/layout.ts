import {
  computeTimeline,
  DIMENSIONS,
  type AspectRatio,
  type ScenePlan,
} from "@dalang/core";

/**
 * Frame-domain layout shared by calculateMetadata and the preset composition.
 * Core resolves durations in seconds (presentation-agnostic); this module
 * quantizes to frames and accounts for crossfade overlap.
 */

export const FPS = 30;

/** ID of the single scene-plan-driven composition registered in Root.tsx. */
export const COMPOSITION_ID = "Dalang";

/** Crossfade length between scenes. Scenes are always longer than this (core clamps to MIN_SCENE_SEC). */
export const TRANSITION_FRAMES = 15;

export interface FrameLayout {
  /** Frames per scene, index-aligned with plan.scenes. */
  sceneFrames: number[];
  /** Global start frame of each scene, transitions overlapped. */
  sceneStarts: number[];
  totalFrames: number;
}

export const computeFrameLayout = (plan: ScenePlan): FrameLayout => {
  const { timings } = computeTimeline(plan);
  const minFrames = TRANSITION_FRAMES * 2 + 6;
  const sceneFrames = timings.map((timing) =>
    Math.max(Math.round(timing.durationSec * FPS), minFrames),
  );

  const sceneStarts: number[] = [];
  let cursor = 0;
  sceneFrames.forEach((frames, index) => {
    sceneStarts.push(cursor);
    cursor += frames;
    if (index < sceneFrames.length - 1) cursor -= TRANSITION_FRAMES;
  });

  return { sceneFrames, sceneStarts, totalFrames: cursor };
};

/** Index of the scene considered "active" at a global frame (transition midpoint rule). */
export const activeSceneIndex = (layout: FrameLayout, frame: number): number => {
  for (let i = layout.sceneStarts.length - 1; i >= 0; i--) {
    const start = layout.sceneStarts[i] ?? 0;
    const threshold = i === 0 ? 0 : start + TRANSITION_FRAMES / 2;
    if (frame >= threshold) return i;
  }
  return 0;
};

export interface AspectMetrics {
  width: number;
  height: number;
  /** Horizontal safe margin in px. */
  marginX: number;
  /** Top safe margin in px. */
  marginTop: number;
  /** Distance of the caption baseline zone from the bottom edge. */
  captionBottom: number;
  captionFontSize: number;
  captionMaxWidth: number;
  titleFontSize: number;
  kickerFontSize: number;
}

export const aspectMetrics = (aspect: AspectRatio): AspectMetrics => {
  const { width, height } = DIMENSIONS[aspect];
  switch (aspect) {
    case "9:16":
      return {
        width,
        height,
        marginX: 84,
        marginTop: 108,
        captionBottom: 316,
        captionFontSize: 56,
        captionMaxWidth: width * 0.82,
        titleFontSize: 124,
        kickerFontSize: 27,
      };
    case "16:9":
      return {
        width,
        height,
        marginX: 112,
        marginTop: 84,
        captionBottom: 118,
        captionFontSize: 52,
        captionMaxWidth: width * 0.62,
        titleFontSize: 132,
        kickerFontSize: 27,
      };
    case "1:1":
      return {
        width,
        height,
        marginX: 88,
        marginTop: 92,
        captionBottom: 176,
        captionFontSize: 50,
        captionMaxWidth: width * 0.8,
        titleFontSize: 108,
        kickerFontSize: 26,
      };
  }
};
