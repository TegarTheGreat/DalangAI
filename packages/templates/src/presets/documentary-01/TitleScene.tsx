import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import type { ResolvedAsset, Scene, ScenePlan } from "@dalang/core";
import type { AspectMetrics } from "../../layout";
import { Backdrop } from "./Backdrop";
import type { DocTheme } from "./theme";

/**
 * Opening title card (`template-anim` / variant "title").
 * Big display type from meta.title; the scene's narration doubles as the dek.
 */

const ease = Easing.bezier(0.16, 1, 0.3, 1);

const titleFontSize = (title: string, base: number): number => {
  const chars = title.length;
  if (chars <= 18) return base;
  return Math.max(Math.round(base * Math.sqrt(18 / chars)), 62);
};

export const TitleScene: React.FC<{
  scene: Scene;
  sceneIndex: number;
  plan: ScenePlan;
  asset: ResolvedAsset | undefined;
  metrics: AspectMetrics;
  theme: DocTheme;
  durationInFrames: number;
}> = ({ scene, sceneIndex, plan, asset, metrics, theme, durationInFrames }) => {
  const frame = useCurrentFrame();
  const words = plan.meta.title.split(/\s+/).filter(Boolean);
  const fontSize = titleFontSize(plan.meta.title, metrics.titleFontSize);
  const wordsDone = 12 + words.length * 4 + 14;

  return (
    <AbsoluteFill>
      <Backdrop
        scene={scene}
        sceneIndex={sceneIndex}
        asset={asset}
        theme={theme}
        durationInFrames={durationInFrames}
        dim={0.34}
      />
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: `${metrics.marginTop}px ${metrics.marginX}px`,
          scale: String(
            1 +
              interpolate(frame, [0, durationInFrames], [0, 0.032], {
                extrapolateRight: "clamp",
              }),
          ),
        }}
      >
        {/* Kicker */}
        <div
          style={{
            fontFamily: theme.fontBody,
            fontWeight: 800,
            fontSize: metrics.kickerFontSize,
            color: theme.accent,
            letterSpacing: `${interpolate(frame, [4, 26], [0.62, 0.34], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: ease,
            })}em`,
            textTransform: "uppercase",
            opacity: interpolate(frame, [4, 22], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: ease,
            }),
            marginBottom: Math.round(fontSize * 0.42),
          }}
        >
          Dokumenter
        </div>

        {/* Title, word by word */}
        <h1
          style={{
            margin: 0,
            fontFamily: theme.fontDisplay,
            fontWeight: 860,
            fontSize,
            lineHeight: 1.06,
            textAlign: "center",
            color: theme.ink,
            letterSpacing: "-0.015em",
            textWrap: "balance",
            maxWidth: "100%",
          }}
        >
          {words.map((word, index) => {
            const start = 10 + index * 4;
            return (
              <span
                key={`${word}-${index}`}
                style={{
                  display: "inline-block",
                  whiteSpace: "pre",
                  opacity: interpolate(frame, [start, start + 18], [0, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                    easing: ease,
                  }),
                  translate: `0 ${interpolate(
                    frame,
                    [start, start + 20],
                    [Math.round(fontSize * 0.45), 0],
                    {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                      easing: ease,
                    },
                  )}px`,
                }}
              >
                {word}
                {index < words.length - 1 ? " " : ""}
              </span>
            );
          })}
        </h1>

        {/* Rule */}
        <div
          style={{
            height: 3,
            width: interpolate(frame, [wordsDone, wordsDone + 18], [0, 128], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: ease,
            }),
            backgroundColor: theme.accent,
            marginTop: Math.round(fontSize * 0.42),
          }}
        />

        {/* Dek */}
        {scene.narration.trim() !== "" ? (
          <p
            style={{
              margin: 0,
              marginTop: Math.round(fontSize * 0.36),
              fontFamily: theme.fontBody,
              fontWeight: 460,
              fontSize: Math.max(Math.round(fontSize * 0.3), 34),
              lineHeight: 1.45,
              textAlign: "center",
              color: theme.inkSoft,
              maxWidth: "84%",
              textWrap: "balance",
              opacity: interpolate(
                frame,
                [wordsDone + 8, wordsDone + 26],
                [0, 1],
                {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: ease,
                },
              ),
            }}
          >
            {scene.narration}
          </p>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
