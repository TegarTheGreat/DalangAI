import type { ResolvedAsset, Scene, ScenePlan } from "@dalang/core";
import { Img, Sequence, staticFile, useCurrentFrame } from "remotion";
import {
  graphicMotion,
  graphicStyle,
  graphicWindow,
  isIconRef,
} from "../../graphic-model";
import type { AspectMetrics } from "../../layout";
import type { DocTheme } from "./theme";

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
 */
export const GraphicsOverlay: React.FC<{
  scene: Scene;
  plan: ScenePlan;
  metrics: AspectMetrics;
  theme: DocTheme;
  durationInFrames: number;
}> = ({ scene, plan, metrics, theme, durationInFrames }) => {
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
              theme={theme}
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
  theme: DocTheme;
  windowFrames: number;
}> = ({ graphic, asset, metrics, theme, windowFrames }) => {
  // Di dalam Sequence, frame sudah relatif terhadap awal jendela tampil.
  const frame = useCurrentFrame();
  const motion = graphicMotion(graphic, frame, windowFrames);
  const style = graphicStyle(graphic, motion, metrics.width, metrics.height);

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
    const source = `url(${staticFile(asset.file)})`;
    return (
      <div
        style={{
          ...style,
          backgroundColor: graphic.color ?? theme.accent,
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
        src={staticFile(asset.file)}
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
