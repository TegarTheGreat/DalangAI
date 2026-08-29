import { readFileSync, statSync } from "node:fs";
import { bundle } from "@remotion/bundler";
import {
  renderMedia,
  renderStill,
  selectComposition,
  type LogLevel,
} from "@remotion/renderer";
import { parseScenePlan, type ScenePlan } from "@dalang/core";
import { templatesEntry } from "@dalang/templates/paths";
import { COMPOSITION_ID, FPS } from "@dalang/templates/layout";
import { findBrowserExecutable } from "./browser";
import { stagePublicDir } from "./stage";

/**
 * Local RenderTarget (PRD §7.3). The interface stays small on purpose so a
 * cloud implementation (Remotion Lambda) can slot in later without touching
 * the pipeline: load plan → stage inputs → bundle → render.
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

export const loadPlan = (planPath: string): ScenePlan =>
  parseScenePlan(JSON.parse(readFileSync(planPath, "utf8")));

export interface ProgressEvent {
  stage: "bundling" | "rendering" | "encoding";
  /** 0..1 */
  progress: number;
}

interface PreparedRender {
  plan: ScenePlan;
  serveUrl: string;
  inputProps: Record<string, unknown>;
  composition: Awaited<ReturnType<typeof selectComposition>>;
  browserExecutable: string | undefined;
  cleanup: () => void;
}

const prepare = async (
  planPath: string,
  profile: RenderProfile,
  logLevel: LogLevel,
  onProgress?: (event: ProgressEvent) => void,
): Promise<PreparedRender> => {
  const plan = loadPlan(planPath);
  const staged = stagePublicDir(planPath, plan);
  const browserExecutable = findBrowserExecutable();

  const serveUrl = await bundle({
    entryPoint: templatesEntry,
    publicDir: staged.dir,
    onProgress: (progress) =>
      onProgress?.({ stage: "bundling", progress: progress / 100 }),
  });

  const inputProps = { plan, debug: PROFILES[profile].debug };
  const composition = await selectComposition({
    serveUrl,
    id: COMPOSITION_ID,
    inputProps,
    browserExecutable,
    logLevel,
  });

  return {
    plan,
    serveUrl,
    inputProps,
    composition,
    browserExecutable,
    cleanup: staged.cleanup,
  };
};

export interface RenderVideoResult {
  outputLocation: string;
  durationInFrames: number;
  durationSec: number;
  sizeBytes: number;
  width: number;
  height: number;
}

export const renderPlanToVideo = async (options: {
  planPath: string;
  outputLocation: string;
  profile?: RenderProfile;
  logLevel?: LogLevel;
  onProgress?: (event: ProgressEvent) => void;
}): Promise<RenderVideoResult> => {
  const profile = options.profile ?? "draft";
  const config = PROFILES[profile];
  const logLevel = options.logLevel ?? "warn";

  const prepared = await prepare(
    options.planPath,
    profile,
    logLevel,
    options.onProgress,
  );
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
    };
  } finally {
    prepared.cleanup();
  }
};

export interface RenderStillsResult {
  outputs: Array<{ frame: number; outputLocation: string }>;
  durationInFrames: number;
}

/** Render one or more PNG stills; bundles once for the whole batch. */
export const renderPlanStills = async (options: {
  planPath: string;
  /** Frame indexes; negative values count from the end (like Array.at). */
  frames: number[];
  outputLocationFor: (frame: number) => string;
  profile?: RenderProfile;
  scale?: number;
  imageFormat?: "png" | "jpeg";
  logLevel?: LogLevel;
  onProgress?: (event: ProgressEvent) => void;
}): Promise<RenderStillsResult> => {
  const profile = options.profile ?? "final";
  const logLevel = options.logLevel ?? "warn";

  const prepared = await prepare(
    options.planPath,
    profile,
    logLevel,
    options.onProgress,
  );
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
    return { outputs, durationInFrames: total };
  } finally {
    prepared.cleanup();
  }
};
