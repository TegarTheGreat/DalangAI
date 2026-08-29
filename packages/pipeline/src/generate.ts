import { readFileSync } from "node:fs";
import type { ScenePlan } from "@dalang/core";
import { runAssetStage } from "./asset-stage";
import { PipelineDb } from "./db";
import { atomicWriteFile } from "./fs-utils";
import { stableStringify } from "./hash";
import { readPlanFile } from "./load-plan";
import type { StockProvider, TtsProvider } from "./ports";
import { projectPaths } from "./project-paths";
import {
  consoleLogger,
  countErrors,
  type SceneStageResult,
  type StageLogger,
} from "./stage-types";
import { runTtsStage } from "./tts-stage";

/**
 * `dalang generate` — run the deterministic pipeline over a plan
 * (PRD §7.1 stages [2] TTS and [3] asset-resolve; captions [4] and compose
 * [5] are materialized at render time from renderState).
 *
 * The updated renderState is written back into the plan file: renderState is
 * part of the document (derived section), and materializing it is exactly
 * this command's job. Creative fields are never touched.
 */

export interface GenerateOptions {
  planPath: string;
  ttsProviders: TtsProvider[];
  stockProviders: StockProvider[];
  force?: boolean;
  log?: StageLogger;
}

export interface GenerateSummary {
  plan: ScenePlan;
  planPath: string;
  planChanged: boolean;
  tts: SceneStageResult[];
  assets: SceneStageResult[];
  errorCount: number;
  totalCostUsd: number;
}

export const generatePlan = async ({
  planPath,
  ttsProviders,
  stockProviders,
  force = false,
  log = consoleLogger,
}: GenerateOptions): Promise<GenerateSummary> => {
  const paths = projectPaths(planPath);
  const original = readPlanFile(paths.planPath);
  const db = new PipelineDb(paths.dbPath);

  try {
    log.info("→ Tahap TTS");
    const ttsOutcome = await runTtsStage({
      paths,
      plan: original,
      providers: ttsProviders,
      db,
      force,
      log,
    });

    log.info("→ Tahap aset");
    const assetOutcome = await runAssetStage({
      paths,
      plan: ttsOutcome.plan,
      providers: stockProviders,
      db,
      force,
      log,
    });

    const finalPlan = assetOutcome.plan;
    const planChanged = stableStringify(finalPlan) !== stableStringify(original);
    if (planChanged) {
      atomicWriteFile(paths.planPath, `${JSON.stringify(finalPlan, null, 2)}\n`);
    }

    const totalCostUsd = [...ttsOutcome.results, ...assetOutcome.results].reduce(
      (sum, result) => sum + (result.costUsd ?? 0),
      0,
    );

    return {
      plan: finalPlan,
      planPath: paths.planPath,
      planChanged,
      tts: ttsOutcome.results,
      assets: assetOutcome.results,
      errorCount: countErrors(ttsOutcome.results) + countErrors(assetOutcome.results),
      totalCostUsd,
    };
  } finally {
    db.close();
  }
};

/** Raw file content helper for callers that need diff display. */
export const readPlanRaw = (planPath: string): string => readFileSync(planPath, "utf8");
