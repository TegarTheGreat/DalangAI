import {
  NARRATION_LEAD_IN_SEC,
  type ResolvedAsset,
  type Scene,
  type ScenePlan,
} from "@dalang/core";
import { Audio } from "@remotion/media";
import { TransitionSeries } from "@remotion/transitions";
import { type ReactNode, useMemo } from "react";
import { AbsoluteFill, staticFile, useVideoConfig } from "remotion";
import { ensureFontsLoaded } from "../../fonts";
import { GraphicsOverlay } from "../../GraphicsOverlay";
import {
  type AspectMetrics,
  aspectMetrics,
  computeFrameLayout,
  FPS,
  TRANSITION_FRAMES,
} from "../../layout";
import { buildMusicVolume, resolveMusicFile } from "../../music";
import { placeSfxCues } from "../../sfx";
import { presentationFor, timingFor } from "../../transitions";
import { Backdrop } from "./Backdrop";
import { BodyScene } from "./BodyScene";
import { Chrome } from "./Chrome";
import { OutroScene } from "./OutroScene";
import { FilmGrain, ReadabilityGradients, Vignette } from "./Overlays";
import { TextsOverlay } from "./TextsOverlay";
import { TitleScene } from "./TitleScene";
import { type DocTheme, themeFromPlan } from "./theme";

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
      {/* Grafis di ATAS teks: ikon/stiker adalah aksen paling depan (ADR-0018). */}
      <GraphicsOverlay
        scene={scene}
        plan={plan}
        metrics={props.metrics}
        accent={props.theme.accent}
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

  // Musik latar (ADR-0014): bed di-loop + ducking di bawah narasi.
  const musicFile = plan.audio.music ? resolveMusicFile(plan.audio.music.assetId) : null;
  const musicVolume = useMemo(() => buildMusicVolume(plan, layout), [plan, layout]);

  const series: ReactNode[] = [];
  plan.scenes.forEach((scene, index) => {
    if (index > 0) {
      // Jenis & durasi transisi milik scene SEBELUMNYA (keluar, ADR-0011/0013).
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
          sceneIndex={index}
          plan={plan}
          asset={
            // Tipe solid selalu latar prosedural, meski sisa aset resolved
            // masih tercatat di renderState (kontrak Backdrop).
            scene.visual.type === "solid"
              ? undefined
              : plan.renderState.resolvedAssets[scene.id]
          }
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
      {musicFile ? <Audio src={staticFile(musicFile)} loop volume={musicVolume} /> : null}
      {/* Efek suara (ADR-0018): posisinya diturunkan dari scene, jadi ikut
          bergeser saat susunan berubah. */}
      {placeSfxCues(plan, layout, FPS).map((cue) => (
        <Audio
          key={cue.cueId}
          src={staticFile(cue.file)}
          from={cue.fromFrame}
          volume={cue.volume}
        />
      ))}
    </AbsoluteFill>
  );
};

export { Backdrop };
