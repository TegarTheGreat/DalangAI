import type { Clip, ResolvedAsset, Scene, ScenePlan } from "@dalang/core";
import { TransitionSeries } from "@remotion/transitions";
import type { ReactNode } from "react";
import { Sequence } from "remotion";
import { type ClipSpan, clipFrameSpans } from "./layout";
import { presentationFor, timingFor } from "./transitions";

/**
 * Susunan potongan gambar di dalam SATU scene (ADR-0033).
 *
 * Dipakai kedua preset lewat render-prop, bukan disalin dua kali: kuantisasi
 * bingkai dan aturan tumpang tindih adalah hal yang sama di mana pun, dan
 * salinan kedua adalah tempat lahir selisih satu bingkai yang tidak akan
 * pernah ada yang mencarinya.
 *
 * JALUR KLIP TUNGGAL TIDAK DIBUNGKUS APA PUN. Itu disengaja: mayoritas scene
 * di dunia ini berklip satu, dan menambahkan satu `<Sequence>` di sekelilingnya
 * "yang seharusnya tidak mengubah apa-apa" adalah taruhan yang tidak perlu
 * diambil ketika janji paritas byte-nya diuji di CI.
 */

export interface ClipRenderArgs {
  clip: Clip;
  asset: ResolvedAsset | undefined;
  index: number;
  /** Panjang yang harus dipakai animasi klip ini (sudah termasuk tumpang tindih). */
  durationInFrames: number;
  /**
   * Bingkai pertama klip ini dihitung dari AWAL SCENE — termasuk separuh larut
   * yang mendahuluinya, jadi ini benar-benar saat klipnya mulai TERLIHAT.
   * Dipakai untuk apa pun yang hidup di waktu global: amplop suara, ducking.
   */
  startFrame: number;
}

const assetFor = (plan: ScenePlan, clip: Clip): ResolvedAsset | undefined =>
  // Tipe solid selalu latar prosedural, meski sisa aset resolved masih
  // tercatat di renderState (kontrak Backdrop).
  clip.type === "solid" ? undefined : plan.renderState.clipAssets[clip.id];

export const ClipStrip: React.FC<{
  scene: Scene;
  plan: ScenePlan;
  durationInFrames: number;
  children: (args: ClipRenderArgs) => ReactNode;
}> = ({ scene, plan, durationInFrames, children }) => {
  const spans = clipFrameSpans(scene, durationInFrames);
  const first = spans[0] as ClipSpan;

  if (spans.length === 1) {
    return (
      <>
        {children({
          clip: scene.clips[0] as Clip,
          asset: assetFor(plan, scene.clips[0] as Clip),
          index: 0,
          durationInFrames: first.frames,
          startFrame: 0,
        })}
      </>
    );
  }

  const anyTransition = spans.some((span) => span.transitionFrames > 0);

  if (!anyTransition) {
    // Potong keras: petak yang menutup rapat, tanpa mesin transisi sama sekali.
    return (
      <>
        {spans.map((span) => {
          const clip = scene.clips[span.index] as Clip;
          return (
            <Sequence
              key={span.id}
              from={span.startFrame}
              durationInFrames={span.frames}
              name={`klip ${span.index + 1} · ${span.id}`}
              layout="none"
            >
              {children({
                clip,
                asset: assetFor(plan, clip),
                index: span.index,
                durationInFrames: span.frames,
                startFrame: span.startFrame,
              })}
            </Sequence>
          );
        })}
      </>
    );
  }

  /**
   * Ada larut di dalam scene, jadi mesin transisinya dipakai — dan panjang
   * scene-nya dijaga TIDAK berubah.
   *
   * `TransitionSeries` memendekkan totalnya sebesar setiap tumpang tindih.
   * Supaya jumlahnya kembali persis `durationInFrames`, tiap petak diberi
   * separuh tumpang tindih di setiap sisinya (dibulatkan ke atas di kiri, ke
   * bawah di kanan, jadi jumlahnya tetap bulat). Efek sampingnya justru yang
   * benar secara penyuntingan: TITIK TENGAH larut mendarat tepat di batas
   * potongan, bukan awal atau akhirnya.
   */
  const nodes: ReactNode[] = [];
  spans.forEach((span, index) => {
    const previous = spans[index - 1];
    if (previous && previous.transitionFrames > 0) {
      nodes.push(
        <TransitionSeries.Transition
          key={`larut-${span.id}`}
          presentation={presentationFor(previous.transitionType ?? "cross-fade")}
          timing={timingFor(previous.transitionFrames)}
        />,
      );
    }
    const leading = Math.floor((previous?.transitionFrames ?? 0) / 2);
    const trailing = Math.ceil(span.transitionFrames / 2);
    const clip = scene.clips[span.index] as Clip;
    const frames = span.frames + leading + trailing;
    nodes.push(
      <TransitionSeries.Sequence
        key={span.id}
        durationInFrames={frames}
        name={`klip ${span.index + 1} · ${span.id}`}
      >
        {children({
          clip,
          asset: assetFor(plan, clip),
          index: span.index,
          durationInFrames: frames,
          startFrame: span.startFrame - leading,
        })}
      </TransitionSeries.Sequence>,
    );
  });

  return <TransitionSeries>{nodes}</TransitionSeries>;
};
