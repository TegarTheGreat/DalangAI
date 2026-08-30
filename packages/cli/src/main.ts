import { mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  computeTimeline,
  countWords,
  critiquePlan,
  formatDirectorNotes,
  resolveSceneDurationSec,
  type ScenePlan,
} from "@dalang/core";
import { generatePlan, readPlanFile, type SceneStageResult } from "@dalang/pipeline";
import { buildStockChain, buildTtsChain } from "@dalang/providers";
import {
  ENCODE_QUALITIES,
  type EncodeQuality,
  extensionFor,
  loadPlan,
  localRenderTarget,
  type ProgressEvent,
  type RenderProfile,
  type RenderTargetProgress,
  renderPlanStills,
  renderPlanToVideo,
  resolveExportSettings,
  VIDEO_FORMATS,
  VIDEO_RESOLUTIONS,
  type VideoFormat,
  type VideoResolution,
} from "@dalang/renderer";
import { computeFrameLayout, FPS, TRANSITION_FRAMES } from "@dalang/templates/layout";
import { Command, InvalidArgumentError, Option } from "commander";
import { registerChatCommand, registerLogCommand } from "./chat";
import { buildLambdaTarget, readCloudConfig, registerCloudCommands } from "./cloud";
import { planPathOf } from "./project-path";
import { registerProvidersCheckCommand } from "./providers-check";
import { registerStudioCommand } from "./studio";

/**
 * `dalang` — CLI: validate, generate (deterministic pipeline, Fase 1), and
 * render a scene-plan locally.
 */

// API keys (ELEVENLABS_API_KEY, PEXELS_API_KEY, …) may live in a local .env.
try {
  process.loadEnvFile();
} catch {
  // .env is optional
}

const program = new Command();
program
  .name("dalang")
  .description(
    "Dalang AI — render video dari scene-plan JSON (agent-piloted video editor)",
  )
  .version("0.1.0");

const profileOption = () =>
  new Option("--profile <profile>", "profil render").choices(["draft", "final"]);

const parseSeconds = (value: string): number => {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new InvalidArgumentError(`"${value}" bukan detik yang valid (angka ≥ 0)`);
  }
  return seconds;
};

const parsePositiveInt = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError(`"${value}" bukan bilangan bulat ≥ 1`);
  }
  return parsed;
};

const parseScale = (value: string): number => {
  const scale = Number(value);
  if (!Number.isFinite(scale) || scale <= 0 || scale > 1) {
    throw new InvalidArgumentError(`"${value}" bukan skala valid (0 < s ≤ 1)`);
  }
  return scale;
};

const collectSeconds = (value: string, previous: number[]): number[] => [
  ...previous,
  parseSeconds(value),
];

const formatSec = (sec: number): string => `${sec.toFixed(1)}s`;

const printPlanSummary = (plan: ScenePlan): void => {
  const layout = computeFrameLayout(plan);
  const { timings, totalSec } = computeTimeline(plan);

  console.log(`\n  ${plan.meta.title}`);
  console.log(
    `  ${plan.meta.aspectRatio} · preset ${plan.meta.stylePreset} · bahasa ${plan.meta.language}\n`,
  );
  const rows = plan.scenes.map((scene, index) => {
    const audio = plan.renderState.narrationAudio[scene.id];
    return {
      "#": index + 1,
      id: scene.id,
      tipe: scene.visual.type,
      kata: countWords(scene.narration),
      durasi: formatSec(resolveSceneDurationSec(scene, plan)),
      suara: audio
        ? audio.fallbackQuality
          ? "fallback"
          : "ok"
        : scene.narration.trim()
          ? "—"
          : "",
      aset:
        plan.renderState.resolvedAssets[scene.id]?.file ??
        (scene.visual.type === "template-anim" || scene.visual.type === "solid"
          ? "(template)"
          : "(belum di-resolve)"),
      lock: scene.locked ? "terkunci" : "",
    };
  });
  console.table(rows);
  console.log(
    `  Total: ${timings.length} scene · ${formatSec(totalSec)} materi · ` +
      `${formatSec(layout.totalFrames / FPS)} durasi video ` +
      `(${layout.totalFrames} frame @ ${FPS}fps, crossfade ${TRANSITION_FRAMES} frame)\n`,
  );
};

const progressPrinter = () => {
  let lastLine = "";
  // Menerima tahap dari KEDUA target: render lokal tidak mengenal "uploading"
  // dan "downloading", render cloud tidak mengenal "bundling".
  return (event: ProgressEvent | RenderTargetProgress) => {
    const line = `  ${event.stage} ${(event.progress * 100).toFixed(0)}%`;
    if (line !== lastLine) {
      process.stdout.write(`\r${line.padEnd(40)}`);
      lastLine = line;
    }
  };
};

program
  .command("validate")
  .argument("<proyek>", "folder proyek atau path plan.json")
  .description("Validasi scene-plan terhadap skema v0 dan tampilkan ringkasan")
  .action((planPath: string) => {
    const plan = loadPlan(planPathOf(planPath));
    console.log("Scene-plan valid (skema v0).");
    printPlanSummary(plan);
    // Kritik sutradara (ADR-0014): heuristik anti-"generic", murni saran.
    const notes = critiquePlan(plan);
    if (notes.length > 0) {
      console.log("  Saran sutradara:");
      for (const line of formatDirectorNotes(notes)) {
        console.log(`  - ${line}`);
      }
      console.log("");
    }
  });

program
  .command("still")
  .argument("<proyek>", "folder proyek atau path plan.json")
  .option(
    "-t, --time <detik...>",
    "waktu (detik) yang di-render; bisa lebih dari satu",
    collectSeconds,
    [] as number[],
  )
  .option("-o, --out-dir <dir>", "folder output", "out")
  .option("-s, --scale <scale>", "skala render (1 = 1080p)", parseScale, 1)
  .addOption(profileOption().default("final"))
  .addOption(
    new Option("--format <format>", "format gambar")
      .choices(["png", "jpeg"])
      .default("png"),
  )
  .option("--no-cache", "jangan pakai bundle cache (selalu bundling ulang)")
  .description("Render satu atau beberapa frame (PNG/JPEG) untuk cek visual")
  .action(
    async (
      planPath: string,
      options: {
        time: number[];
        outDir: string;
        scale: number;
        profile: RenderProfile;
        format: "png" | "jpeg";
        cache: boolean;
      },
    ) => {
      const absPlan = planPathOf(planPath);
      const name = basename(dirname(absPlan));
      mkdirSync(resolve(options.outDir), { recursive: true });
      const times = options.time.length > 0 ? options.time : [1];
      const frames = times.map((t) => Math.round(t * FPS));
      const extension = options.format === "jpeg" ? "jpg" : "png";
      const { outputs, bundleFromCache } = await renderPlanStills({
        planPath: absPlan,
        frames,
        scale: options.scale,
        profile: options.profile,
        imageFormat: options.format,
        disableBundleCache: !options.cache,
        outputLocationFor: (frame) =>
          join(resolve(options.outDir), `${name}-f${frame}.${extension}`),
        onProgress: progressPrinter(),
      });
      process.stdout.write("\n");
      if (bundleFromCache) console.log("  (bundle cache: hit)");
      for (const output of outputs) {
        console.log(`frame ${output.frame} → ${output.outputLocation}`);
      }
    },
  );

registerCloudCommands(program);

program
  .command("render")
  .argument("<proyek>", "folder proyek atau path plan.json")
  .option("-o, --out <file>", "file output video")
  .addOption(profileOption().default("draft"))
  .addOption(
    new Option(
      "--video-format <format>",
      "format kontainer (ADR-0014); menimpa default profil",
    ).choices(VIDEO_FORMATS),
  )
  .addOption(
    new Option("--resolution <p>", "sisi pendek piksel").choices(
      VIDEO_RESOLUTIONS.map(String),
    ),
  )
  .addOption(new Option("--quality <mutu>", "mutu enkode").choices(ENCODE_QUALITIES))
  .option(
    "--concurrency <n>",
    "jumlah tab render paralel (default: otomatis)",
    parsePositiveInt,
  )
  .option("--no-cache", "jangan pakai bundle cache (selalu bundling ulang)")
  .addOption(
    new Option("--target <tujuan>", "di mana render dijalankan (ADR-0019)")
      .choices(["local", "lambda"])
      .default("local"),
  )
  .description("Render scene-plan menjadi video (MP4 H.264 / WebM VP9 / MOV ProRes)")
  .action(
    async (
      planPath: string,
      options: {
        out?: string;
        profile: RenderProfile;
        videoFormat?: VideoFormat;
        resolution?: string;
        quality?: EncodeQuality;
        concurrency?: number;
        cache: boolean;
        target: "local" | "lambda";
      },
    ) => {
      const absPlan = planPathOf(planPath);
      const plan = loadPlan(absPlan);
      printPlanSummary(plan);

      const overrides = {
        ...(options.videoFormat ? { format: options.videoFormat } : {}),
        ...(options.resolution
          ? { resolution: Number(options.resolution) as VideoResolution }
          : {}),
        ...(options.quality ? { quality: options.quality } : {}),
      };
      const settings = resolveExportSettings(options.profile, overrides);
      const name = basename(dirname(absPlan));
      const outPath = resolve(
        options.out ??
          join(
            "out",
            `${name}-${settings.resolution}p-${settings.quality}.${extensionFor(settings.format)}`,
          ),
      );
      mkdirSync(dirname(outPath), { recursive: true });

      const target =
        options.target === "lambda"
          ? (() => {
              const read = readCloudConfig();
              if (!read.ok) {
                console.error(
                  "Render cloud belum diatur. Jalankan `dalang cloud:check` untuk melihat apa yang kurang.",
                );
                process.exit(1);
              }
              return buildLambdaTarget(read.config);
            })()
          : localRenderTarget({
              concurrency: options.concurrency ?? null,
              disableBundleCache: !options.cache,
            });

      if (target.id !== "local") {
        const estimate = await target.estimateCost({
          planPath: absPlan,
          outputLocation: outPath,
          profile: options.profile,
        });
        console.log(`  target ${target.label} · estimasi ~$${estimate.usd.toFixed(4)}`);
      }

      const startedAt = Date.now();
      const result = await target.render({
        planPath: absPlan,
        outputLocation: outPath,
        profile: options.profile,
        settings: overrides,
        onProgress: progressPrinter(),
      });
      process.stdout.write("\n");

      const elapsed = (Date.now() - startedAt) / 1000;
      console.log(
        `selesai: ${result.outputLocation}\n` +
          `  ${result.settings.format} ${result.width}×${result.height} (${result.settings.quality}) · ` +
          `${formatSec(result.durationSec)} · ` +
          `${(result.sizeBytes / 1024 / 1024).toFixed(1)} MB · render ${formatSec(elapsed)}` +
          `${result.bundleFromCache ? " · bundle cache: hit" : ""}`,
      );
    },
  );

const STATUS_ICON: Record<SceneStageResult["status"], string> = {
  done: "ok",
  cached: "cache",
  skipped: "lewat",
  error: "GAGAL",
};

const printStageResults = (title: string, results: SceneStageResult[]): void => {
  if (results.length === 0) {
    console.log(`  ${title}: tidak ada scene yang perlu diproses`);
    return;
  }
  console.log(`  ${title}:`);
  for (const result of results) {
    const cost =
      result.costUsd && result.costUsd > 0 ? ` · ~$${result.costUsd.toFixed(4)}` : "";
    console.log(
      `    ${STATUS_ICON[result.status]} ${result.sceneId.padEnd(10)} ${result.detail}${cost}`,
    );
  }
};

program
  .command("generate")
  .argument("<proyek>", "folder proyek atau path plan.json")
  .option("--force", "abaikan cache — jalankan ulang semua stage")
  .addOption(
    new Option("--render <profile>", "langsung render setelah pipeline selesai").choices([
      "draft",
      "final",
    ]),
  )
  .description(
    "Jalankan pipeline deterministik (TTS + resolve aset) dan tulis renderState ke plan",
  )
  .action(
    async (planPath: string, options: { force?: boolean; render?: RenderProfile }) => {
      const absPlan = planPathOf(planPath);
      const peek = readPlanFile(absPlan);

      const ttsProviders = peek.audio.voice
        ? buildTtsChain({ provider: peek.audio.voice.provider })
        : [];
      const stockProviders = buildStockChain();

      const summary = await generatePlan({
        planPath: absPlan,
        ttsProviders,
        stockProviders,
        force: options.force,
        log: {
          info: (message) => console.log(message),
          warn: (message) => console.warn(message),
        },
      });

      console.log("");
      printStageResults("TTS", summary.tts);
      printStageResults("Aset", summary.assets);
      console.log(
        `\n  ${summary.planChanged ? "renderState ditulis ke" : "Tidak ada perubahan pada"} ${summary.planPath}` +
          (summary.totalCostUsd > 0
            ? ` · perkiraan biaya ~$${summary.totalCostUsd.toFixed(4)}`
            : ""),
      );
      printPlanSummary(summary.plan);

      if (summary.errorCount > 0) {
        process.exitCode = 1;
        console.error(
          `GAGAL: ${summary.errorCount} scene bermasalah — lihat detail di atas (ledger: .dalang/pipeline.db)`,
        );
        return;
      }

      if (options.render) {
        const name = basename(dirname(absPlan));
        const outPath = resolve(join("out", `${name}-${options.render}.mp4`));
        mkdirSync(dirname(outPath), { recursive: true });
        const startedAt = Date.now();
        const result = await renderPlanToVideo({
          planPath: absPlan,
          outputLocation: outPath,
          profile: options.render,
          onProgress: progressPrinter(),
        });
        process.stdout.write("\n");
        console.log(
          `selesai: ${result.outputLocation}\n` +
            `  ${result.width}×${result.height} · ${formatSec(result.durationSec)} · ` +
            `${(result.sizeBytes / 1024 / 1024).toFixed(1)} MB · render ${formatSec((Date.now() - startedAt) / 1000)}`,
        );
      }
    },
  );

registerChatCommand(program);
registerLogCommand(program);
registerStudioCommand(program);

registerProvidersCheckCommand(program);

program.parseAsync().catch((error: unknown) => {
  console.error(`\nGAGAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
