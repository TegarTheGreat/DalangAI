import {
  primaryClip,
  type ResolvedAsset,
  type Scene,
  type ScenePlan,
} from "@dalang/core";
import { AbsoluteFill } from "remotion";
import type { AspectMetrics } from "../../layout";
import { Backdrop } from "./Backdrop";
import { CaptionsOverlay } from "./CaptionsOverlay";
import type { DocTheme } from "./theme";

/** Standard narrated scene: full-bleed visual + synced captions. */
export const BodyScene: React.FC<{
  scene: Scene;
  sceneIndex: number;
  plan: ScenePlan;
  asset: ResolvedAsset | undefined;
  metrics: AspectMetrics;
  theme: DocTheme;
  durationInFrames: number;
  debug: boolean;
  /** Amplop volume suara aset (ADR-0026). */
  volume?: ((frame: number) => number) | undefined;
}> = ({
  scene,
  sceneIndex,
  plan,
  asset,
  metrics,
  theme,
  durationInFrames,
  debug,
  volume,
}) => {
  const unresolved =
    !asset &&
    (primaryClip(scene).type === "stock" ||
      primaryClip(scene).type === "image" ||
      primaryClip(scene).type === "generated" ||
      primaryClip(scene).type === "screenshot");

  return (
    <AbsoluteFill>
      <Backdrop
        scene={scene}
        sceneIndex={sceneIndex}
        asset={asset}
        theme={theme}
        durationInFrames={durationInFrames}
        volume={volume}
      />
      <CaptionsOverlay
        scene={scene}
        plan={plan}
        sceneDurationFrames={durationInFrames}
        metrics={metrics}
        theme={theme}
      />
      {debug && unresolved ? (
        <div
          style={{
            position: "absolute",
            left: metrics.marginX,
            bottom: metrics.marginTop * 0.5,
            fontFamily: "monospace",
            fontSize: 22,
            color: "rgba(245, 240, 230, 0.55)",
            backgroundColor: "rgba(0, 0, 0, 0.4)",
            padding: "6px 12px",
            borderRadius: 6,
          }}
        >
          aset belum di-resolve · {primaryClip(scene).query ?? primaryClip(scene).type}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
