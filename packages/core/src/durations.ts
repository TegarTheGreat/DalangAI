import type { Scene, ScenePlan, WordTimestamp } from "./scene-plan";

/**
 * Deterministic timing resolution (PRD §7: AI plans, execution is
 * deterministic). Given the same plan + renderState, timings are always
 * identical — no model involved.
 *
 * Rules for `duration: "auto"`:
 *  1. If TTS audio exists for the scene → audio duration + padding.
 *  2. Else → estimate from narration word count (Indonesian conversational
 *     pace ≈ 2.4 words/sec at speed 1.0).
 *  3. Text-free scenes (e.g. template-anim without narration) get a fixed
 *     sensible default.
 */

/** Estimated speaking pace used before TTS has run. */
export const WORDS_PER_SECOND = 2.4;
/** Breathing room appended after the narration ends. */
export const SCENE_PADDING_SEC = 0.7;
/** Silence before the narration starts inside a scene. */
export const NARRATION_LEAD_IN_SEC = 0.25;
export const MIN_SCENE_SEC = 2.2;
/** Duration for narration-less scenes (title cards, dividers). */
export const SILENT_SCENE_SEC = 3;

export const countWords = (text: string): number =>
  text.trim().split(/\s+/).filter(Boolean).length;

export const estimateNarrationSeconds = (
  narration: string,
  speed = 1,
): number => {
  const words = countWords(narration);
  if (words === 0) return 0;
  return words / (WORDS_PER_SECOND * speed);
};

export const resolveSceneDurationSec = (
  scene: Scene,
  plan: ScenePlan,
): number => {
  if (typeof scene.duration === "number") return scene.duration;

  const audio = plan.renderState.narrationAudio[scene.id];
  const speed = plan.audio.voice?.speed ?? 1;
  const narrationSec = audio
    ? audio.durationSec
    : estimateNarrationSeconds(scene.narration, speed);

  if (narrationSec === 0) return SILENT_SCENE_SEC;
  return Math.max(
    MIN_SCENE_SEC,
    NARRATION_LEAD_IN_SEC + narrationSec + SCENE_PADDING_SEC,
  );
};

export interface SceneTiming {
  id: string;
  index: number;
  startSec: number;
  durationSec: number;
}

export interface Timeline {
  timings: SceneTiming[];
  totalSec: number;
}

/**
 * Sequential timeline without transition overlap. Presets that crossfade
 * scenes compute their own overlapped frame layout from these durations.
 */
export const computeTimeline = (plan: ScenePlan): Timeline => {
  let cursor = 0;
  const timings = plan.scenes.map((scene, index) => {
    const durationSec = resolveSceneDurationSec(scene, plan);
    const timing: SceneTiming = {
      id: scene.id,
      index,
      startSec: cursor,
      durationSec,
    };
    cursor += durationSec;
    return timing;
  });
  return { timings, totalSec: cursor };
};

/**
 * Synthetic word timestamps for caption sync before real TTS timestamps exist
 * (or when a provider has none — see R-3). Words are allocated proportionally
 * to their character length across the narration window of the scene.
 * Timestamps are relative to the scene start.
 */
export const estimateWordTimestamps = (
  narration: string,
  sceneDurationSec: number,
): WordTimestamp[] => {
  const words = narration.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const windowStart = NARRATION_LEAD_IN_SEC;
  const windowEnd = Math.max(
    windowStart + 0.5,
    sceneDurationSec - SCENE_PADDING_SEC * 0.5,
  );
  const windowSec = windowEnd - windowStart;

  const weights = words.map((word) => word.length + 1);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  let cursor = windowStart;
  return words.map((word, index) => {
    const share = (weights[index] ?? 1) / totalWeight;
    const startSec = cursor;
    const endSec = index === words.length - 1 ? windowEnd : cursor + share * windowSec;
    cursor = endSec;
    return {
      word,
      startSec: Number(startSec.toFixed(3)),
      endSec: Number(endSec.toFixed(3)),
    };
  });
};
