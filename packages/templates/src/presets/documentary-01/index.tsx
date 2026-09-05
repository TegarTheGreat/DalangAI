import {
  NARRATION_LEAD_IN_SEC,
  primaryClip,
  type ResolvedAsset,
  type Scene,
  type ScenePlan,
  sceneAsset,
} from "@dalang/core";
import { Audio } from "@remotion/media";
import { TransitionSeries } from "@remotion/transitions";
import { type ReactNode, useMemo } from "react";
import { AbsoluteFill, staticFile, useVideoConfig } from "remotion";
import { AudioTracks } from "../../AudioTracks";
import { useAssetSrc } from "../../asset-src";
import { type DuckWindow, duckWindows, narrationVolume } from "../../audio-model";
import { ensureFontsLoaded } from "../../fonts";
import { GraphicsOverlay } from "../../GraphicsOverlay";
import { LayersOverlay } from "../../LayersOverlay";
import {
  type AspectMetrics,
  aspectMetrics,
  computeFrameLayout,
  FPS,
  TRANSITION_FRAMES,
} from "../../layout";
import { buildMusicVolume, type ResolvedMusic, resolveMusicFile } from "../../music";
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
  /** Frame GLOBAL awal scene; ducking dan fade hidup di waktu global (ADR-0026). */
  sceneStartFrame: number;
  ducks: readonly DuckWindow[];
}> = (props) => {
  const { scene, plan, sceneStartFrame, ducks } = props;
  const { fps } = useVideoConfig();
  const assetSrc = useAssetSrc();
  const narrationAudio = plan.renderState.narrationAudio[scene.id];

  let content: ReactNode;
  if (primaryClip(scene).type === "template-anim") {
    const variant = primaryClip(scene).variant ?? "title";
    content = variant === "outro" ? <OutroScene {...props} /> : <TitleScene {...props} />;
  } else {
    // Amplop suara aset dibangun PER KLIP di dalam BodyScene (ADR-0033): tiap
    // potongan punya rekaman, kenyaringan, dan jendela waktunya sendiri.
    content = <BodyScene {...props} />;
  }

  return (
    // Akar scene DITANDAI: di tengah transisi dua scene terpasang sekaligus,
    // dan kanvas Studio hanya boleh mengukur penanda milik scene yang aktif.
    <AbsoluteFill data-dalang-scene={scene.id}>
      {content}
      {/* Lapisan video (ADR-0025) duduk DI ATAS visual dasar tapi DI BAWAH
          teks, caption, dan tempelan: sisipan adalah gambar, dan gambar tidak
          pernah boleh menutupi kalimat yang sedang dibacakan. */}
      <LayersOverlay
        scene={scene}
        plan={plan}
        metrics={props.metrics}
        accent={props.theme.accent}
        durationInFrames={props.durationInFrames}
        sceneStartFrame={sceneStartFrame}
        ducks={ducks}
        fps={fps}
      />
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
          src={assetSrc(narrationAudio.file)}
          from={Math.round(NARRATION_LEAD_IN_SEC * fps)}
          volume={narrationVolume(plan, narrationAudio)}
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
  const ducks = useMemo(() => duckWindows(plan, layout), [plan, layout]);
  const musicVolume = useMemo(
    () => buildMusicVolume(plan, layout, FPS, musicFile?.lufs, musicFile?.channels),
    [plan, layout, musicFile],
  );
  const assetSrc = useAssetSrc();
  // Bed pustaka ikut ter-bundle bersama komposisi (aset situs); musik unggahan
  // milik proyek (aset plan). Keduanya dialamatkan berbeda di render cloud.
  const musicSrc = (music: ResolvedMusic) =>
    music.bundled ? staticFile(music.file) : assetSrc(music.file);

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
            primaryClip(scene).type === "solid" ? undefined : sceneAsset(plan, scene)
          }
          metrics={metrics}
          theme={theme}
          durationInFrames={durationInFrames}
          debug={debug}
          sceneStartFrame={layout.sceneStarts[index] ?? 0}
          ducks={ducks}
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
      {musicFile ? <Audio src={musicSrc(musicFile)} loop volume={musicVolume} /> : null}
      {/* Trek audio tambahan (ADR-0026) — di akar komposisi, seperti musik. */}
      <AudioTracks plan={plan} layout={layout} fps={FPS} ducks={ducks} />
      {/* Efek suara (ADR-0018): posisinya diturunkan dari scene, jadi ikut
          bergeser saat susunan berubah. */}
      {placeSfxCues(plan, layout, FPS).map((cue) => (
        <Audio
          key={cue.cueId}
          src={assetSrc(cue.file)}
          from={cue.fromFrame}
          volume={cue.volume}
        />
      ))}
    </AbsoluteFill>
  );
};

export { Backdrop };
