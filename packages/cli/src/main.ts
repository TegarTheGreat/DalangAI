import { mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  computeTimeline,
  countWords,
  resolveSceneDurationSec,
  type ScenePlan,
} from "@dalang/core";
import {
  loadPlan,
  type ProgressEvent,
  type RenderProfile,
  renderPlanStills,
  renderPlanToVideo,
} from "@dalang/renderer";
import { computeFrameLayout, FPS, TRANSITION_FRAMES } from "@dalang/templates/layout";
import { Command, InvalidArgumentError, Option } from "commander";

/**
 * `dalang` — Fase 0 CLI: validate a scene-plan and render it locally.
 * (Fase 1 adds `dalang generate` on top of the deterministic pipeline.)
 */

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
  const rows = plan.scenes.map((scene, index) => ({
    "#": index + 1,
    id: scene.id,
    tipe: scene.visual.type,
    kata: countWords(scene.narration),
    durasi: formatSec(resolveSceneDurationSec(scene, plan)),
    aset:
      plan.renderState.resolvedAssets[scene.id]?.file ??
      (scene.visual.type === "template-anim" || scene.visual.type === "solid"
        ? "(template)"
        : "(belum di-resolve)"),
    lock: scene.locked ? "🔒" : "",
  }));
  console.table(rows);
  console.log(
    `  Total: ${timings.length} scene · ${formatSec(totalSec)} materi · ` +
      `${formatSec(layout.totalFrames / FPS)} durasi video ` +
      `(${layout.totalFrames} frame @ ${FPS}fps, crossfade ${TRANSITION_FRAMES} frame)\n`,
  );
};

const progressPrinter = () => {
  let lastLine = "";
  return (event: ProgressEvent) => {
    const line = `  ${event.stage} ${(event.progress * 100).toFixed(0)}%`;
    if (line !== lastLine) {
      process.stdout.write(`\r${line.padEnd(40)}`);
      lastLine = line;
    }
  };
};

program
  .command("validate")
  .argument("<plan>", "path ke scene-plan JSON")
  .description("Validasi scene-plan terhadap skema v0 dan tampilkan ringkasan")
  .action((planPath: string) => {
    const plan = loadPlan(resolve(planPath));
    console.log("✓ Scene-plan valid (skema v0).");
    printPlanSummary(plan);
  });

program
  .command("still")
  .argument("<plan>", "path ke scene-plan JSON")
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
      const absPlan = resolve(planPath);
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
        console.log(`✓ frame ${output.frame} → ${output.outputLocation}`);
      }
    },
  );

program
  .command("render")
  .argument("<plan>", "path ke scene-plan JSON")
  .option("-o, --out <file>", "file output .mp4")
  .addOption(profileOption().default("draft"))
  .option(
    "--concurrency <n>",
    "jumlah tab render paralel (default: otomatis)",
    parsePositiveInt,
  )
  .option("--no-cache", "jangan pakai bundle cache (selalu bundling ulang)")
  .description("Render scene-plan menjadi MP4 (H.264) secara lokal")
  .action(
    async (
      planPath: string,
      options: {
        out?: string;
        profile: RenderProfile;
        concurrency?: number;
        cache: boolean;
      },
    ) => {
      const absPlan = resolve(planPath);
      const plan = loadPlan(absPlan);
      printPlanSummary(plan);

      const name = basename(dirname(absPlan));
      const outPath = resolve(
        options.out ?? join("out", `${name}-${options.profile}.mp4`),
      );
      mkdirSync(dirname(outPath), { recursive: true });

      const startedAt = Date.now();
      const result = await renderPlanToVideo({
        planPath: absPlan,
        outputLocation: outPath,
        profile: options.profile,
        concurrency: options.concurrency ?? null,
        disableBundleCache: !options.cache,
        onProgress: progressPrinter(),
      });
      process.stdout.write("\n");

      const elapsed = (Date.now() - startedAt) / 1000;
      console.log(
        `✓ ${result.outputLocation}\n` +
          `  ${result.width}×${result.height} · ${formatSec(result.durationSec)} · ` +
          `${(result.sizeBytes / 1024 / 1024).toFixed(1)} MB · render ${formatSec(elapsed)}` +
          `${result.bundleFromCache ? " · bundle cache: hit" : ""}`,
      );
    },
  );

program.parseAsync().catch((error: unknown) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
