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

// ---------------------------------------------------------------------------
// Pengaturan ekspor (ADR-0014): format kontainer + resolusi + mutu enkode.
// Profil lama tetap ada sebagai makro default; pengaturan eksplisit menimpa.
// ---------------------------------------------------------------------------

export const VIDEO_FORMATS = ["mp4", "hevc", "webm", "mov"] as const;
export type VideoFormat = (typeof VIDEO_FORMATS)[number];

/** Sisi pendek dalam piksel; komposisi dasar 1080. */
export const VIDEO_RESOLUTIONS = [540, 720, 1080] as const;
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];

export const ENCODE_QUALITIES = ["cepat", "seimbang", "terbaik"] as const;
export type EncodeQuality = (typeof ENCODE_QUALITIES)[number];

export interface ExportSettings {
  format: VideoFormat;
  resolution: VideoResolution;
  quality: EncodeQuality;
}

export const DEFAULT_EXPORT_SETTINGS: Record<RenderProfile, ExportSettings> = {
  draft: { format: "mp4", resolution: 540, quality: "cepat" },
  final: { format: "mp4", resolution: 1080, quality: "seimbang" },
};

export const resolveExportSettings = (
  profile: RenderProfile,
  overrides?: Partial<ExportSettings>,
): ExportSettings => ({ ...DEFAULT_EXPORT_SETTINGS[profile], ...overrides });

/** Ekstensi file untuk format (hevc tetap .mp4; mov = kontainer QuickTime). */
export const extensionFor = (format: VideoFormat): string =>
  format === "hevc" ? "mp4" : format;

export interface EncoderArgs {
  codec: "h264" | "h265" | "vp9" | "prores";
  scale: number;
  audioCodec: "aac" | "opus" | "pcm-16";
  crf?: number;
  x264Preset?: "veryfast" | "medium" | "slow";
  proResProfile?: "proxy" | "standard" | "hq";
  audioBitrate?: `${number}k`;
  jpegQuality: number;
}

/**
 * Peta (format, resolusi, mutu) → argumen encoder Remotion/FFmpeg.
 * Skala CRF berbeda per codec (VP9 memakai rentang lebih tinggi); ProRes
 * tidak ber-CRF — mutunya lewat profil. Audio: AAC utk MP4, Opus utk WebM,
 * PCM 16-bit utk master ProRes.
 */
export const encoderArgs = (settings: ExportSettings): EncoderArgs => {
  const scale = settings.resolution / 1080;
  const q = settings.quality;
  const jpegQuality = q === "cepat" ? 80 : q === "seimbang" ? 90 : 95;
  switch (settings.format) {
    case "mp4":
      return {
        codec: "h264",
        scale,
        audioCodec: "aac",
        crf: q === "cepat" ? 23 : q === "seimbang" ? 18 : 15,
        x264Preset: q === "cepat" ? "veryfast" : q === "seimbang" ? "medium" : "slow",
        audioBitrate: q === "cepat" ? "128k" : "192k",
        jpegQuality,
      };
    case "hevc":
      // Skala CRF H.265 bergeser ~+5 dari H.264 utk mutu visual setara.
      return {
        codec: "h265",
        scale,
        audioCodec: "aac",
        crf: q === "cepat" ? 28 : q === "seimbang" ? 23 : 20,
        audioBitrate: q === "cepat" ? "128k" : "192k",
        jpegQuality,
      };
    case "webm":
      return {
        codec: "vp9",
        scale,
        audioCodec: "opus",
        crf: q === "cepat" ? 36 : q === "seimbang" ? 32 : 28,
        audioBitrate: "128k",
        jpegQuality,
      };
    case "mov":
      return {
        codec: "prores",
        scale,
        audioCodec: "pcm-16",
        proResProfile: q === "cepat" ? "proxy" : q === "seimbang" ? "standard" : "hq",
        jpegQuality,
      };
  }
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
  settings: ExportSettings;
}

export const renderPlanToVideo = async (
  options: {
    planPath: string;
    outputLocation: string;
    profile?: RenderProfile;
    /** Menimpa default profil (ADR-0014): format, resolusi, mutu enkode. */
    settings?: Partial<ExportSettings>;
  } & RenderBehaviorOptions,
): Promise<RenderVideoResult> => {
  const profile = options.profile ?? "draft";
  const settings = resolveExportSettings(profile, options.settings);
  const enc = encoderArgs(settings);
  const logLevel = options.logLevel ?? "warn";

  const prepared = await prepare(options.planPath, profile, options);
  try {
    await renderMedia({
      composition: prepared.composition,
      serveUrl: prepared.serveUrl,
      codec: enc.codec,
      audioCodec: enc.audioCodec,
      outputLocation: options.outputLocation,
      inputProps: prepared.inputProps,
      browserExecutable: prepared.browserExecutable,
      ...(enc.crf !== undefined ? { crf: enc.crf } : {}),
      ...(enc.x264Preset ? { x264Preset: enc.x264Preset } : {}),
      ...(enc.proResProfile ? { proResProfile: enc.proResProfile } : {}),
      ...(enc.audioBitrate ? { audioBitrate: enc.audioBitrate } : {}),
      scale: enc.scale,
      imageFormat: "jpeg",
      jpegQuality: enc.jpegQuality,
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
      width: Math.round(prepared.composition.width * enc.scale),
      height: Math.round(prepared.composition.height * enc.scale),
      bundleFromCache: prepared.bundleFromCache,
      settings,
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
