import type { Annotation, ResolvedAsset, Scene } from "@dalang/core";
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { AspectMetrics } from "../../layout";
import {
  type ArrowSide,
  activeZoom,
  annotationPresence,
  annotationWindow,
  arrowSide,
} from "./annotate";
import type { TutTheme } from "./theme";

/**
 * Panggung screenshot: kartu ber-titlebar palsu di atas kertas ber-grid,
 * dengan kamera zoom deterministik + lapisan anotasi (highlight/arrow/blur)
 * yang menempel pada ruang gambar — ikut bergerak saat kamera zoom.
 */

const TITLEBAR_H = 44;
/** Ruang bawah untuk bar caption. */
const CAPTION_RESERVE = 210;

export interface StageBox {
  cardW: number;
  cardH: number;
  imgW: number;
  imgH: number;
}

export const stageBox = (
  metrics: AspectMetrics,
  asset: ResolvedAsset | undefined,
): StageBox => {
  const aspect = asset?.width && asset.height ? asset.width / asset.height : 16 / 9;
  const availW = metrics.width - metrics.marginX * 2;
  const availH = metrics.height - metrics.marginTop - CAPTION_RESERVE;
  let imgW = availW;
  let imgH = imgW / aspect;
  if (imgH + TITLEBAR_H > availH) {
    imgH = availH - TITLEBAR_H;
    imgW = imgH * aspect;
  }
  return { cardW: imgW, cardH: imgH + TITLEBAR_H, imgW, imgH };
};

const Titlebar: React.FC<{ theme: TutTheme }> = ({ theme }) => (
  <div
    style={{
      height: TITLEBAR_H,
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "0 20px",
      borderBottom: `1.5px solid ${theme.cardBorder}`,
      background: "rgba(29, 33, 41, 0.025)",
    }}
  >
    {["#E0685E", "#EBB550", "#65BE72"].map((color) => (
      <span
        key={color}
        style={{
          width: 13,
          height: 13,
          borderRadius: "50%",
          background: color,
          opacity: 0.9,
        }}
      />
    ))}
  </div>
);

const HighlightLayer: React.FC<{
  annotation: Annotation;
  presence: number;
  theme: TutTheme;
}> = ({ annotation, presence, theme }) => {
  const { target } = annotation;
  return (
    <div
      style={{
        position: "absolute",
        left: `${target.x * 100}%`,
        top: `${target.y * 100}%`,
        width: `${target.w * 100}%`,
        height: `${target.h * 100}%`,
        border: `4px solid ${theme.accent}`,
        borderRadius: 12,
        opacity: presence,
        // Peredup sekitar: satu bayangan raksasa di luar ring.
        boxShadow: `0 0 0 9999px rgba(21, 25, 34, ${0.4 * presence}), 0 0 0 7px rgba(46, 95, 215, ${0.22 * presence})`,
        scale: String(1.06 - 0.06 * presence),
      }}
    />
  );
};

const ARROW_LEN = 120;

const arrowPlacement = (
  target: Annotation["target"],
  side: ArrowSide,
): React.CSSProperties => {
  const cx = (target.x + target.w / 2) * 100;
  const cy = (target.y + target.h / 2) * 100;
  switch (side) {
    case "left":
      return {
        left: `calc(${target.x * 100}% - ${ARROW_LEN + 18}px)`,
        top: `${cy}%`,
        translate: "0 -50%",
        rotate: "0deg",
      };
    case "right":
      return {
        left: `calc(${(target.x + target.w) * 100}% + 18px)`,
        top: `${cy}%`,
        translate: "0 -50%",
        rotate: "180deg",
      };
    case "top":
      return {
        left: `${cx}%`,
        top: `calc(${target.y * 100}% - ${ARROW_LEN + 18}px)`,
        translate: "-50% 0",
        rotate: "90deg",
      };
    case "bottom":
      return {
        left: `${cx}%`,
        top: `calc(${(target.y + target.h) * 100}% + 18px)`,
        translate: "-50% 0",
        rotate: "270deg",
      };
  }
};

const ArrowLayer: React.FC<{
  annotation: Annotation;
  presence: number;
  theme: TutTheme;
}> = ({ annotation, presence, theme }) => {
  const side = arrowSide(annotation.target);
  const slide = (1 - presence) * 26;
  const offset =
    side === "left"
      ? `${slide}px 0`
      : side === "right"
        ? `${-slide}px 0`
        : side === "top"
          ? `0 ${slide}px`
          : `0 ${-slide}px`;
  return (
    <div
      style={{
        position: "absolute",
        width: ARROW_LEN,
        height: 44,
        opacity: presence,
        transform: `translate(${offset})`,
        ...arrowPlacement(annotation.target, side),
      }}
    >
      <svg
        width={ARROW_LEN}
        height={44}
        viewBox="0 0 120 44"
        fill="none"
        aria-hidden="true"
      >
        <path d="M4 22h86" stroke={theme.accent} strokeWidth={9} strokeLinecap="round" />
        <path d="M88 6l26 16-26 16Z" fill={theme.accent} />
      </svg>
    </div>
  );
};

const BlurLayer: React.FC<{ annotation: Annotation; presence: number }> = ({
  annotation,
  presence,
}) => {
  const { target } = annotation;
  return (
    <div
      style={{
        position: "absolute",
        left: `${target.x * 100}%`,
        top: `${target.y * 100}%`,
        width: `${target.w * 100}%`,
        height: `${target.h * 100}%`,
        borderRadius: 10,
        backdropFilter: `blur(${18 * presence}px) saturate(0.85)`,
        background: `rgba(244, 242, 236, ${0.35 * presence})`,
      }}
    />
  );
};

export const ScreenshotStage: React.FC<{
  scene: Scene;
  asset: ResolvedAsset | undefined;
  metrics: AspectMetrics;
  theme: TutTheme;
  durationInFrames: number;
  debug: boolean;
}> = ({ scene, asset, metrics, theme, durationInFrames, debug }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const box = stageBox(metrics, asset);
  const zoom = activeZoom(
    scene.annotations,
    frame,
    durationInFrames,
    fps,
    box.imgW,
    box.imgH,
  );

  return (
    <AbsoluteFill style={{ alignItems: "center" }}>
      <div
        style={{
          marginTop: metrics.marginTop,
          width: box.cardW,
          height: box.cardH,
          borderRadius: 22,
          border: `1.5px solid ${theme.cardBorder}`,
          background: theme.card,
          boxShadow:
            "0 34px 90px rgba(29, 33, 41, 0.17), 0 6px 22px rgba(29, 33, 41, 0.08)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Titlebar theme={theme} />
        <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              transform: `scale(${zoom.scale}) translate(${zoom.translateX}px, ${zoom.translateY}px)`,
            }}
          >
            {asset ? (
              <Img
                src={staticFile(asset.file)}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background:
                    "repeating-linear-gradient(45deg, rgba(29,33,41,0.04) 0 22px, rgba(29,33,41,0.08) 22px 44px)",
                  color: theme.inkSoft,
                  fontFamily: theme.fontBody,
                  fontSize: 30,
                  fontWeight: 600,
                }}
              >
                {debug ? "Screenshot belum dipasang" : ""}
              </div>
            )}
            {scene.annotations.map((annotation, index) => {
              const presence = annotationPresence(
                frame,
                annotationWindow(annotation, durationInFrames, fps),
                durationInFrames,
              );
              if (presence <= 0 || annotation.type === "zoom") return null;
              const key = `${annotation.type}-${index}-${annotation.timing.startSec}`;
              if (annotation.type === "highlight") {
                return (
                  <HighlightLayer
                    key={key}
                    annotation={annotation}
                    presence={presence}
                    theme={theme}
                  />
                );
              }
              if (annotation.type === "arrow") {
                return (
                  <ArrowLayer
                    key={key}
                    annotation={annotation}
                    presence={presence}
                    theme={theme}
                  />
                );
              }
              return <BlurLayer key={key} annotation={annotation} presence={presence} />;
            })}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
