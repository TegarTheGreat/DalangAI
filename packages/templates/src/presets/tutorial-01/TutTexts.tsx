import type { Scene, TextOverlay } from "@dalang/core";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import type { AspectMetrics } from "../../layout";
import {
  alignStyles,
  emphasisStyle,
  TEXT_POSITIONS,
  TEXT_SIZE_FACTOR,
} from "../../text-overlay-model";
import type { TutTheme } from "./theme";

/**
 * Teks overlay tema terang (ADR-0013) — semantik role/align/size/emphasis
 * sama dengan documentary-01, warna mengikuti kertas tutorial.
 */

const ENTER_FRAMES = 14;
const EXIT_FRAMES = 10;

const roleStyle = (
  role: TextOverlay["role"],
  theme: TutTheme,
  metrics: AspectMetrics,
  sizeFactor: number,
): React.CSSProperties => {
  const base: React.CSSProperties = {
    margin: 0,
    maxWidth: "82%",
    textWrap: "balance",
  };
  switch (role) {
    case "headline":
      return {
        ...base,
        fontFamily: theme.fontDisplay,
        fontWeight: 640,
        fontSize: metrics.titleFontSize * 0.5 * sizeFactor,
        lineHeight: 1.08,
        color: theme.ink,
      };
    case "subline":
      return {
        ...base,
        fontFamily: theme.fontBody,
        fontWeight: 540,
        fontSize: metrics.titleFontSize * 0.24 * sizeFactor,
        lineHeight: 1.4,
        color: theme.inkSoft,
      };
    case "kicker":
      return {
        ...base,
        fontFamily: theme.fontBody,
        fontWeight: 760,
        fontSize: metrics.titleFontSize * 0.16 * sizeFactor,
        letterSpacing: "0.3em",
        textTransform: "uppercase",
        color: theme.accent,
      };
    case "quote":
      return {
        ...base,
        fontFamily: theme.fontDisplay,
        fontStyle: "italic",
        fontWeight: 500,
        fontSize: metrics.titleFontSize * 0.34 * sizeFactor,
        lineHeight: 1.3,
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
      return { justifyContent: "flex-start", paddingTop: metrics.marginTop * 1.5 };
    case "center":
      return { justifyContent: "center" };
    case "bottom":
      return {
        justifyContent: "flex-end",
        paddingBottom: metrics.captionBottom + metrics.marginTop,
      };
  }
};

export const TutTexts: React.FC<{
  scene: Scene;
  metrics: AspectMetrics;
  theme: TutTheme;
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
              const enter = interpolate(frame, [start, start + ENTER_FRAMES], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              const exit = interpolate(frame, [end - EXIT_FRAMES, end], [1, 0], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              const align = alignStyles(text.align);
              return (
                <p
                  key={text.id}
                  style={{
                    ...roleStyle(text.role, theme, metrics, TEXT_SIZE_FACTOR[text.size]),
                    ...align.self,
                    ...align.block,
                    ...emphasisStyle(text.emphasis, {
                      boxBg: theme.card,
                      accent: theme.accent,
                    }),
                    ...(text.emphasis === "box"
                      ? { boxShadow: "0 10px 30px rgba(29, 33, 41, 0.14)" }
                      : {}),
                    opacity: Math.min(enter, exit),
                    transform: `translateY(${(1 - enter) * 22}px)`,
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
