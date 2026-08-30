import { NARRATION_LEAD_IN_SEC, type Scene, type ScenePlan } from "@dalang/core";
import { Audio } from "@remotion/media";
import { TransitionSeries } from "@remotion/transitions";
import { type ReactNode, useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { ensureFontsLoaded } from "../../fonts";
import { GraphicsOverlay } from "../../GraphicsOverlay";
import {
  type AspectMetrics,
  activeSceneIndex,
  aspectMetrics,
  computeFrameLayout,
  type FrameLayout,
  TRANSITION_FRAMES,
} from "../../layout";
import { buildMusicVolume, resolveMusicFile } from "../../music";
import { presentationFor, timingFor } from "../../transitions";
import { type StepInfo, stepNumbers } from "./annotate";
import { OutroScene, StepScene, TitleScene } from "./Scenes";
import { type TutTheme, themeFromPlan } from "./theme";

/**
 * tutorial-01 — preset kedua (PRD Fase 4 §9): konten how-to berbasis
 * screenshot. Kartu screenshot di kertas terang, kamera zoom ke target
 * anotasi, highlight/arrow/blur murni animasi, chip langkah, caption
 * karaoke tema terang.
 */

const Chrome: React.FC<{
  plan: ScenePlan;
  layout: FrameLayout;
  metrics: AspectMetrics;
  theme: TutTheme;
}> = ({ plan, layout, metrics, theme }) => {
  const frame = useCurrentFrame();
  const index = activeSceneIndex(layout, frame);
  const progress = interpolate(frame, [0, Math.max(layout.totalFrames, 1)], [0, 1], {
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          height: 7,
          width: `${progress * 100}%`,
          background: theme.accent,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: metrics.marginTop * 0.34,
          right: metrics.marginX,
          fontFamily: theme.fontBody,
          fontWeight: 720,
          fontSize: metrics.kickerFontSize,
          letterSpacing: "0.2em",
          color: theme.inkSoft,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {String(index + 1).padStart(2, "0")} /{" "}
        {String(plan.scenes.length).padStart(2, "0")}
      </div>
    </AbsoluteFill>
  );
};

const SceneRouter: React.FC<{
  scene: Scene;
  plan: ScenePlan;
  metrics: AspectMetrics;
  theme: TutTheme;
  durationInFrames: number;
  step: StepInfo | undefined;
  debug: boolean;
}> = ({ scene, plan, metrics, theme, durationInFrames, step, debug }) => {
  const { fps } = useVideoConfig();
  const narrationAudio = plan.renderState.narrationAudio[scene.id];

  let content: ReactNode;
  if (scene.visual.type === "template-anim") {
    const variant = scene.visual.variant ?? "title";
    content =
      variant === "outro" ? (
        <OutroScene plan={plan} scene={scene} metrics={metrics} theme={theme} />
      ) : (
        <TitleScene plan={plan} scene={scene} metrics={metrics} theme={theme} />
      );
  } else {
    content = (
      <StepScene
        scene={scene}
        plan={plan}
        asset={
          scene.visual.type === "solid"
            ? undefined
            : plan.renderState.resolvedAssets[scene.id]
        }
        metrics={metrics}
        theme={theme}
        durationInFrames={durationInFrames}
        step={step}
        debug={debug}
      />
    );
  }

  return (
    <AbsoluteFill>
      {content}
      {/* Tempelan berlaku untuk KEDUA preset (ADR-0018): grafis yang tersimpan
          di plan harus muncul apa pun gaya yang dipakai, kalau tidak proyek
          tutorial menyimpan sesuatu yang tak pernah terlihat di videonya. */}
      <GraphicsOverlay
        scene={scene}
        plan={plan}
        metrics={metrics}
        accent={theme.accent}
        durationInFrames={durationInFrames}
      />
      {narrationAudio ? (
        <Audio
          src={staticFile(narrationAudio.file)}
          from={Math.round(NARRATION_LEAD_IN_SEC * fps)}
        />
      ) : null}
    </AbsoluteFill>
  );
};

export const TutorialPreset: React.FC<{
  plan: ScenePlan;
  debug: boolean;
}> = ({ plan, debug }) => {
  ensureFontsLoaded();
  const theme = themeFromPlan(plan);
  const metrics = aspectMetrics(plan.meta.aspectRatio);
  const layout = computeFrameLayout(plan);
  const steps = stepNumbers(plan);

  // Musik latar (ADR-0014): bed di-loop + ducking di bawah narasi.
  const musicFile = plan.audio.music ? resolveMusicFile(plan.audio.music.assetId) : null;
  const musicVolume = useMemo(() => buildMusicVolume(plan, layout), [plan, layout]);

  const series: ReactNode[] = [];
  plan.scenes.forEach((scene, index) => {
    if (index > 0) {
      const type = plan.scenes[index - 1]?.transition.type ?? "cross-fade";
      const frames = layout.boundaryFrames[index - 1] ?? TRANSITION_FRAMES;
      series.push(
        <TransitionSeries.Transition
          key={`transition-${index}`}
          presentation={presentationFor(type)}
          timing={timingFor(frames)}
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
          plan={plan}
          metrics={metrics}
          theme={theme}
          durationInFrames={durationInFrames}
          step={steps.get(scene.id)}
          debug={debug}
        />
      </TransitionSeries.Sequence>,
    );
  });

  return (
    <AbsoluteFill style={{ backgroundColor: theme.paper, fontFamily: theme.fontBody }}>
      <TransitionSeries>{series}</TransitionSeries>
      <Chrome plan={plan} layout={layout} metrics={metrics} theme={theme} />
      {musicFile ? <Audio src={staticFile(musicFile)} loop volume={musicVolume} /> : null}
    </AbsoluteFill>
  );
};
