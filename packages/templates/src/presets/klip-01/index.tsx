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
import { AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
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
  type FrameLayout,
  TRANSITION_FRAMES,
} from "../../layout";
import { buildMusicVolume, type ResolvedMusic, resolveMusicFile } from "../../music";
import { placeSfxCues } from "../../sfx";
import { presentationFor, timingFor } from "../../transitions";
import { TextsOverlay } from "../documentary-01/TextsOverlay";
import { retentionProgress } from "./klip-model";
import { HookScene, KlipBodyScene, KlipOutroScene } from "./Scenes";
import { type KlipTheme, themeFromPlan } from "./theme";

/**
 * klip-01 — preset ketiga: konten pendek vertikal (format "klip").
 *
 * Format "klip" sudah lama dikenali agent (ADR-0017) tapi belum pernah punya
 * rumah visualnya sendiri; sampai preset ini ada, ia dirender oleh
 * documentary-01 — bahasa visual yang dirancang untuk keadaan menonton yang
 * BERBEDA. Yang dipulihkan di sini adalah kecocokan antara format dan
 * tampilannya.
 *
 * Yang membedakannya, dan alasannya, ditulis di `theme.ts` serta pada tiap
 * komponen. Ringkasnya: tidak ada grain dan vignette (keduanya meredupkan
 * gambar), caption berpelat dan berhentak (dibaca tanpa suara), kartu hook
 * yang mendarat dalam 0,2 detik, dan garis retensi di tepi atas.
 */

/**
 * Chrome klip-01 — hanya satu hal: garis retensi.
 *
 * documentary-01 menaruh judul dan penomoran scene di chrome-nya. Di layar
 * vertikal, tiap piksel tepi diperebutkan dengan antarmuka platform (ADR-0034),
 * dan judul yang sudah ada di kartu hook tidak perlu diulang sepanjang video.
 * Yang benar-benar berguna bagi penonton konten pendek cuma satu: berapa lama
 * lagi. Garisnya karena itu di TEPI ATAS — tepi bawah adalah wilayah tombol
 * dan keterangan platform.
 */
const Chrome: React.FC<{
  layout: FrameLayout;
  metrics: AspectMetrics;
  theme: KlipTheme;
}> = ({ layout, metrics, theme }) => {
  const frame = useCurrentFrame();
  const progress = retentionProgress(frame, layout.totalFrames);

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          top: Math.max(metrics.marginTop * 0.42, 18),
          left: metrics.marginX,
          right: metrics.marginX,
          height: 7,
          borderRadius: 4,
          backgroundColor: theme.railTrack,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${(progress * 100).toFixed(3)}%`,
            backgroundColor: theme.rail,
            borderRadius: 4,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

const SceneRouter: React.FC<{
  scene: Scene;
  sceneIndex: number;
  plan: ScenePlan;
  asset: ResolvedAsset | undefined;
  metrics: AspectMetrics;
  theme: KlipTheme;
  durationInFrames: number;
  debug: boolean;
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
    content =
      variant === "outro" ? <KlipOutroScene {...props} /> : <HookScene {...props} />;
  } else {
    content = <KlipBodyScene {...props} />;
  }

  return (
    <AbsoluteFill data-dalang-scene={scene.id}>
      {content}
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
      {/* Teks overlay DIPINJAM apa adanya dari documentary-01: tampilannya
          diputuskan oleh plan lewat sistem "look" sendiri (ADR-0011/0013),
          bukan oleh preset. Menyalinnya di sini justru akan membuat satu teks
          yang sama terlihat berbeda hanya karena presetnya berganti. */}
      <TextsOverlay
        scene={scene}
        metrics={props.metrics}
        theme={props.theme}
        durationInFrames={props.durationInFrames}
      />
      <GraphicsOverlay
        scene={scene}
        plan={plan}
        metrics={props.metrics}
        accent={props.theme.accent}
        durationInFrames={props.durationInFrames}
      />
      {narrationAudio ? (
        <Audio
          src={assetSrc(narrationAudio.file)}
          from={Math.round(NARRATION_LEAD_IN_SEC * fps)}
          volume={narrationVolume(plan, narrationAudio)}
        />
      ) : null}
    </AbsoluteFill>
  );
};

export const KlipPreset: React.FC<{
  plan: ScenePlan;
  debug: boolean;
}> = ({ plan, debug }) => {
  ensureFontsLoaded();
  // Ukuran bingkai untuk transisi yang memerlukannya (clock-wipe menggambar
  // sapuan radial, jadi ia perlu tahu radiusnya) — ADR-0041.
  const { width, height } = useVideoConfig();
  const theme = themeFromPlan(plan);
  const metrics = aspectMetrics(plan.meta.aspectRatio, plan.meta.safeArea);
  const layout = computeFrameLayout(plan);

  const musicFile = plan.audio.music ? resolveMusicFile(plan.audio.music.assetId) : null;
  const ducks = useMemo(() => duckWindows(plan, layout), [plan, layout]);
  const musicVolume = useMemo(
    () => buildMusicVolume(plan, layout, FPS, musicFile?.lufs, musicFile?.channels),
    [plan, layout, musicFile],
  );
  const assetSrc = useAssetSrc();
  const musicSrc = (music: ResolvedMusic) =>
    music.bundled ? staticFile(music.file) : assetSrc(music.file);

  const series: ReactNode[] = [];
  plan.scenes.forEach((scene, index) => {
    if (index > 0) {
      const type = plan.scenes[index - 1]?.transition.type ?? "cross-fade";
      const frames = layout.boundaryFrames[index - 1] ?? TRANSITION_FRAMES;
      series.push(
        <TransitionSeries.Transition
          key={`transition-${index}`}
          presentation={presentationFor(type, { width, height })}
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
      {/* Tidak ada FilmGrain, tidak ada Vignette, tidak ada ReadabilityGradients.
          Ketiganya MEREDUPKAN gambar demi keterbacaan teks; di preset ini
          keterbacaan dibeli oleh pelat caption dan bobot huruf, sehingga
          gambarnya boleh tetap terang. Ini keputusan, bukan kelalaian. */}
      <Chrome layout={layout} metrics={metrics} theme={theme} />
      {musicFile ? <Audio src={musicSrc(musicFile)} loop volume={musicVolume} /> : null}
      <AudioTracks plan={plan} layout={layout} fps={FPS} ducks={ducks} />
      {placeSfxCues(plan, layout, FPS).map((cue) => (
        <Audio
          key={cue.cueId}
          // Bunyi PUSTAKA adalah aset SITUS (ADR-0019): ia ikut bundel
          // komposisi, jadi staticFile menemukannya di mana pun render
          // berjalan — termasuk di Lambda, yang situsnya dipasang sekali.
          src={cue.bundled ? staticFile(cue.file) : assetSrc(cue.file)}
          from={cue.fromFrame}
          volume={cue.volume}
        />
      ))}
    </AbsoluteFill>
  );
};
