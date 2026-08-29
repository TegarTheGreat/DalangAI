import type { ResolvedAsset, Scene, ScenePlan } from "@dalang/core";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import type { AspectMetrics } from "../../layout";
import { Backdrop } from "./Backdrop";
import type { DocTheme } from "./theme";

/**
 * Closing card (`template-anim` / variant "outro"): the narration becomes the
 * call-to-action; ends on a gentle fade to black.
 */

const ease = Easing.bezier(0.16, 1, 0.3, 1);

export const OutroScene: React.FC<{
  scene: Scene;
  sceneIndex: number;
  plan: ScenePlan;
  asset: ResolvedAsset | undefined;
  metrics: AspectMetrics;
  theme: DocTheme;
  durationInFrames: number;
}> = ({ scene, sceneIndex, plan, asset, metrics, theme, durationInFrames }) => {
  const frame = useCurrentFrame();
  const ctaSize = Math.max(Math.round(metrics.titleFontSize * 0.5), 56);

  return (
    <AbsoluteFill>
      <Backdrop
        scene={scene}
        sceneIndex={sceneIndex}
        asset={asset}
        theme={theme}
        durationInFrames={durationInFrames}
        dim={0.4}
      />
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: `${metrics.marginTop}px ${metrics.marginX}px`,
        }}
      >
        <div
          style={{
            height: 3,
            width: interpolate(frame, [6, 24], [0, 96], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: ease,
            }),
            backgroundColor: theme.accent,
            marginBottom: 42,
          }}
        />
        <div
          style={{
            fontFamily: theme.fontDisplay,
            fontWeight: 700,
            fontSize: ctaSize,
            lineHeight: 1.2,
            textAlign: "center",
            color: theme.ink,
            maxWidth: "88%",
            textWrap: "balance",
            opacity: interpolate(frame, [8, 30], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: ease,
            }),
            translate: `0 ${interpolate(frame, [8, 32], [26, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: ease,
            })}px`,
          }}
        >
          {scene.narration.trim() || "Terima kasih sudah menonton"}
        </div>
        <div
          style={{
            marginTop: 40,
            fontFamily: theme.fontBody,
            fontWeight: 700,
            fontSize: Math.max(Math.round(metrics.kickerFontSize * 0.92), 22),
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "rgba(245, 240, 230, 0.6)",
            textAlign: "center",
            opacity: interpolate(frame, [26, 46], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: ease,
            }),
          }}
        >
          {plan.meta.title}
        </div>
      </AbsoluteFill>

      {/* Final fade to black */}
      <AbsoluteFill
        style={{
          backgroundColor: "black",
          opacity: interpolate(
            frame,
            [durationInFrames - 16, durationInFrames - 2],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          ),
        }}
      />
    </AbsoluteFill>
  );
};
