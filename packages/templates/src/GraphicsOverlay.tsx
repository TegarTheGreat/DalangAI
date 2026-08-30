import type { ResolvedAsset, Scene, ScenePlan } from "@dalang/core";
import { Img, Sequence, useCurrentFrame } from "remotion";
import { useAssetSrc } from "./asset-src";
import { graphicMotion, graphicStyle, graphicWindow, isIconRef } from "./graphic-model";
import type { AspectMetrics } from "./layout";

/**
 * Lapisan grafis tempelan (ADR-0018): ikon dari pustaka terbuka dan stiker
 * dari pustaka GIF.
 *
 * KONTRAK BERKAS. `graphic.ref` adalah PERMINTAAN ("iconify:mdi:home"), bukan
 * berkas. Berkas nyatanya hidup di `renderState.graphicAssets[graphic.id]`,
 * diisi tahap resolve — pola yang sama dengan aset scene. Render karenanya
 * tetap deterministik dan bisa jalan tanpa jaringan: tidak ada satu pun
 * pengambilan data saat merender.
 *
 * Grafis yang belum ter-resolve TIDAK menggagalkan render dan tidak
 * menggambar apa-apa yang menyesatkan — ia hanya absen, dan status itu sudah
 * terlihat di Studio.
 *
 * Dipakai KEDUA preset. Karena itu ia menerima satu warna aksen, bukan objek
 * tema milik salah satu preset: tempelan adalah kontrak data §5.1 yang berlaku
 * untuk semua gaya, dan menguncinya ke satu preset berarti proyek tutorial
 * menyimpan grafis yang tidak pernah muncul di videonya.
 */
export const GraphicsOverlay: React.FC<{
  scene: Scene;
  plan: ScenePlan;
  metrics: AspectMetrics;
  /** Warna bawaan ikon bila `graphic.color` kosong. */
  accent: string;
  durationInFrames: number;
}> = ({ scene, plan, metrics, accent, durationInFrames }) => {
  if (scene.graphics.length === 0) return null;

  return (
    <>
      {scene.graphics.map((graphic) => {
        const asset: ResolvedAsset | undefined =
          plan.renderState.graphicAssets[graphic.id];
        if (!asset) return null;
        const { from, frames } = graphicWindow(graphic, durationInFrames);
        return (
          <Sequence
            key={graphic.id}
            from={from}
            durationInFrames={frames}
            layout="none"
            name={`grafis-${graphic.id}`}
          >
            <GraphicItem
              graphic={graphic}
              asset={asset}
              metrics={metrics}
              accent={accent}
              windowFrames={frames}
            />
          </Sequence>
        );
      })}
    </>
  );
};

const GraphicItem: React.FC<{
  graphic: Scene["graphics"][number];
  asset: ResolvedAsset;
  metrics: AspectMetrics;
  accent: string;
  windowFrames: number;
}> = ({ graphic, asset, metrics, accent, windowFrames }) => {
  // Di dalam Sequence, frame sudah relatif terhadap awal jendela tampil.
  const frame = useCurrentFrame();
  const assetSrc = useAssetSrc();
  const motion = graphicMotion(graphic, frame, windowFrames);
  const style = graphicStyle(graphic, motion, metrics);

  // PEWARNAAN IKON, dan kenapa BUKAN `color` + currentColor.
  //
  // SVG yang dimuat lewat <img> dirender di konteks dokumennya sendiri:
  // `currentColor` di dalamnya TIDAK mewarisi `color` dari elemen induk, jadi
  // ikon selalu keluar hitam. Ini tidak terlihat oleh test mana pun — hanya
  // oleh render sungguhan, dan memang begitu cara bug ini ketahuan.
  //
  // Mask CSS memakai bentuk SVG sebagai stensil di atas bidang warna, sehingga
  // pewarnaan bekerja pada berkas eksternal apa pun. Ini benar untuk IKON yang
  // memang satu warna; STIKER justru rusak kalau di-mask (warna aslinya
  // hilang), jadi stiker tetap digambar sebagai gambar biasa.
  if (isIconRef(graphic.ref)) {
    const source = `url(${assetSrc(asset.file)})`;
    return (
      <div
        style={{
          ...style,
          backgroundColor: graphic.color ?? accent,
          maskImage: source,
          WebkitMaskImage: source,
          maskRepeat: "no-repeat",
          WebkitMaskRepeat: "no-repeat",
          maskSize: "contain",
          WebkitMaskSize: "contain",
          maskPosition: "center",
          WebkitMaskPosition: "center",
        }}
      />
    );
  }

  return (
    <div style={style}>
      <Img
        src={assetSrc(asset.file)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          display: "block",
        }}
      />
    </div>
  );
};
