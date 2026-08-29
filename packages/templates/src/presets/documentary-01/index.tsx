import {
  NARRATION_LEAD_IN_SEC,
  type ResolvedAsset,
  type Scene,
  type ScenePlan,
  type TransitionType,
} from "@dalang/core";
import { Audio } from "@remotion/media";
import {
  linearTiming,
  type TransitionPresentation,
  TransitionSeries,
} from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { none } from "@remotion/transitions/none";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import type { ReactNode } from "react";
import { AbsoluteFill, staticFile, useVideoConfig } from "remotion";
import { ensureFontsLoaded } from "../../fonts";
import {
  type AspectMetrics,
  aspectMetrics,
  computeFrameLayout,
  TRANSITION_FRAMES,
} from "../../layout";
import { Backdrop } from "./Backdrop";
import { BodyScene } from "./BodyScene";
import { Chrome } from "./Chrome";
import { OutroScene } from "./OutroScene";
import { FilmGrain, ReadabilityGradients, Vignette } from "./Overlays";
import { TextsOverlay } from "./TextsOverlay";
import { TitleScene } from "./TitleScene";
import { type DocTheme, themeFromPlan } from "./theme";

/** ADR-0011: peta transisi keluar scene → presentation @remotion/transitions. */
type AnyPresentation = TransitionPresentation<Record<string, unknown>>;
const presentationFor = (type: TransitionType): AnyPresentation => {
  switch (type) {
    case "slide-left":
      return slide({ direction: "from-right" }) as AnyPresentation;
    case "slide-right":
      return slide({ direction: "from-left" }) as AnyPresentation;
    case "slide-up":
      return slide({ direction: "from-bottom" }) as AnyPresentation;
    case "wipe-right":
      return wipe({ direction: "from-left" }) as AnyPresentation;
    case "wipe-down":
      return wipe({ direction: "from-top" }) as AnyPresentation;
    case "none":
      return none() as AnyPresentation;
    case "cross-fade":
      return fade() as AnyPresentation;
  }
};

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
  const { fps } = useVideoConfig();
  const narrationAudio = plan.renderState.narrationAudio[scene.id];

  let content: ReactNode;
  if (scene.visual.type === "template-anim") {
    const variant = scene.visual.variant ?? "title";
    content = variant === "outro" ? <OutroScene {...props} /> : <TitleScene {...props} />;
  } else {
    content = <BodyScene {...props} />;
  }

  return (
    <AbsoluteFill>
      {content}
      <TextsOverlay
        scene={scene}
        metrics={props.metrics}
        theme={props.theme}
        durationInFrames={props.durationInFrames}
      />
      {narrationAudio ? (
        // Narration starts at the lead-in; captions-model shifts word
        // timestamps by the same constant, keeping audio & karaoke in sync.
        <Audio
          src={staticFile(narrationAudio.file)}
          from={Math.round(NARRATION_LEAD_IN_SEC * fps)}
        />
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
      // Jenis transisi milik scene SEBELUMNYA (transisi keluar, ADR-0011).
      const type = plan.scenes[index - 1]?.transition.type ?? "cross-fade";
      series.push(
        <TransitionSeries.Transition
          key={`transition-${index}`}
          presentation={presentationFor(type)}
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
    <AbsoluteFill style={{ backgroundColor: theme.bg, fontFamily: theme.fontBody }}>
      <TransitionSeries>{series}</TransitionSeries>
      <ReadabilityGradients />
      <Vignette />
      <FilmGrain />
      <Chrome plan={plan} layout={layout} metrics={metrics} theme={theme} />
    </AbsoluteFill>
  );
};

export { Backdrop };
