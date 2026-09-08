import type { Scene, ScenePlan } from "@dalang/core";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { buildClipVolume, type DuckWindow } from "../../audio-model";
import { ClipStrip } from "../../ClipStrip";
import type { AspectMetrics } from "../../layout";
import { Backdrop, clipSeed } from "./Backdrop";
import { CaptionsOverlay } from "./CaptionsOverlay";
import type { DocTheme } from "./theme";

/**
 * Standard narrated scene: full-bleed visual + synced captions.
 *
 * Visualnya adalah STRIP KLIP (ADR-0033), bukan satu gambar: scene berklip satu
 * jatuh ke jalur yang sama persis seperti sebelumnya, dan scene berklip banyak
 * memutar potongannya berurutan. Caption tetap milik SCENE dan menyeberangi
 * seluruh potongan — itu justru inti keputusannya: satu gagasan, satu kalimat,
 * berapa pun potongan gambarnya.
 */
export const BodyScene: React.FC<{
  scene: Scene;
  sceneIndex: number;
  plan: ScenePlan;
  metrics: AspectMetrics;
  theme: DocTheme;
  durationInFrames: number;
  debug: boolean;
  /** Frame GLOBAL awal scene; ducking hidup di waktu global (ADR-0026). */
  sceneStartFrame: number;
  ducks: readonly DuckWindow[];
}> = ({
  scene,
  sceneIndex,
  plan,
  metrics,
  theme,
  durationInFrames,
  debug,
  sceneStartFrame,
  ducks,
}) => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      <ClipStrip scene={scene} plan={plan} durationInFrames={durationInFrames}>
        {({ clip, asset, index, durationInFrames: clipFrames, startFrame }) => {
          const unresolved =
            !asset &&
            (clip.type === "stock" ||
              clip.type === "image" ||
              clip.type === "generated" ||
              clip.type === "screenshot");
          return (
            <AbsoluteFill>
              <Backdrop
                clip={clip}
                seedKey={clipSeed(scene, index)}
                sceneIndex={sceneIndex}
                asset={asset}
                theme={theme}
                durationInFrames={clipFrames}
                // Amplop suara dihitung PER KLIP: tiap potongan punya
                // rekamannya sendiri, kenyaringannya sendiri, dan jendelanya
                // sendiri di waktu global — ducking musik memakai jendela itu.
                volume={buildClipVolume({
                  audio: clip.audio,
                  lufs: asset?.lufs,
                  channels: asset?.channels,
                  targetLufs: plan.meta.loudnessTarget,
                  startFrame: sceneStartFrame + startFrame,
                  frames: clipFrames,
                  fps,
                  ducks,
                })}
              />
              {debug && unresolved ? (
                <div
                  style={{
                    position: "absolute",
                    left: metrics.marginX,
                    bottom: metrics.marginTop * 0.5,
                    fontFamily: "monospace",
                    fontSize: 22,
                    color: "rgba(245, 240, 230, 0.55)",
                    backgroundColor: "rgba(0, 0, 0, 0.4)",
                    padding: "6px 12px",
                    borderRadius: 6,
                  }}
                >
                  aset belum di-resolve · {clip.query ?? clip.type}
                </div>
              ) : null}
            </AbsoluteFill>
          );
        }}
      </ClipStrip>
      <CaptionsOverlay
        scene={scene}
        plan={plan}
        sceneDurationFrames={durationInFrames}
        metrics={metrics}
        theme={theme}
      />
    </AbsoluteFill>
  );
};
