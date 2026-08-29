import { useMemo } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  createTikTokStyleCaptions,
  type Caption as RemotionCaption,
  type TikTokPage,
} from "@remotion/captions";
import {
  estimateWordTimestamps,
  type Scene,
  type ScenePlan,
  type WordTimestamp,
} from "@dalang/core";
import type { AspectMetrics } from "../../layout";
import type { DocTheme } from "./theme";

/**
 * Karaoke-style captions synced to the narration.
 *
 * Timing source, in order of fidelity:
 *  1. Real word timestamps from TTS (renderState.narrationAudio) — Fase 1+.
 *  2. Deterministic estimate from the narration text (char-proportional) so
 *     Fase 0 previews already read naturally.
 */

const PAGE_COMBINE_MS = 1100;
/** How long the last page lingers after the narration ends. */
const LAST_PAGE_HOLD_FRAMES = 14;

const toRemotionCaptions = (words: WordTimestamp[]): RemotionCaption[] =>
  words.map((word, index) => ({
    text: `${index === 0 ? "" : " "}${word.word}`,
    startMs: word.startSec * 1000,
    endMs: word.endSec * 1000,
    timestampMs: ((word.startSec + word.endSec) / 2) * 1000,
    confidence: null,
  }));

const CaptionPage: React.FC<{
  page: TikTokPage;
  metrics: AspectMetrics;
  theme: DocTheme;
}> = ({ page, metrics, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const absoluteTimeMs = page.startMs + (frame / fps) * 1000;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          bottom: metrics.captionBottom,
          left: "50%",
          width: metrics.captionMaxWidth,
          textAlign: "center",
          fontFamily: theme.fontBody,
          fontWeight: 640,
          fontSize: metrics.captionFontSize,
          lineHeight: 1.28,
          color: theme.ink,
          whiteSpace: "pre-wrap",
          textShadow: [
            "0 2px 30px rgba(0, 0, 0, 0.72)",
            "0 0 18px rgba(0, 0, 0, 0.55)",
            "0 2px 6px rgba(0, 0, 0, 0.7)",
            "0 -1px 8px rgba(0, 0, 0, 0.4)",
          ].join(", "),
          opacity: interpolate(frame, [0, 5], [0, 1], {
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: `-50% ${interpolate(frame, [0, 5], [10, 0], {
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          })}px`,
        }}
      >
        {page.tokens.map((token, tokenIndex) => {
          const started = token.fromMs <= absoluteTimeMs;
          const active = started && token.toMs > absoluteTimeMs;
          return (
            <span
              key={`${token.fromMs}-${tokenIndex}`}
              style={{
                color: active
                  ? theme.accent
                  : started
                    ? theme.ink
                    : "rgba(245, 240, 230, 0.66)",
                fontWeight: active ? 760 : 640,
              }}
            >
              {token.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const CaptionsOverlay: React.FC<{
  scene: Scene;
  plan: ScenePlan;
  sceneDurationFrames: number;
  metrics: AspectMetrics;
  theme: DocTheme;
}> = ({ scene, plan, sceneDurationFrames, metrics, theme }) => {
  const { fps } = useVideoConfig();

  const pages = useMemo(() => {
    if (!scene.caption.enabled || scene.narration.trim() === "") return [];
    const real = plan.renderState.narrationAudio[scene.id]?.wordTimestamps;
    const words =
      real && real.length > 0
        ? real
        : estimateWordTimestamps(scene.narration, sceneDurationFrames / fps);
    return createTikTokStyleCaptions({
      captions: toRemotionCaptions(words),
      combineTokensWithinMilliseconds: PAGE_COMBINE_MS,
    }).pages;
  }, [scene, plan, sceneDurationFrames, fps]);

  if (pages.length === 0) return null;

  return (
    <AbsoluteFill>
      {pages.map((page, index) => {
        const next = pages[index + 1];
        const startFrame = Math.round((page.startMs / 1000) * fps);
        const endFrame = next
          ? Math.round((next.startMs / 1000) * fps)
          : Math.min(
              Math.round((page.startMs + page.durationMs) / 1000 * fps) +
                LAST_PAGE_HOLD_FRAMES,
              sceneDurationFrames,
            );
        const durationInFrames = endFrame - startFrame;
        if (durationInFrames <= 0) return null;
        return (
          <Sequence
            key={index}
            from={startFrame}
            durationInFrames={durationInFrames}
            layout="none"
            name={`caption-${index + 1}`}
          >
            <CaptionPage page={page} metrics={metrics} theme={theme} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
