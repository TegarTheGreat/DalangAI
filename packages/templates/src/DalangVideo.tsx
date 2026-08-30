import { parseScenePlan, type ScenePlanInput } from "@dalang/core";
import { useMemo } from "react";
import { AssetBaseUrlProvider } from "./asset-src";
import { DocumentaryPreset } from "./presets/documentary-01/index";
import { TutorialPreset } from "./presets/tutorial-01/index";

/**
 * Entry component: routes a scene-plan to its style preset.
 * The plan prop is re-validated here so the component is safe to embed
 * anywhere (@remotion/player in the Fase 3 UI, renderer, Studio).
 */

export type DalangVideoProps = {
  plan: ScenePlanInput;
  /** Draft renders overlay pipeline hints (e.g. unresolved assets). */
  debug?: boolean;
  /**
   * URL dasar aset PLAN untuk render cloud (ADR-0019). null/tidak diisi =
   * aset diambil dari public dir bundle lewat staticFile, seperti render lokal
   * dan preview Player. Sengaja prop render-time, BUKAN field scene-plan:
   * alamat bucket adalah detail penyebaran, bukan keputusan kreatif, dan tidak
   * boleh ikut masuk patch log, undo, maupun diff dokumen.
   */
  assetBaseUrl?: string | null;
};

const PRESETS: Record<
  string,
  React.FC<{ plan: ReturnType<typeof parseScenePlan>; debug: boolean }>
> = {
  "documentary-01": DocumentaryPreset,
  "tutorial-01": TutorialPreset,
};

export const DalangVideo: React.FC<DalangVideoProps> = ({
  plan: rawPlan,
  debug = false,
  assetBaseUrl = null,
}) => {
  const plan = useMemo(() => parseScenePlan(rawPlan), [rawPlan]);

  const Preset = PRESETS[plan.meta.stylePreset];
  if (!Preset) {
    console.warn(
      `Style preset "${plan.meta.stylePreset}" tidak dikenal — memakai documentary-01`,
    );
  }
  const Chosen = Preset ?? DocumentaryPreset;
  return (
    <AssetBaseUrlProvider value={assetBaseUrl}>
      <Chosen plan={plan} debug={debug} />
    </AssetBaseUrlProvider>
  );
};
