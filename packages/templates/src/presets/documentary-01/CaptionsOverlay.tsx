import type { Scene, ScenePlan } from "@dalang/core";
import { Fragment, useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { easeSettle } from "../../anim";
import { buildCaptionPages, type CaptionPageModel } from "../../captions-model";
import type { AspectMetrics } from "../../layout";
import { TEXT_SIZE_FACTOR } from "../../text-overlay-model";
import { captionStyleOf, captionStyleSpec, splitToken } from "../../type-style";
import type { DocTheme } from "./theme";

/**
 * Karaoke-style captions synced to the narration. All timing math lives in
 * captions-model.ts (pure, unit-tested); this component only renders.
 */

const CaptionPage: React.FC<{
  page: CaptionPageModel;
  scene: Scene;
  metrics: AspectMetrics;
  theme: DocTheme;
}> = ({ page, scene, metrics, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sceneTimeMs = page.startMs + (frame / fps) * 1000;

  // ADR-0016: gaya caption nyata (klasik/tegas/chip/halus) + ukuran & posisi.
  const spec = captionStyleSpec(captionStyleOf(scene), {
    ink: theme.ink,
    inkSoft: "rgba(245, 240, 230, 0.66)",
    accent: theme.accent,
    onAccent: theme.bg,
  });
  const fontSize =
    metrics.captionFontSize * spec.sizeFactor * TEXT_SIZE_FACTOR[scene.caption.size];
  const placement =
    scene.caption.position === "center"
      ? { top: "50%", translateY: -50 }
      : { bottom: metrics.captionBottom, translateY: 0 };

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          ...("top" in placement ? { top: placement.top } : { bottom: placement.bottom }),
          left: "50%",
          width: metrics.captionMaxWidth,
          textAlign: "center",
          fontFamily: theme.fontBody,
          fontSize,
          color: theme.ink,
          whiteSpace: "pre-wrap",
          textShadow: [
            "0 2px 30px rgba(0, 0, 0, 0.72)",
            "0 0 18px rgba(0, 0, 0, 0.55)",
            "0 2px 6px rgba(0, 0, 0, 0.7)",
            "0 -1px 8px rgba(0, 0, 0, 0.4)",
          ].join(", "),
          ...spec.block,
          opacity: interpolate(frame, [0, 5], [0, 1], {
            extrapolateRight: "clamp",
            easing: easeSettle,
          }),
          translate: `-50% calc(${placement.translateY}% + ${interpolate(
            frame,
            [0, 5],
            [10, 0],
            { extrapolateRight: "clamp", easing: easeSettle },
          ).toFixed(2)}px)`,
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
          <CaptionPage page={page} scene={scene} metrics={metrics} theme={theme} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
