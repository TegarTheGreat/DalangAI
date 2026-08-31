import type { Scene, TextOverlay } from "@dalang/core";
import { Fragment } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { enterExit } from "../../anim";
import type { AspectMetrics } from "../../layout";
import {
  alignStyles,
  emphasisStyle,
  TEXT_POSITIONS,
  TEXT_SIZE_FACTOR,
} from "../../text-overlay-model";
import { animPieceStyle, isSpacer, splitForAnim, textLookStyle } from "../../type-style";
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
              // ADR-0015: kurva settle bersama utk masuk/keluar (anim.ts).
              const { progress, opacity } = enterExit(
                frame,
                start,
                end,
                ENTER_FRAMES,
                EXIT_FRAMES,
              );
              const align = alignStyles(text.align);
              // ADR-0016: animasi masuk per kata/karakter (lihat type-style).
              const pieces = splitForAnim(text.content, text.anim);
              const blockRise = text.anim === "fade" ? (1 - progress) * 22 : 0;
              return (
                <p
                  key={text.id}
                  // Penanda untuk lapisan manipulasi langsung Studio
                  // (ADR-0024). Kotak pegangan dibaca dari DOM yang SUDAH
                  // ter-render, bukan dihitung ulang — menghitung ulang tata
                  // letak preset di sisi Studio berarti dua rumus yang harus
                  // tetap sama selamanya. Di video hasil render atribut ini
                  // tidak berpengaruh apa-apa.
                  data-dalang-text={text.id}
                  style={{
                    ...roleStyle(text.role, theme, metrics, TEXT_SIZE_FACTOR[text.size]),
                    ...align.self,
                    ...align.block,
                    ...emphasisStyle(
                      text.emphasis,
                      {
                        boxBg: theme.card,
                        accent: theme.accent,
                        glow: "rgba(29, 33, 41, 0.14)",
                      },
                      progress,
                    ),
                    ...textLookStyle(text, { strokeColor: "rgba(255,255,255,0.92)" }),
                    opacity,
                    // Geseran pengguna (ADR-0024) digabung dengan angkat masuk
                    // dalam SATU translate: dua properti translate saling
                    // menimpa, dan yang menang bergantung urutan objek gaya.
                    translate: `${(text.offsetX * metrics.width).toFixed(2)}px ${(
                      blockRise + text.offsetY * metrics.height
                    ).toFixed(2)}px`,
                  }}
                >
                  {text.anim === "fade"
                    ? text.content
                    : pieces.map((piece, pieceIndex) => {
                        if (isSpacer(piece)) {
                          return (
                            <Fragment key={`${text.id}-${pieceIndex}-sp`}>
                              {piece}
                            </Fragment>
                          );
                        }
                        const style = animPieceStyle(
                          text.anim,
                          pieceIndex,
                          frame - start,
                        );
                        if (style === null) return null;
                        return (
                          <span key={`${text.id}-${pieceIndex}-${piece}`} style={style}>
                            {piece}
                          </span>
                        );
                      })}
                </p>
              );
            })}
          </AbsoluteFill>
        );
      })}
    </AbsoluteFill>
  );
};
