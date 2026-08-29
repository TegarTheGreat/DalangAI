import { readFileSync } from "node:fs";
import { parseScenePlan, type ScenePlan } from "@dalang/core";

/** Read + validate a plan file with friendly errors (mirrors the renderer's). */
export const readPlanFile = (planPath: string): ScenePlan => {
  let raw: string;
  try {
    raw = readFileSync(planPath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    throw new Error(
      `Tidak bisa membaca scene-plan "${planPath}"${code ? ` (${code})` : ""}`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Scene-plan bukan JSON yang valid: ${planPath}\n${(error as Error).message}`,
    );
  }
  return parseScenePlan(json);
};
