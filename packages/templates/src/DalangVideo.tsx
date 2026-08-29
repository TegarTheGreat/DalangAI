import { parseScenePlan, type ScenePlanInput } from "@dalang/core";
import { useMemo } from "react";
import { DocumentaryPreset } from "./presets/documentary-01/index";

/**
 * Entry component: routes a scene-plan to its style preset.
 * The plan prop is re-validated here so the component is safe to embed
 * anywhere (@remotion/player in the Fase 3 UI, renderer, Studio).
 */

export type DalangVideoProps = {
  plan: ScenePlanInput;
  /** Draft renders overlay pipeline hints (e.g. unresolved assets). */
  debug?: boolean;
};

const PRESETS: Record<
  string,
  React.FC<{ plan: ReturnType<typeof parseScenePlan>; debug: boolean }>
> = {
  "documentary-01": DocumentaryPreset,
};

export const DalangVideo: React.FC<DalangVideoProps> = ({
  plan: rawPlan,
  debug = false,
}) => {
  const plan = useMemo(() => parseScenePlan(rawPlan), [rawPlan]);

  const Preset = PRESETS[plan.meta.stylePreset];
  if (!Preset) {
    console.warn(
      `Style preset "${plan.meta.stylePreset}" tidak dikenal — memakai documentary-01`,
    );
  }
  const Chosen = Preset ?? DocumentaryPreset;
  return <Chosen plan={plan} debug={debug} />;
};
