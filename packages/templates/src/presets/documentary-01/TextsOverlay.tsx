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
              // ADR-0016: animasi masuk per kata/karakter — blok tidak lagi
              // ikut bergeser saat animasi potongan yang mengurus geraknya.
              const pieces = splitForAnim(text.content, text.anim);
              const blockRise = text.anim === "fade" ? (1 - progress) * 26 : 0;
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
                        boxBg: "rgba(7, 9, 15, 0.66)",
                        accent: theme.accent,
                        glow: "rgba(0, 0, 0, 0.45)",
                      },
                      progress,
                    ),
                    ...textLookStyle(text, { strokeColor: "rgba(0,0,0,0.9)" }),
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
                        // Spasi polos: di luar kotak inline-block agar tidak
                        // dikempiskan (lihat splitToken).
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
