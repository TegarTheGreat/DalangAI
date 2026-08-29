import type { Scene, TextOverlay } from "@dalang/core";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import type { AspectMetrics } from "../../layout";
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
        fontSize: metrics.titleFontSize * 0.62,
        lineHeight: 1.08,
        letterSpacing: "-0.01em",
        color: theme.ink,
      };
    case "subline":
      return {
        ...base,
        fontFamily: theme.fontBody,
        fontWeight: 500,
        fontSize: metrics.titleFontSize * 0.26,
        lineHeight: 1.35,
        color: theme.ink,
        opacity: 0.92,
      };
    case "kicker":
      return {
        ...base,
        fontFamily: theme.fontBody,
        fontWeight: 700,
        fontSize: metrics.titleFontSize * 0.17,
        letterSpacing: "0.34em",
        textTransform: "uppercase",
        color: theme.accent,
      };
    case "quote":
      return {
        ...base,
        fontFamily: theme.fontDisplay,
        fontStyle: "italic",
        fontWeight: 480,
        fontSize: metrics.titleFontSize * 0.4,
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

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {scene.texts.map((text) => {
        const start = Math.round(text.startFrac * durationInFrames);
        const end = Math.max(start + 1, Math.round(text.endFrac * durationInFrames));
        if (frame < start || frame > end) return null;
        const enter = interpolate(frame, [start, start + ENTER_FRAMES], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const exit = interpolate(frame, [end - EXIT_FRAMES, end], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const opacity = Math.min(enter, exit);
        const rise = (1 - enter) * 26;
        return (
          <AbsoluteFill
            key={text.id}
            style={{
              alignItems: "center",
              textAlign: "center",
              paddingLeft: metrics.marginX,
              paddingRight: metrics.marginX,
              ...positionStyle(text.position, metrics),
            }}
          >
            <p
              style={{
                ...roleStyle(text.role, theme, metrics),
                opacity,
                transform: `translateY(${rise}px)`,
              }}
            >
              {text.content}
            </p>
          </AbsoluteFill>
        );
      })}
    </AbsoluteFill>
  );
};
