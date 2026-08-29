import type { ResolvedAsset, Scene, ScenePlan } from "@dalang/core";
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
}> = ({ scene, sceneIndex, plan, asset, metrics, theme, durationInFrames, debug }) => {
  const unresolved =
    !asset &&
    (scene.visual.type === "stock" ||
      scene.visual.type === "image" ||
      scene.visual.type === "generated" ||
      scene.visual.type === "screenshot");

  return (
    <AbsoluteFill>
      <Backdrop
        scene={scene}
        sceneIndex={sceneIndex}
        asset={asset}
        theme={theme}
        durationInFrames={durationInFrames}
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
          aset belum di-resolve · {scene.visual.query ?? scene.visual.type}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
