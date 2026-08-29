import {
  estimateWordTimestamps,
  NARRATION_LEAD_IN_SEC,
  narrationWindowSec,
  type Scene,
  type ScenePlan,
  type WordTimestamp,
} from "@dalang/core";
import {
  createTikTokStyleCaptions,
  type Caption as RemotionCaption,
} from "@remotion/captions";

/**
 * Pure caption timing model — no React, fully unit-tested.
 *
 * Word timestamps are audio-relative (0-based, see the core contract). This
 * module owns the placement inside the scene: everything is shifted by the
 * narration lead-in, identically for real TTS timestamps and for the
 * deterministic estimate — so swapping the estimate for real TTS output in
 * Fase 1 changes timing fidelity, never the code path.
 */

export const PAGE_COMBINE_MS = 1100;
/** How long the last page lingers after the narration ends. */
export const LAST_PAGE_HOLD_FRAMES = 14;

export interface CaptionToken {
  text: string;
  /** Scene-relative milliseconds. */
  fromMs: number;
  toMs: number;
}

export interface CaptionPageModel {
  /** Scene-relative frame the page appears on. */
  startFrame: number;
  durationInFrames: number;
  /** Scene-relative milliseconds — compare against elapsed scene time. */
  startMs: number;
  tokens: CaptionToken[];
}

const toRemotionCaptions = (
  words: WordTimestamp[],
  offsetMs: number,
): RemotionCaption[] =>
  words.map((word, index) => ({
    text: `${index === 0 ? "" : " "}${word.word}`,
    startMs: word.startSec * 1000 + offsetMs,
    endMs: word.endSec * 1000 + offsetMs,
    timestampMs: ((word.startSec + word.endSec) / 2) * 1000 + offsetMs,
    confidence: null,
  }));

export const buildCaptionPages = ({
  scene,
  plan,
  sceneDurationFrames,
  fps,
}: {
  scene: Scene;
  plan: ScenePlan;
  sceneDurationFrames: number;
  fps: number;
}): CaptionPageModel[] => {
  if (!scene.caption.enabled || scene.narration.trim() === "") return [];

  const real = plan.renderState.narrationAudio[scene.id]?.wordTimestamps;
  const words =
    real && real.length > 0
      ? real
      : estimateWordTimestamps(
          scene.narration,
          narrationWindowSec(sceneDurationFrames / fps),
        );

  const offsetMs = NARRATION_LEAD_IN_SEC * 1000;
  const { pages } = createTikTokStyleCaptions({
    captions: toRemotionCaptions(words, offsetMs),
    combineTokensWithinMilliseconds: PAGE_COMBINE_MS,
  });

  const models: CaptionPageModel[] = [];
  pages.forEach((page, index) => {
    const next = pages[index + 1];
    const startFrame = Math.round((page.startMs / 1000) * fps);
    const endFrame = next
      ? Math.round((next.startMs / 1000) * fps)
      : Math.min(
          Math.round(((page.startMs + page.durationMs) / 1000) * fps) +
            LAST_PAGE_HOLD_FRAMES,
          sceneDurationFrames,
        );
    const durationInFrames = Math.min(endFrame, sceneDurationFrames) - startFrame;
    if (durationInFrames <= 0 || startFrame >= sceneDurationFrames) return;
    models.push({
      startFrame,
      durationInFrames,
      startMs: page.startMs,
      tokens: page.tokens.map((token) => ({
        text: token.text,
        fromMs: token.fromMs,
        toMs: token.toMs,
      })),
    });
  });
  return models;
};
