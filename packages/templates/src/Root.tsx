import { Composition, type CalculateMetadataFunction } from "remotion";
import { DIMENSIONS, parseScenePlan } from "@dalang/core";
import demoPlan from "../../../examples/borobudur-60s/plan.json";
import { DalangVideo, type DalangVideoProps } from "./DalangVideo";
import { computeFrameLayout, FPS } from "./layout";

/**
 * The one composition: any scene-plan in, video out. Duration and dimensions
 * are derived from the plan itself (calculateMetadata), so the renderer and
 * the Studio never hardcode timing.
 */

export const calculateDalangMetadata: CalculateMetadataFunction<
  DalangVideoProps
> = ({ props }) => {
  const plan = parseScenePlan(props.plan);
  const layout = computeFrameLayout(plan);
  const { width, height } = DIMENSIONS[plan.meta.aspectRatio];
  return {
    durationInFrames: layout.totalFrames,
    fps: FPS,
    width,
    height,
    props: { ...props, plan },
  };
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Dalang"
      component={DalangVideo}
      defaultProps={{ plan: demoPlan as DalangVideoProps["plan"], debug: false }}
      calculateMetadata={calculateDalangMetadata}
      fps={FPS}
      width={1080}
      height={1920}
      durationInFrames={1500}
    />
  );
};
