import type { ResolvedAsset, Scene } from "@dalang/core";
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
import { motionTransform } from "../../motion-model";
import { filterToCss } from "./filters";
import type { DocTheme } from "./theme";

/**
 * Full-bleed scene background: a resolved asset (image/video) with slow
 * documentary motion, or a procedural duotone backdrop for `solid` scenes and
 * scenes whose asset has not been resolved yet.
 */

const AssetLayer: React.FC<{
  asset: ResolvedAsset;
  scene: Scene;
  durationInFrames: number;
}> = ({ asset, scene, durationInFrames }) => {
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
    ...motionTransform(scene.visual, progress),
    // ADR-0011: filter/opacity scene diterapkan di lapisan media.
    ...filterToCss(scene.visual.filter),
  };

  if (asset.kind === "video") {
    return (
      <Video
        src={assetSrc(asset.file)}
        muted
        playbackRate={scene.visual.speed}
        // ADR-0017: titik masuk di rekaman sumber — satu video panjang bisa
        // dipakai berkali-kali dengan potongan berbeda per scene.
        trimBefore={Math.round(scene.visual.trimStartSec * fps)}
        style={style}
      />
    );
  }
  return <Img src={assetSrc(asset.file)} style={style} />;
};

/** Varian seni prosedural (ADR-0013) — dipilih lewat visual.variant. */
const PROCEDURAL_VARIANTS = ["duotone", "rays", "topo", "grid"] as const;
type ProceduralVariant = (typeof PROCEDURAL_VARIANTS)[number];

const variantOf = (scene: Scene): ProceduralVariant =>
  (PROCEDURAL_VARIANTS as readonly string[]).includes(scene.visual.variant ?? "")
    ? (scene.visual.variant as ProceduralVariant)
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
  scene: Scene;
  sceneIndex: number;
  theme: DocTheme;
  durationInFrames: number;
}> = ({ scene, sceneIndex, theme, durationInFrames }) => {
  const frame = useCurrentFrame();
  const duotone = (theme.duotones[sceneIndex % theme.duotones.length] ?? [
    "#131A33",
    "#3A2A18",
  ]) as [string, string];
  const seedA = random(`${scene.id}-a`);
  const seedB = random(`${scene.id}-b`);
  const ax = 12 + seedA * 30;
  const ay = 8 + seedB * 24;
  const bx = 62 + seedB * 28;
  const by = 64 + seedA * 26;
  const art = variantArt(variantOf(scene), seedA, seedB, duotone, frame);

  return (
    <AbsoluteFill
      style={{ backgroundColor: theme.bg, ...filterToCss(scene.visual.filter) }}
    >
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

export const Backdrop: React.FC<{
  scene: Scene;
  sceneIndex: number;
  asset: ResolvedAsset | undefined;
  theme: DocTheme;
  durationInFrames: number;
  /** Extra darkening for text-heavy scenes (title/outro). */
  dim?: number;
}> = ({ scene, sceneIndex, asset, theme, durationInFrames, dim = 0 }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      {asset ? (
        <AbsoluteFill
          style={{ filter: "saturate(1.04) contrast(1.05) brightness(0.96)" }}
        >
          <AssetLayer asset={asset} scene={scene} durationInFrames={durationInFrames} />
        </AbsoluteFill>
      ) : (
        <ProceduralBackdrop
          scene={scene}
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
