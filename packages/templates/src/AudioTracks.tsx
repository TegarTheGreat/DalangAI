import type { ScenePlan } from "@dalang/core";
import { Audio } from "@remotion/media";
import { Sequence } from "remotion";
import { useAssetSrc } from "./asset-src";
import { buildClipVolume, type DuckWindow } from "./audio-model";
import type { FrameLayout } from "./layout";

/**
 * Trek audio tambahan (ADR-0026, roadmap §9.4): ambience, rekaman wawancara,
 * lagu berlisensi yang bukan bed.
 *
 * Dipakai KEDUA preset, sama seperti grafis dan lapisan: suara yang tersimpan
 * di plan harus terdengar apa pun gaya yang dipakai, kalau tidak proyek
 * tutorial menyimpan bunyi yang tidak pernah ada di videonya.
 *
 * PANJANGNYA DIAMBIL DARI HASIL UKUR BERKAS, bukan dikarang. Trek tanpa
 * `durationSec` di renderState tidak digambar sama sekali — `Sequence` wajib
 * punya panjang, dan panjang karangan berarti audio yang terpotong atau
 * menggantung tanpa ada yang tahu kenapa.
 */
export const AudioTracks: React.FC<{
  plan: ScenePlan;
  layout: FrameLayout;
  fps: number;
  ducks: readonly DuckWindow[];
}> = ({ plan, layout, fps, ducks }) => {
  const assetSrc = useAssetSrc();
  if (plan.audio.tracks.length === 0) return null;

  return (
    <>
      {plan.audio.tracks.map((track) => {
        const asset = plan.renderState.trackAssets[track.id];
        if (!asset || asset.durationSec === undefined) return null;

        // Tambatan scene = ikut bergeser saat susunan berubah; tambatan null =
        // dihitung dari awal video.
        const sceneIndex = track.sceneId
          ? plan.scenes.findIndex((scene) => scene.id === track.sceneId)
          : -1;
        if (track.sceneId && sceneIndex < 0) return null;
        const anchor = sceneIndex >= 0 ? (layout.sceneStarts[sceneIndex] ?? 0) : 0;
        const from = anchor + Math.round(track.atSec * fps);
        if (from >= layout.totalFrames) return null;

        // Trek yang di-loop mengisi sisa video; yang tidak, sepanjang berkasnya
        // — keduanya dipotong di ujung video supaya tidak ada audio yang
        // menggantung setelah gambar terakhir.
        const natural = Math.max(1, Math.round(asset.durationSec * fps));
        const frames = Math.min(
          track.loop ? layout.totalFrames - from : natural,
          layout.totalFrames - from,
        );
        if (frames <= 0) return null;

        return (
          <Sequence
            key={track.id}
            from={from}
            durationInFrames={frames}
            layout="none"
            name={`trek-${track.id}`}
          >
            <Audio
              src={assetSrc(asset.file)}
              loop={track.loop}
              volume={buildClipVolume({
                audio: track.audio,
                lufs: asset.lufs,
                channels: asset.channels,
                targetLufs: plan.meta.loudnessTarget,
                startFrame: from,
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
