import { random, staticFile, useCurrentFrame } from "remotion";
import { AbsoluteFill, Img, interpolate } from "remotion";
import { Video } from "@remotion/media";
import type { ResolvedAsset, Scene } from "@dalang/core";
import type { DocTheme } from "./theme";

/**
 * Full-bleed scene background: a resolved asset (image/video) with slow
 * documentary motion, or a procedural duotone backdrop for `solid` scenes and
 * scenes whose asset has not been resolved yet.
 */

const motionStyle = (
  motion: Scene["visual"]["motion"],
  frame: number,
  durationInFrames: number,
): React.CSSProperties => {
  const progress = interpolate(frame, [0, Math.max(durationInFrames, 1)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  switch (motion) {
    case "kenburns-in":
      return { scale: String(1.03 + progress * 0.1) };
    case "kenburns-out":
      return { scale: String(1.13 - progress * 0.1) };
    case "pan-left":
      return {
        scale: "1.1",
        translate: `${interpolate(progress, [0, 1], [2.2, -2.2])}% 0%`,
      };
    case "pan-right":
      return {
        scale: "1.1",
        translate: `${interpolate(progress, [0, 1], [-2.2, 2.2])}% 0%`,
      };
    case "none":
      return {};
  }
};

const AssetLayer: React.FC<{
  asset: ResolvedAsset;
  scene: Scene;
  durationInFrames: number;
}> = ({ asset, scene, durationInFrames }) => {
  const frame = useCurrentFrame();
  const style: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    ...motionStyle(scene.visual.motion, frame, durationInFrames),
  };

  if (asset.kind === "video") {
    return (
      <Video
        src={staticFile(asset.file)}
        muted
        style={style}
      />
    );
  }
  return <Img src={staticFile(asset.file)} style={style} />;
};

/**
 * Deterministic duotone gradient art. Seeded by scene id, so the same plan
 * always renders the same frame (PRD §4: deterministic pipeline).
 */
export const ProceduralBackdrop: React.FC<{
  scene: Scene;
  sceneIndex: number;
  theme: DocTheme;
  durationInFrames: number;
}> = ({ scene, sceneIndex, theme, durationInFrames }) => {
  const frame = useCurrentFrame();
  const duotone = theme.duotones[sceneIndex % theme.duotones.length] ?? [
    "#131A33",
    "#3A2A18",
  ];
  const seedA = random(`${scene.id}-a`);
  const seedB = random(`${scene.id}-b`);
  const ax = 12 + seedA * 30;
  const ay = 8 + seedB * 24;
  const bx = 62 + seedB * 28;
  const by = 64 + seedA * 26;

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
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
      />
      {/* Oversized ring for quiet structure */}
      <div
        style={{
          position: "absolute",
          width: "160%",
          aspectRatio: "1 / 1",
          left: `${-40 + seedB * 30}%`,
          top: `${18 + seedA * 22}%`,
          borderRadius: "50%",
          border: "2px solid rgba(245, 240, 230, 0.05)",
        }}
      />
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
        <AbsoluteFill style={{ filter: "saturate(1.04) contrast(1.05) brightness(0.96)" }}>
          <AssetLayer
            asset={asset}
            scene={scene}
            durationInFrames={durationInFrames}
          />
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
