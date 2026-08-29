import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { templatesEntry, templatesPublicDir } from "@dalang/templates/paths";
import { bundle } from "@remotion/bundler";
import { computeBundleFingerprint } from "./fingerprint";
import { stageTemplatesPublic } from "./stage";

/**
 * Persistent webpack-bundle cache. Bundling the templates takes 15–30s; with
 * an unchanged fingerprint a render starts in ~1s instead. The cached bundle
 * bakes only the templates' static files (fonts) — per-plan assets are
 * overlaid into a copy at render time, so the cache can never serve stale
 * plan assets.
 *
 * Location: $DALANG_CACHE_DIR or ~/.cache/dalang. Invalidation: content
 * fingerprint (see fingerprint.ts); `--no-cache` bypasses entirely.
 */

const COMPLETE_MARKER = ".dalang-bundle-complete";

export const dalangCacheDir = (): string =>
  process.env.DALANG_CACHE_DIR ?? join(homedir(), ".cache", "dalang");

export interface BundleResult {
  bundleDir: string;
  fromCache: boolean;
  fingerprint: string;
  /** True when bundleDir is a throwaway build (caller removes it after copying). */
  ephemeral: boolean;
}

export const getBundle = async (options: {
  disableCache?: boolean;
  onProgress?: (progress: number) => void;
}): Promise<BundleResult> => {
  const fingerprint = computeBundleFingerprint();
  const cached = join(dalangCacheDir(), "bundles", fingerprint);

  if (!options.disableCache && existsSync(join(cached, COMPLETE_MARKER))) {
    return { bundleDir: cached, fromCache: true, fingerprint, ephemeral: false };
  }

  const cleanPublic = stageTemplatesPublic(templatesPublicDir);
  let built: string;
  try {
    built = await bundle({
      entryPoint: templatesEntry,
      publicDir: cleanPublic.dir,
      onProgress: options.onProgress,
    });
  } finally {
    cleanPublic.cleanup();
  }

  if (options.disableCache) {
    return { bundleDir: built, fromCache: false, fingerprint, ephemeral: true };
  }

  rmSync(cached, { recursive: true, force: true });
  mkdirSync(dirname(cached), { recursive: true });
  cpSync(built, cached, { recursive: true });
  writeFileSync(join(cached, COMPLETE_MARKER), new Date().toISOString());
  rmSync(built, { recursive: true, force: true });
  return { bundleDir: cached, fromCache: false, fingerprint, ephemeral: false };
};
