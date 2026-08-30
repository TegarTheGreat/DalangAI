import type { Scene, TextOverlay } from "@dalang/core";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { enterExit } from "../../anim";
import type { AspectMetrics } from "../../layout";
import {
  alignStyles,
  emphasisStyle,
  TEXT_POSITIONS,
  TEXT_SIZE_FACTOR,
} from "../../text-overlay-model";
import type { DocTheme } from "./theme";

/**
 * ADR-0011: teks overlay per scene — di atas visual, di bawah caption.
 * Gaya mengikuti bahasa preset (Fraunces untuk headline/quote, Inter untuk
 * kicker/subline); masuk-keluar dianimasikan fade + rise deterministik.
 */

const ENTER_FRAMES = 14;
const EXIT_FRAMES = 10;

const roleStyle = (
  role: TextOverlay["role"],
  theme: DocTheme,
  metrics: AspectMetrics,
  sizeFactor: number,
): React.CSSProperties => {
  const base: React.CSSProperties = {
    margin: 0,
    maxWidth: "82%",
    textShadow: "0 2px 18px rgba(0,0,0,0.55), 0 1px 4px rgba(0,0,0,0.7)",
    textWrap: "balance",
  };
  switch (role) {
    case "headline":
      return {
        ...base,
        fontFamily: theme.fontDisplay,
        fontWeight: 640,
        fontSize: metrics.titleFontSize * 0.62 * sizeFactor,
        lineHeight: 1.08,
        letterSpacing: "-0.01em",
        color: theme.ink,
      };
    case "subline":
      return {
        ...base,
        fontFamily: theme.fontBody,
        fontWeight: 500,
        fontSize: metrics.titleFontSize * 0.26 * sizeFactor,
        lineHeight: 1.35,
        color: theme.ink,
        opacity: 0.92,
      };
    case "kicker":
      return {
        ...base,
        fontFamily: theme.fontBody,
        fontWeight: 700,
        fontSize: metrics.titleFontSize * 0.17 * sizeFactor,
        letterSpacing: "0.34em",
        textTransform: "uppercase",
        color: theme.accent,
        // Glow aksen lembut (ADR-0015) — label kecil tetap menyala di footage gelap.
        textShadow: `0 0 18px ${theme.accent}66, 0 2px 10px rgba(0,0,0,0.6)`,
      };
    case "quote":
      return {
        ...base,
        fontFamily: theme.fontDisplay,
        fontStyle: "italic",
        fontWeight: 480,
        fontSize: metrics.titleFontSize * 0.4 * sizeFactor,
        lineHeight: 1.25,
        color: theme.ink,
      };
  }
};

const positionStyle = (
  position: TextOverlay["position"],
  metrics: AspectMetrics,
): React.CSSProperties => {
  switch (position) {
    case "top":
      return { justifyContent: "flex-start", paddingTop: metrics.marginTop * 1.9 };
    case "center":
      return { justifyContent: "center" };
    case "bottom":
      return {
        justifyContent: "flex-end",
        paddingBottom: metrics.captionBottom + metrics.marginTop * 1.2,
      };
  }
};

export const TextsOverlay: React.FC<{
  scene: Scene;
  metrics: AspectMetrics;
  theme: DocTheme;
  durationInFrames: number;
}> = ({ scene, metrics, theme, durationInFrames }) => {
  const frame = useCurrentFrame();
  if (scene.texts.length === 0) return null;

  // Teks yang berbagi posisi mengalir vertikal dalam satu kolom (bukan
  // saling tumpuk absolut); perataan horizontal jatuh ke alignSelf per teks.
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {TEXT_POSITIONS.map((position) => {
        const group = scene.texts.filter((text) => text.position === position);
        if (group.length === 0) return null;
        return (
          <AbsoluteFill
            key={position}
            style={{
              flexDirection: "column",
              rowGap: metrics.titleFontSize * 0.32,
              paddingLeft: metrics.marginX,
              paddingRight: metrics.marginX,
              ...positionStyle(position, metrics),
            }}
          >
            {group.map((text) => {
              const start = Math.round(text.startFrac * durationInFrames);
              const end = Math.max(
                start + 1,
                Math.round(text.endFrac * durationInFrames),
              );
              if (frame < start || frame > end) return null;
              // ADR-0015: kurva settle bersama utk masuk/keluar (anim.ts).
              const { progress, opacity } = enterExit(
                frame,
                start,
                end,
                ENTER_FRAMES,
                EXIT_FRAMES,
              );
              const align = alignStyles(text.align);
              return (
                <p
                  key={text.id}
                  style={{
                    ...roleStyle(text.role, theme, metrics, TEXT_SIZE_FACTOR[text.size]),
                    ...align.self,
                    ...align.block,
                    ...emphasisStyle(text.emphasis, {
                      boxBg: "rgba(7, 9, 15, 0.66)",
                      accent: theme.accent,
                      glow: "rgba(0, 0, 0, 0.45)",
                    }),
                    opacity,
                    translate: `0px ${((1 - progress) * 26).toFixed(2)}px`,
                  }}
                >
                  {text.content}
                </p>
              );
            })}
          </AbsoluteFill>
        );
      })}
    </AbsoluteFill>
  );
};
