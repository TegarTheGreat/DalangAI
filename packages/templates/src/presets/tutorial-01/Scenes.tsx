import type { ResolvedAsset, Scene, ScenePlan } from "@dalang/core";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import type { AspectMetrics } from "../../layout";
import type { StepInfo } from "./annotate";
import { ScreenshotStage } from "./ScreenshotStage";
import { TutCaptions } from "./TutCaptions";
import { TutTexts } from "./TutTexts";
import type { TutTheme } from "./theme";

/** Kertas ber-titik grid — latar semua scene tutorial. */
export const Paper: React.FC<{ theme: TutTheme }> = ({ theme }) => (
  <AbsoluteFill
    style={{
      backgroundColor: theme.paper,
      backgroundImage: `radial-gradient(${theme.paperDot} 1.6px, transparent 1.6px)`,
      backgroundSize: "30px 30px",
      backgroundPosition: "-8px -8px",
    }}
  />
);

const riseIn = (frame: number, delay: number, distance = 26) => ({
  opacity: interpolate(frame, [delay, delay + 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }),
  translate: `0 ${interpolate(frame, [delay, delay + 14], [distance, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  })}px`,
});

/** Chip nomor langkah di atas kartu screenshot. */
const StepChip: React.FC<{
  info: StepInfo;
  metrics: AspectMetrics;
  theme: TutTheme;
}> = ({ info, metrics, theme }) => {
  const frame = useCurrentFrame();
  const rise = interpolate(frame, [2, 16], [14, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  return (
    <div
      style={{
        position: "absolute",
        top: metrics.marginTop * 0.34,
        left: "50%",
        display: "flex",
        alignItems: "center",
        gap: 14,
        translate: `-50% ${rise}px`,
        opacity: interpolate(frame, [2, 14], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    >
      <span
        style={{
          fontFamily: theme.fontBody,
          fontWeight: 780,
          fontSize: metrics.kickerFontSize + 2,
          letterSpacing: "0.24em",
          color: theme.accent,
          background: "rgba(46, 95, 215, 0.1)",
          border: "1.5px solid rgba(46, 95, 215, 0.3)",
          borderRadius: 99,
          padding: "10px 24px 9px 28px",
        }}
      >
        LANGKAH {info.step} / {info.total}
      </span>
    </div>
  );
};

/** Scene langkah: panggung screenshot + chip langkah + caption. */
export const StepScene: React.FC<{
  scene: Scene;
  plan: ScenePlan;
  asset: ResolvedAsset | undefined;
  metrics: AspectMetrics;
  theme: TutTheme;
  durationInFrames: number;
  step: StepInfo | undefined;
  debug: boolean;
}> = ({ scene, plan, asset, metrics, theme, durationInFrames, step, debug }) => (
  <AbsoluteFill>
    <Paper theme={theme} />
    <ScreenshotStage
      scene={scene}
      asset={asset}
      metrics={metrics}
      theme={theme}
      durationInFrames={durationInFrames}
      debug={debug}
    />
    {step ? <StepChip info={step} metrics={metrics} theme={theme} /> : null}
    <TutTexts
      scene={scene}
      metrics={metrics}
      theme={theme}
      durationInFrames={durationInFrames}
    />
    <TutCaptions
      scene={scene}
      plan={plan}
      sceneDurationFrames={durationInFrames}
      metrics={metrics}
      theme={theme}
    />
  </AbsoluteFill>
);

/** Pembuka: judul panduan di kertas. */
export const TitleScene: React.FC<{
  plan: ScenePlan;
  scene: Scene;
  metrics: AspectMetrics;
  theme: TutTheme;
}> = ({ plan, scene, metrics, theme }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Paper theme={theme} />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: `0 ${metrics.marginX}px`,
        }}
      >
        <div
          style={{
            fontFamily: theme.fontBody,
            fontWeight: 780,
            fontSize: metrics.kickerFontSize + 2,
            letterSpacing: "0.3em",
            color: theme.warm,
            marginBottom: 30,
            ...riseIn(frame, 0, 18),
          }}
        >
          PANDUAN
        </div>
        <h1
          style={{
            margin: 0,
            fontFamily: theme.fontDisplay,
            fontWeight: 640,
            fontSize: metrics.titleFontSize * 0.92,
            lineHeight: 1.06,
            color: theme.ink,
            maxWidth: metrics.width * 0.82,
            ...riseIn(frame, 4),
          }}
        >
          {plan.meta.title}
        </h1>
        <div
          style={{
            width: 84,
            height: 4,
            borderRadius: 4,
            background: theme.accent,
            margin: "38px 0 30px",
            ...riseIn(frame, 9, 12),
          }}
        />
        {scene.narration.trim() !== "" ? (
          <p
            style={{
              margin: 0,
              fontFamily: theme.fontBody,
              fontWeight: 540,
              fontSize: metrics.captionFontSize * 0.78,
              lineHeight: 1.5,
              color: theme.inkSoft,
              maxWidth: metrics.width * 0.56,
              ...riseIn(frame, 12),
            }}
          >
            {scene.narration}
          </p>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Penutup: CTA singkat. */
export const OutroScene: React.FC<{
  plan: ScenePlan;
  scene: Scene;
  metrics: AspectMetrics;
  theme: TutTheme;
}> = ({ plan, scene, metrics, theme }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Paper theme={theme} />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: `0 ${metrics.marginX}px`,
        }}
      >
        <div
          style={{
            width: 84,
            height: 4,
            borderRadius: 4,
            background: theme.warm,
            marginBottom: 34,
            ...riseIn(frame, 0, 12),
          }}
        />
        <h2
          style={{
            margin: 0,
            fontFamily: theme.fontDisplay,
            fontWeight: 620,
            fontSize: metrics.titleFontSize * 0.62,
            lineHeight: 1.16,
            color: theme.ink,
            maxWidth: metrics.width * 0.66,
            ...riseIn(frame, 4),
          }}
        >
          {scene.narration.trim() !== "" ? scene.narration : plan.meta.title}
        </h2>
        <p
          style={{
            margin: "26px 0 0",
            fontFamily: theme.fontBody,
            fontWeight: 700,
            fontSize: metrics.kickerFontSize + 1,
            letterSpacing: "0.22em",
            color: theme.inkSoft,
            ...riseIn(frame, 10),
          }}
        >
          {plan.meta.title.toUpperCase()}
        </p>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
