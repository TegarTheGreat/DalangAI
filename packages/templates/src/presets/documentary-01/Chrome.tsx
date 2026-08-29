import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { ScenePlan } from "@dalang/core";
import type { AspectMetrics } from "../../layout";
import { activeSceneIndex, TRANSITION_FRAMES, type FrameLayout } from "../../layout";
import type { DocTheme } from "./theme";

/**
 * Global chrome: progress strip, running-head kicker, scene counter.
 * The kicker/counter stay hidden on title & outro scenes so those breathe.
 */

const isTemplateVariant = (
  plan: ScenePlan,
  index: number,
  variant: string,
): boolean => {
  const scene = plan.scenes[index];
  if (!scene) return false;
  return (
    scene.visual.type === "template-anim" &&
    (scene.visual.variant ?? "title") === variant
  );
};

export const Chrome: React.FC<{
  plan: ScenePlan;
  layout: FrameLayout;
  metrics: AspectMetrics;
  theme: DocTheme;
}> = ({ plan, layout, metrics, theme }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const progress = interpolate(frame, [0, durationInFrames - 1], [0, 1], {
    extrapolateRight: "clamp",
  });

  const hasTitleFirst = isTemplateVariant(plan, 0, "title");
  const lastIndex = plan.scenes.length - 1;
  const hasOutroLast = isTemplateVariant(plan, lastIndex, "outro");

  const fadeInStart = hasTitleFirst
    ? (layout.sceneStarts[1] ?? 0) + TRANSITION_FRAMES / 2
    : 6;
  const fadeOutStart = hasOutroLast
    ? (layout.sceneStarts[lastIndex] ?? durationInFrames) + TRANSITION_FRAMES / 2
    : durationInFrames + 1;

  const headOpacity =
    interpolate(frame, [fadeInStart, fadeInStart + 14], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }) *
    interpolate(frame, [fadeOutStart, fadeOutStart + 12], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  const shownIndex = activeSceneIndex(layout, frame) + 1;
  const runningHead = plan.meta.title.toUpperCase();

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* Progress strip */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 6,
          backgroundColor: "rgba(245, 240, 230, 0.14)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          height: 6,
          width: `${progress * 100}%`,
          backgroundColor: theme.accent,
        }}
      />

      {/* Running head + counter */}
      <div
        style={{
          position: "absolute",
          top: metrics.marginTop * 0.62,
          left: metrics.marginX,
          right: metrics.marginX,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 24,
          opacity: headOpacity,
        }}
      >
        <div
          style={{
            fontFamily: theme.fontBody,
            fontWeight: 750,
            fontSize: metrics.kickerFontSize - 2,
            letterSpacing: "0.24em",
            color: "rgba(245, 240, 230, 0.78)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            textShadow: "0 1px 12px rgba(0, 0, 0, 0.55)",
          }}
        >
          {runningHead}
        </div>
        <div
          style={{
            fontFamily: theme.fontBody,
            fontWeight: 640,
            fontSize: metrics.kickerFontSize,
            letterSpacing: "0.22em",
            color: "rgba(245, 240, 230, 0.6)",
            flexShrink: 0,
          }}
        >
          {String(shownIndex).padStart(2, "0")}
          <span style={{ color: theme.accent }}> ⁄ </span>
          {String(plan.scenes.length).padStart(2, "0")}
        </div>
      </div>
    </AbsoluteFill>
  );
};
