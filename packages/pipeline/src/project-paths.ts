import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Pipeline outputs live NEXT TO the plan, under `.dalang/` — media must stay
 * inside the project folder because renderState file paths are plan-relative
 * (local-first, portable, and the renderer's staging safety depends on it).
 *
 *   <planDir>/.dalang/pipeline.db     stage-run ledger
 *   <planDir>/.dalang/tts/<hash>.*    narration audio (content-addressed)
 *   <planDir>/.dalang/assets/<hash>.* fetched stock assets
 */

export interface ProjectPaths {
  planPath: string;
  planDir: string;
  dalangDir: string;
  dbPath: string;
  ttsDir: string;
  assetsDir: string;
  /** Plan-relative path (POSIX separators) for renderState. */
  relFromPlan(absPath: string): string;
}

export const projectPaths = (planPath: string): ProjectPaths => {
  const absPlan = resolve(planPath);
  const planDir = dirname(absPlan);
  const dalangDir = join(planDir, ".dalang");
  const paths: ProjectPaths = {
    planPath: absPlan,
    planDir,
    dalangDir,
    dbPath: join(dalangDir, "pipeline.db"),
    ttsDir: join(dalangDir, "tts"),
    assetsDir: join(dalangDir, "assets"),
    relFromPlan: (absPath: string) =>
      absPath
        .slice(planDir.length + 1)
        .split("\\")
        .join("/"),
  };
  mkdirSync(paths.ttsDir, { recursive: true });
  mkdirSync(paths.assetsDir, { recursive: true });
  return paths;
};
