import { cpSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseScenePlan, type ScenePlan } from "@dalang/core";
import { COMPOSITION_ID, FPS } from "@dalang/templates/layout";
import {
  type LogLevel,
  renderMedia,
  renderStill,
  selectComposition,
} from "@remotion/renderer";
import { findBrowserExecutable } from "./browser";
import { getBundle } from "./bundle-cache";
import { copyPlanAssets } from "./stage";

/**
 * Local RenderTarget (PRD §7.3). The interface stays small on purpose so a
 * cloud implementation (Remotion Lambda) can slot in later without touching
 * the pipeline: load plan → resolve bundle (cached) → overlay plan assets →
 * render.
 *
 * Encoding uses Remotion's bundled FFmpeg with libx264 for now; hardware
 * encoder detection (NVENC/AMF/QSV/VideoToolbox) is R-6, Fase 1.
 */

export type RenderProfile = "draft" | "final";

interface ProfileConfig {
  scale: number;
  crf: number;
  x264Preset: "veryfast" | "medium";
  jpegQuality: number;
  /** Draft renders burn in pipeline hints (unresolved assets etc.). */
  debug: boolean;
}

export const PROFILES: Record<RenderProfile, ProfileConfig> = {
  draft: { scale: 0.5, crf: 28, x264Preset: "veryfast", jpegQuality: 80, debug: true },
  final: { scale: 1, crf: 17, x264Preset: "medium", jpegQuality: 90, debug: false },
};

export const loadPlan = (planPath: string): ScenePlan => {
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

export interface ProgressEvent {
  stage: "bundling" | "rendering" | "encoding";
  /** 0..1 */
  progress: number;
}

export interface RenderBehaviorOptions {
  /** Skip the persistent bundle cache (always rebundle). */
  disableBundleCache?: boolean;
  /** Remotion render concurrency; null lets Remotion pick per machine. */
  concurrency?: number | null;
  logLevel?: LogLevel;
  onProgress?: (event: ProgressEvent) => void;
}

interface PreparedRender {
  plan: ScenePlan;
  serveUrl: string;
  inputProps: Record<string, unknown>;
  composition: Awaited<ReturnType<typeof selectComposition>>;
  browserExecutable: string | undefined;
  bundleFromCache: boolean;
  cleanup: () => void;
}

const prepare = async (
  planPath: string,
  profile: RenderProfile,
  options: RenderBehaviorOptions,
): Promise<PreparedRender> => {
  const logLevel = options.logLevel ?? "warn";
  const plan = loadPlan(planPath);
  const browserExecutable = findBrowserExecutable();

  const bundleResult = await getBundle({
    disableCache: options.disableBundleCache,
    onProgress: (progress) =>
      options.onProgress?.({ stage: "bundling", progress: progress / 100 }),
  });

  // Work on a throwaway copy so per-plan assets never pollute the cache.
  const renderDir = mkdtempSync(join(tmpdir(), "dalang-render-"));
  cpSync(bundleResult.bundleDir, renderDir, { recursive: true });
  if (bundleResult.ephemeral) {
    rmSync(bundleResult.bundleDir, { recursive: true, force: true });
  }
  copyPlanAssets(planPath, plan, join(renderDir, "public"));

  const inputProps = { plan, debug: PROFILES[profile].debug };
  const composition = await selectComposition({
    serveUrl: renderDir,
    id: COMPOSITION_ID,
    inputProps,
    browserExecutable,
    logLevel,
  });

  return {
    plan,
    serveUrl: renderDir,
    inputProps,
    composition,
    browserExecutable,
    bundleFromCache: bundleResult.fromCache,
    cleanup: () => rmSync(renderDir, { recursive: true, force: true }),
  };
};

export interface RenderVideoResult {
  outputLocation: string;
  durationInFrames: number;
  durationSec: number;
  sizeBytes: number;
  width: number;
  height: number;
  bundleFromCache: boolean;
}

export const renderPlanToVideo = async (
  options: {
    planPath: string;
    outputLocation: string;
    profile?: RenderProfile;
  } & RenderBehaviorOptions,
): Promise<RenderVideoResult> => {
  const profile = options.profile ?? "draft";
  const config = PROFILES[profile];
  const logLevel = options.logLevel ?? "warn";

  const prepared = await prepare(options.planPath, profile, options);
  try {
    await renderMedia({
      composition: prepared.composition,
      serveUrl: prepared.serveUrl,
      codec: "h264",
      outputLocation: options.outputLocation,
      inputProps: prepared.inputProps,
      browserExecutable: prepared.browserExecutable,
      crf: config.crf,
      x264Preset: config.x264Preset,
      scale: config.scale,
      imageFormat: "jpeg",
      jpegQuality: config.jpegQuality,
      concurrency: options.concurrency ?? null,
      logLevel,
      onProgress: ({ progress, stitchStage }) =>
        options.onProgress?.({
          stage: stitchStage === "muxing" ? "encoding" : "rendering",
          progress,
        }),
    });

    return {
      outputLocation: options.outputLocation,
      durationInFrames: prepared.composition.durationInFrames,
      durationSec: prepared.composition.durationInFrames / FPS,
      sizeBytes: statSync(options.outputLocation).size,
      width: Math.round(prepared.composition.width * config.scale),
      height: Math.round(prepared.composition.height * config.scale),
      bundleFromCache: prepared.bundleFromCache,
    };
  } finally {
    prepared.cleanup();
  }
};

export interface RenderStillsResult {
  outputs: Array<{ frame: number; outputLocation: string }>;
  durationInFrames: number;
  bundleFromCache: boolean;
}

/** Render one or more stills; bundles once for the whole batch. */
export const renderPlanStills = async (
  options: {
    planPath: string;
    /** Frame indexes; negative values count from the end (like Array.at). */
    frames: number[];
    outputLocationFor: (frame: number) => string;
    profile?: RenderProfile;
    scale?: number;
    imageFormat?: "png" | "jpeg";
  } & RenderBehaviorOptions,
): Promise<RenderStillsResult> => {
  const profile = options.profile ?? "final";
  const logLevel = options.logLevel ?? "warn";

  const prepared = await prepare(options.planPath, profile, options);
  try {
    const total = prepared.composition.durationInFrames;
    const outputs: RenderStillsResult["outputs"] = [];
    for (const requested of options.frames) {
      const frame = Math.min(
        Math.max(requested < 0 ? total + requested : requested, 0),
        total - 1,
      );
      const outputLocation = options.outputLocationFor(frame);
      await renderStill({
        composition: prepared.composition,
        serveUrl: prepared.serveUrl,
        output: outputLocation,
        frame,
        inputProps: prepared.inputProps,
        browserExecutable: prepared.browserExecutable,
        scale: options.scale ?? PROFILES[profile].scale,
        imageFormat: options.imageFormat ?? "png",
        jpegQuality:
          (options.imageFormat ?? "png") === "jpeg"
            ? PROFILES[profile].jpegQuality
            : undefined,
        logLevel,
      });
      outputs.push({ frame, outputLocation });
    }
    return {
      outputs,
      durationInFrames: total,
      bundleFromCache: prepared.bundleFromCache,
    };
  } finally {
    prepared.cleanup();
  }
};
