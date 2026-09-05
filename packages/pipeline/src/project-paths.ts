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
 *   <planDir>/.dalang/proxies/<hash>-<sisi>p.mp4  proxy pratinjau (ADR-0028)
 *   <planDir>/.dalang/thumbs/  <planDir>/.dalang/peaks/   cache Studio (ADR-0028)
 */

export interface ProjectPaths {
  planPath: string;
  planDir: string;
  dalangDir: string;
  dbPath: string;
  ttsDir: string;
  assetsDir: string;
  /** Proxy pratinjau berkas video (ADR-0028) — turunan, boleh dihapus kapan saja. */
  proxiesDir: string;
  /** Bingkai thumbnail rekaman untuk Studio (ADR-0028) — cache, bukan data. */
  thumbsDir: string;
  /** Bentuk gelombang rekaman untuk Studio (ADR-0028) — cache, bukan data. */
  peaksDir: string;
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
    proxiesDir: join(dalangDir, "proxies"),
    thumbsDir: join(dalangDir, "thumbs"),
    peaksDir: join(dalangDir, "peaks"),
    relFromPlan: (absPath: string) =>
      absPath
        .slice(planDir.length + 1)
        .split("\\")
        .join("/"),
  };
  mkdirSync(paths.ttsDir, { recursive: true });
  mkdirSync(paths.assetsDir, { recursive: true });
  // Folder proxy/thumb/peaks dibuat MALAS oleh tahapnya masing-masing: sebagian
  // besar proyek tidak pernah memakainya, dan tiga folder kosong di setiap
  // proyek hanya mengaburkan mana yang benar-benar dipakai.
  return paths;
};
