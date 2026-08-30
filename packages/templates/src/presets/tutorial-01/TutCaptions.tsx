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
import type { TutTheme } from "./theme";

/**
 * Caption karaoke tema terang: bar kartu putih di dasar, tinta gelap, kata
 * aktif aksen. Timing dari captions-model (murni, teruji) — sama dengan
 * documentary-01, hanya render yang berbeda.
 */

const CaptionBar: React.FC<{
  page: CaptionPageModel;
  metrics: AspectMetrics;
  theme: TutTheme;
}> = ({ page, metrics, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sceneTimeMs = page.startMs + (frame / fps) * 1000;
  const rise = interpolate(frame, [0, 6], [14, 0], {
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          bottom: metrics.captionBottom * 0.55,
          left: "50%",
          maxWidth: metrics.captionMaxWidth,
          translate: `-50% ${rise}px`,
          opacity: interpolate(frame, [0, 6], [0, 1], { extrapolateRight: "clamp" }),
          background: theme.card,
          border: `1.5px solid ${theme.cardBorder}`,
          borderRadius: 18,
          boxShadow: "0 18px 48px rgba(29, 33, 41, 0.14)",
          padding: "18px 34px",
          textAlign: "center",
          fontFamily: theme.fontBody,
          fontWeight: 620,
          fontSize: metrics.captionFontSize * 0.82,
          lineHeight: 1.32,
          color: theme.ink,
          whiteSpace: "pre-wrap",
        }}
      >
        {page.tokens.map((token, tokenIndex) => {
          const started = token.fromMs <= sceneTimeMs;
          const active = started && token.toMs > sceneTimeMs;
          return (
            <span
              key={`${token.fromMs}-${tokenIndex}`}
              style={{
                color: active ? theme.accent : started ? theme.ink : theme.inkSoft,
                fontWeight: active ? 740 : 620,
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

export const TutCaptions: React.FC<{
  scene: Scene;
  plan: ScenePlan;
  sceneDurationFrames: number;
  metrics: AspectMetrics;
  theme: TutTheme;
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
          <CaptionBar page={page} metrics={metrics} theme={theme} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
