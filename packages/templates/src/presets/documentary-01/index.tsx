import type { ReactNode } from "react";
import { AbsoluteFill, staticFile } from "remotion";
import { Audio } from "@remotion/media";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import type { ResolvedAsset, Scene, ScenePlan } from "@dalang/core";
import { ensureFontsLoaded } from "../../fonts";
import {
  aspectMetrics,
  computeFrameLayout,
  TRANSITION_FRAMES,
  type AspectMetrics,
} from "../../layout";
import { Backdrop } from "./Backdrop";
import { BodyScene } from "./BodyScene";
import { Chrome } from "./Chrome";
import { FilmGrain, ReadabilityGradients, Vignette } from "./Overlays";
import { OutroScene } from "./OutroScene";
import { themeFromPlan, type DocTheme } from "./theme";
import { TitleScene } from "./TitleScene";

/**
 * documentary-01 — the first curated style preset (PRD Fase 0 gate).
 * Editorial serif titles, karaoke captions, slow Ken Burns, film grain.
 */

const SceneRouter: React.FC<{
  scene: Scene;
  sceneIndex: number;
  plan: ScenePlan;
  asset: ResolvedAsset | undefined;
  metrics: AspectMetrics;
  theme: DocTheme;
  durationInFrames: number;
  debug: boolean;
}> = (props) => {
  const { scene, plan } = props;
  const narrationAudio = plan.renderState.narrationAudio[scene.id];

  let content: ReactNode;
  if (scene.visual.type === "template-anim") {
    const variant = scene.visual.variant ?? "title";
    content =
      variant === "outro" ? <OutroScene {...props} /> : <TitleScene {...props} />;
  } else {
    content = <BodyScene {...props} />;
  }

  return (
    <AbsoluteFill>
      {content}
      {narrationAudio ? (
        <Audio src={staticFile(narrationAudio.file)} />
      ) : null}
    </AbsoluteFill>
  );
};

export const DocumentaryPreset: React.FC<{
  plan: ScenePlan;
  debug: boolean;
}> = ({ plan, debug }) => {
  ensureFontsLoaded();
  const theme = themeFromPlan(plan);
  const metrics = aspectMetrics(plan.meta.aspectRatio);
  const layout = computeFrameLayout(plan);

  const series: ReactNode[] = [];
  plan.scenes.forEach((scene, index) => {
    if (index > 0) {
      series.push(
        <TransitionSeries.Transition
          key={`transition-${index}`}
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />,
      );
    }
    const durationInFrames = layout.sceneFrames[index] ?? 90;
    series.push(
      <TransitionSeries.Sequence
        key={scene.id}
        durationInFrames={durationInFrames}
        name={`${String(index + 1).padStart(2, "0")} · ${scene.id}`}
      >
        <SceneRouter
          scene={scene}
          sceneIndex={index}
          plan={plan}
          asset={plan.renderState.resolvedAssets[scene.id]}
          metrics={metrics}
          theme={theme}
          durationInFrames={durationInFrames}
          debug={debug}
        />
      </TransitionSeries.Sequence>,
    );
  });

  return (
    <AbsoluteFill
      style={{ backgroundColor: theme.bg, fontFamily: theme.fontBody }}
    >
      <TransitionSeries>{series}</TransitionSeries>
      <ReadabilityGradients />
      <Vignette />
      <FilmGrain />
      <Chrome plan={plan} layout={layout} metrics={metrics} theme={theme} />
    </AbsoluteFill>
  );
};

export { Backdrop };
