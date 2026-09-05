import type { Clip, ResolvedAsset, Scene } from "@dalang/core";
import { Video } from "@remotion/media";
import {
  AbsoluteFill,
  Img,
  interpolate,
  random,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { easeDolly, kf } from "../../anim";
import { useAssetSrc } from "../../asset-src";
import { isSilent } from "../../audio-model";
import { filterToCss } from "../../filters";
import { motionTransform } from "../../motion-model";
import type { DocTheme } from "./theme";

/**
 * Full-bleed scene background: a resolved asset (image/video) with slow
 * documentary motion, or a procedural duotone backdrop for `solid` scenes and
 * scenes whose asset has not been resolved yet.
 */

const AssetLayer: React.FC<{
  asset: ResolvedAsset;
  clip: Clip;
  durationInFrames: number;
  /** Amplop volume suara aset (ADR-0026); tanpa ini asetnya bisu. */
  volume?: ((frame: number) => number) | undefined;
}> = ({ asset, clip, durationInFrames, volume }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const assetSrc = useAssetSrc();
  // Easing dolly (ADR-0014/0015): gerak kamera settle di awal/akhir; semua
  // matematika transform hidup di motion-model (murni & diuji).
  const progress = interpolate(frame, [0, Math.max(durationInFrames, 1)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeDolly,
  });
  const style: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    ...motionTransform(clip, progress),
    // ADR-0011: filter/opacity scene diterapkan di lapisan media.
    ...filterToCss(clip.filter),
  };

  if (asset.kind === "video") {
    return (
      <Video
        src={assetSrc(asset.file)}
        // ADR-0025/0026: bawaan bisu, persis perilaku sebelum keduanya.
        // `muted` dipasang saat tidak berbunyi supaya Remotion tidak
        // menyiapkan jalur audio untuk trek yang memang diam.
        muted={isSilent(clip.audio)}
        {...(volume ? { volume } : {})}
        playbackRate={clip.speed}
        // ADR-0017: titik masuk di rekaman sumber — satu video panjang bisa
        // dipakai berkali-kali dengan potongan berbeda per scene.
        trimBefore={Math.round(clip.trimStartSec * fps)}
        style={style}
      />
    );
  }
  return <Img src={assetSrc(asset.file)} style={style} />;
};

/** Varian seni prosedural (ADR-0013) — dipilih lewat visual.variant. */
const PROCEDURAL_VARIANTS = ["duotone", "rays", "topo", "grid"] as const;
type ProceduralVariant = (typeof PROCEDURAL_VARIANTS)[number];

const variantOf = (clip: Clip): ProceduralVariant =>
  (PROCEDURAL_VARIANTS as readonly string[]).includes(clip.variant ?? "")
    ? (clip.variant as ProceduralVariant)
    : "duotone";

/**
 * Lapisan seni tambahan di atas dasar duotone, per varian — HIDUP (ADR-0015):
 * rays berputar sangat pelan, kontur topo bernapas, grid drift diagonal.
 * Semuanya fungsi frame deterministik (bukan CSS animation).
 */
const variantArt = (
  variant: ProceduralVariant,
  seedA: number,
  seedB: number,
  duotone: [string, string],
  frame: number,
): React.CSSProperties | null => {
  switch (variant) {
    case "rays":
      return {
        backgroundImage: `repeating-conic-gradient(from ${(seedA * 360 + frame * 0.055).toFixed(2)}deg at ${20 + seedB * 60}% ${18 + seedA * 20}%, rgba(245,240,230,0.045) 0deg 7deg, transparent 7deg 24deg)`,
      };
    case "topo": {
      const breathe = Math.sin(frame * 0.021 + seedB * 6) * 2.4;
      return {
        backgroundImage: `repeating-radial-gradient(90% 70% at ${(25 + seedA * 50 + breathe).toFixed(2)}% ${(30 + seedB * 40).toFixed(2)}%, transparent 0 46px, rgba(245,240,230,0.05) 46px 48px)`,
      };
    }
    case "grid":
      return {
        backgroundImage: [
          `linear-gradient(rgba(245,240,230,0.045) 1.5px, transparent 1.5px)`,
          `linear-gradient(90deg, rgba(245,240,230,0.045) 1.5px, transparent 1.5px)`,
          `radial-gradient(120% 100% at 50% 40%, transparent 40%, ${duotone[0]}55 100%)`,
        ].join(", "),
        backgroundSize: "72px 72px, 72px 72px, 100% 100%",
        backgroundPosition: `${(frame * 0.16).toFixed(2)}px ${(frame * 0.11).toFixed(2)}px, ${(frame * 0.16).toFixed(2)}px ${(frame * 0.11).toFixed(2)}px, 0 0`,
      };
    case "duotone":
      return null;
  }
};

/**
 * Deterministic gradient art. Seeded by scene id, so the same plan always
 * renders the same frame (PRD §4: deterministic pipeline). `visual.variant`
 * memilih bahasa grafis: duotone (default) | rays | topo | grid (ADR-0013).
 */
export const ProceduralBackdrop: React.FC<{
  clip: Clip;
  /** Benih seni prosedural — lihat `clipSeed`. */
  seedKey: string;
  sceneIndex: number;
  theme: DocTheme;
  durationInFrames: number;
}> = ({ clip, seedKey, sceneIndex, theme, durationInFrames }) => {
  const frame = useCurrentFrame();
  const duotone = (theme.duotones[sceneIndex % theme.duotones.length] ?? [
    "#131A33",
    "#3A2A18",
  ]) as [string, string];
  const seedA = random(`${seedKey}-a`);
  const seedB = random(`${seedKey}-b`);
  const ax = 12 + seedA * 30;
  const ay = 8 + seedB * 24;
  const bx = 62 + seedB * 28;
  const by = 64 + seedA * 26;
  const art = variantArt(variantOf(clip), seedA, seedB, duotone, frame);

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg, ...filterToCss(clip.filter) }}>
      <AbsoluteFill
        style={{
          scale: String(
            1.18 +
              interpolate(frame, [0, Math.max(durationInFrames, 1)], [0, 0.05], {
                extrapolateRight: "clamp",
              }),
          ),
          translate: `0% ${interpolate(
            frame,
            [0, Math.max(durationInFrames, 1)],
            [seedA > 0.5 ? 1.4 : -1.4, seedA > 0.5 ? -1.4 : 1.4],
          )}%`,
          backgroundImage: [
            `radial-gradient(90% 70% at ${ax}% ${ay}%, ${duotone[0]} 0%, transparent 64%)`,
            `radial-gradient(95% 80% at ${bx}% ${by}%, ${duotone[1]} 0%, transparent 60%)`,
            `radial-gradient(140% 120% at 50% 120%, rgba(0,0,0,0.55) 0%, transparent 55%)`,
          ].join(", "),
        }}
      >
        {art ? <AbsoluteFill style={art} /> : null}
      </AbsoluteFill>
      {/* Cincin raksasa: draw-on pelan di awal scene lalu berputar sangat
          lambat — struktur tenang yang HIDUP (ADR-0015). pathLength=1
          menormalkan dash sehingga offset 1->0 = menggambar penuh. */}
      <svg
        role="presentation"
        style={{
          position: "absolute",
          width: "160%",
          aspectRatio: "1 / 1",
          left: `${-40 + seedB * 30}%`,
          top: `${18 + seedA * 22}%`,
          rotate: `${(seedB * 360 + frame * 0.03).toFixed(2)}deg`,
        }}
        viewBox="0 0 100 100"
      >
        <circle
          cx="50"
          cy="50"
          r="49"
          fill="none"
          stroke="rgba(245, 240, 230, 0.05)"
          strokeWidth="0.14"
          pathLength={1}
          strokeDasharray="1"
          strokeDashoffset={
            1 -
            kf(frame, [
              [0, 0],
              [80, 1],
            ])
          }
        />
      </svg>
    </AbsoluteFill>
  );
};

/**
 * Benih seni prosedural sebuah klip.
 *
 * Klip PERTAMA memakai id SCENE, bukan id klipnya. Itu bukan kelalaian: janji
 * "skema naik tanpa menggeser satu piksel pun" (ADR-0033 fase 1) dibuktikan
 * terhadap benih yang lama, dan mengganti benihnya di sini akan menggeser
 * setiap latar prosedural di setiap plan yang sudah ada — perubahan yang tidak
 * diminta siapa pun. Klip berikutnya memakai benihnya sendiri supaya dua
 * potongan prosedural berurutan tidak tampak sebagai satu gambar yang tidak
 * pernah dipotong.
 */
export const clipSeed = (scene: Scene, index: number): string =>
  index === 0 ? scene.id : `${scene.id}#${index}`;

export const Backdrop: React.FC<{
  clip: Clip;
  seedKey: string;
  sceneIndex: number;
  asset: ResolvedAsset | undefined;
  theme: DocTheme;
  durationInFrames: number;
  /** Extra darkening for text-heavy scenes (title/outro). */
  dim?: number;
  /** Amplop volume suara aset (ADR-0026). */
  volume?: ((frame: number) => number) | undefined;
}> = ({ clip, seedKey, sceneIndex, asset, theme, durationInFrames, dim = 0, volume }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      {asset ? (
        <AbsoluteFill
          style={{ filter: "saturate(1.04) contrast(1.05) brightness(0.96)" }}
        >
          <AssetLayer
            asset={asset}
            clip={clip}
            durationInFrames={durationInFrames}
            volume={volume}
          />
        </AbsoluteFill>
      ) : (
        <ProceduralBackdrop
          clip={clip}
          seedKey={seedKey}
          sceneIndex={sceneIndex}
          theme={theme}
          durationInFrames={durationInFrames}
        />
      )}
      {/* Unifying grade wash so mixed footage reads as one film */}
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(165deg, rgba(20, 28, 58, 0.28) 0%, rgba(0,0,0,0) 45%, rgba(58, 36, 12, 0.24) 100%)`,
          mixBlendMode: "soft-light",
        }}
      />
      {dim > 0 ? (
        <AbsoluteFill style={{ backgroundColor: `rgba(5, 7, 14, ${dim})` }} />
      ) : null}
    </AbsoluteFill>
  );
};
