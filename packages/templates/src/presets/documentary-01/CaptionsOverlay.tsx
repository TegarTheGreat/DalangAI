import type { Scene, ScenePlan } from "@dalang/core";
import { useMemo } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { buildCaptionPages, type CaptionPageModel } from "../../captions-model";
import type { AspectMetrics } from "../../layout";
import type { DocTheme } from "./theme";

/**
 * Karaoke-style captions synced to the narration. All timing math lives in
 * captions-model.ts (pure, unit-tested); this component only renders.
 */

const CaptionPage: React.FC<{
  page: CaptionPageModel;
  metrics: AspectMetrics;
  theme: DocTheme;
}> = ({ page, metrics, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sceneTimeMs = page.startMs + (frame / fps) * 1000;

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
          const started = token.fromMs <= sceneTimeMs;
          const active = started && token.toMs > sceneTimeMs;
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

  const pages = useMemo(
    () => buildCaptionPages({ scene, plan, sceneDurationFrames, fps }),
    [scene, plan, sceneDurationFrames, fps],
  );

  if (pages.length === 0) return null;

  return (
    <AbsoluteFill>
      {pages.map((page, index) => (
        <Sequence
          key={index}
          from={page.startFrame}
          durationInFrames={page.durationInFrames}
          layout="none"
          name={`caption-${index + 1}`}
        >
          <CaptionPage page={page} metrics={metrics} theme={theme} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
