import type { ResolvedAsset, Scene, ScenePlan, VideoLayer } from "@dalang/core";
import { Video } from "@remotion/media";
import { Img, interpolate, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { easeDolly } from "./anim";
import { useAssetSrc } from "./asset-src";
import { buildClipVolume, type DuckWindow, isSilent } from "./audio-model";
import { filterToCss } from "./filters";
import type { GraphicFrame } from "./graphic-model";
import { layerBoxStyle, layerMotion, layerWindow } from "./layer-model";
import type { AspectMetrics } from "./layout";
import { motionTransform } from "./motion-model";

/**
 * Lapisan video di atas visual dasar (ADR-0025): B-roll, picture-in-picture,
 * sisipan bukti.
 *
 * KONTRAK BERKAS sama dengan grafis tempelan: `layer.visual.assetId` adalah
 * penanda, berkas nyatanya hidup di `renderState.layerAssets[layer.id]`. Render
 * karenanya tetap deterministik dan bisa jalan tanpa jaringan.
 *
 * Lapisan yang belum ter-resolve TIDAK menggagalkan render dan tidak
 * menggambar kotak kosong yang menyesatkan — ia hanya absen, dan statusnya
 * sudah terlihat di Studio.
 *
 * Dipakai KEDUA preset. Lapisan adalah kontrak data §5.1 yang berlaku untuk
 * semua gaya: menguncinya ke satu preset berarti proyek tutorial menyimpan
 * sisipan yang tidak pernah muncul di videonya.
 */
export const LayersOverlay: React.FC<{
  scene: Scene;
  plan: ScenePlan;
  metrics: AspectMetrics;
  /** Warna bingkai bawaan bila `layer.borderColor` kosong. */
  accent: string;
  durationInFrames: number;
  /** Frame GLOBAL awal scene — ducking hidup di waktu global (ADR-0026). */
  sceneStartFrame: number;
  ducks: readonly DuckWindow[];
  fps: number;
}> = ({
  scene,
  plan,
  metrics,
  accent,
  durationInFrames,
  sceneStartFrame,
  ducks,
  fps,
}) => {
  if (scene.layers.length === 0) return null;

  return (
    <>
      {scene.layers.map((layer) => {
        const asset: ResolvedAsset | undefined = plan.renderState.layerAssets[layer.id];
        if (!asset) return null;
        const { from, frames } = layerWindow(layer, durationInFrames);
        return (
          <Sequence
            key={layer.id}
            from={from}
            durationInFrames={frames}
            layout="none"
            name={`lapisan-${layer.id}`}
          >
            <LayerItem
              layer={layer}
              asset={asset}
              metrics={metrics}
              accent={accent}
              windowFrames={frames}
              volume={buildClipVolume({
                audio: layer.visual.audio,
                lufs: asset.lufs,
                channels: asset.channels,
                targetLufs: plan.meta.loudnessTarget,
                startFrame: sceneStartFrame + from,
                frames,
                fps,
                ducks,
              })}
            />
          </Sequence>
        );
      })}
    </>
  );
};

const LayerItem: React.FC<{
  layer: VideoLayer;
  asset: ResolvedAsset;
  metrics: AspectMetrics;
  accent: string;
  windowFrames: number;
  volume: (frame: number) => number;
}> = ({ layer, asset, metrics, accent, windowFrames, volume }) => {
  // Di dalam Sequence, frame sudah relatif terhadap awal jendela tampil.
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const assetSrc = useAssetSrc();
  const box: GraphicFrame = metrics;
  const motion = layerMotion(layer, frame, windowFrames);

  // Gerak kamera di dalam sisipan memakai panjang JENDELA-nya sendiri, bukan
  // panjang scene: Ken Burns yang diukur dari durasi scene akan hampir tidak
  // bergerak pada sisipan dua detik di tengah scene dua puluh detik.
  const progress = interpolate(frame, [0, Math.max(windowFrames, 1)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeDolly,
  });
  const mediaStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: layer.fit,
    ...motionTransform(layer.visual, progress),
    ...filterToCss(layer.visual.filter),
  };

  return (
    <div
      // Penanda untuk lapisan manipulasi langsung Studio (ADR-0024/0025).
      data-dalang-layer={layer.id}
      style={layerBoxStyle(layer, motion, box, accent)}
    >
      {asset.kind === "video" ? (
        <Video
          src={assetSrc(asset.file)}
          muted={isSilent(layer.visual.audio)}
          volume={volume}
          playbackRate={layer.visual.speed}
          trimBefore={Math.round(layer.visual.trimStartSec * fps)}
          style={mediaStyle}
        />
      ) : (
        <Img src={assetSrc(asset.file)} style={mediaStyle} />
      )}
    </div>
  );
};
