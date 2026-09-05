import type { Scene, ScenePlan } from "@dalang/core";
import { Fragment, useMemo } from "react";
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
import { TEXT_SIZE_FACTOR } from "../../text-overlay-model";
import { captionStyleOf, captionStyleSpec, splitToken } from "../../type-style";
import type { TutTheme } from "./theme";

/**
 * Caption karaoke tema terang: bar kartu putih di dasar, tinta gelap, kata
 * aktif aksen. Timing dari captions-model (murni, teruji) — sama dengan
 * documentary-01, hanya render yang berbeda.
 */

const CaptionBar: React.FC<{
  page: CaptionPageModel;
  scene: Scene;
  metrics: AspectMetrics;
  theme: TutTheme;
}> = ({ page, scene, metrics, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sceneTimeMs = page.startMs + (frame / fps) * 1000;
  // ADR-0016: gaya caption dari plan; palet mengikuti kertas terang.
  const spec = captionStyleSpec(captionStyleOf(scene), {
    ink: theme.ink,
    inkSoft: theme.inkSoft,
    accent: theme.accent,
    onAccent: theme.paper,
  });
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
          fontSize:
            metrics.captionFontSize *
            0.82 *
            spec.sizeFactor *
            TEXT_SIZE_FACTOR[scene.caption.size],
          color: theme.ink,
          whiteSpace: "pre-wrap",
          lineHeight: 1.32,
          ...spec.block,
        }}
      >
        {page.tokens.map((token, tokenIndex) => {
          const started = token.fromMs <= sceneTimeMs;
          const active = started && token.toMs > sceneTimeMs;
          const { lead, word } = splitToken(token.text);
          return (
            <Fragment key={`${token.fromMs}-${tokenIndex}`}>
              {lead}
              <span style={spec.token(active ? "active" : started ? "past" : "future")}>
                {word}
              </span>
            </Fragment>
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
          <CaptionBar page={page} scene={scene} metrics={metrics} theme={theme} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
