import type { ScenePlan } from "@dalang/core";
import { Audio } from "@remotion/media";
import { useMemo } from "react";
import { staticFile } from "remotion";
import { useAssetSrc } from "./asset-src";
import type { FrameLayout } from "./layout";
import { placeSfxCues } from "./sfx";

/**
 * Efek suara (ADR-0018) dan bunyi ketik (ADR-0043) — di akar komposisi, seperti
 * musik dan trek audio.
 *
 * Dipakai SEMUA preset, dan itu bukan kerapian: blok ini dulu disalin tangan ke
 * tiap preset, dan `tutorial-01` tidak pernah mendapat salinannya. Cue efek
 * suara di proyek tutorial diterima skema, tampil di Studio, lolos `validate`,
 * dan terukur SENYAP TOTAL di video jadi (puncak -90 dBFS, sedangkan plan yang
 * sama di `documentary-01` memuncak di -10 dBFS). Satu komponen bersama
 * menutup kelas cacat itu: preset baru tinggal memasangnya.
 */
export const SfxLayer: React.FC<{
  plan: ScenePlan;
  layout: FrameLayout;
  fps: number;
}> = ({ plan, layout, fps }) => {
  const assetSrc = useAssetSrc();
  const cues = useMemo(() => placeSfxCues(plan, layout, fps), [plan, layout, fps]);
  return (
    <>
      {cues.map((cue) => (
        <Audio
          key={cue.cueId}
          // Bunyi PUSTAKA adalah aset SITUS (ADR-0019): ia ikut bundel
          // komposisi, jadi staticFile menemukannya di mana pun render
          // berjalan — termasuk di Lambda, yang situsnya dipasang sekali.
          src={cue.bundled ? staticFile(cue.file) : assetSrc(cue.file)}
          from={cue.fromFrame}
          volume={cue.volume}
          {...(cue.durationInFrames ? { durationInFrames: cue.durationInFrames } : {})}
        />
      ))}
    </>
  );
};
