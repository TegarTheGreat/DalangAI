import { mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { Command } from "commander";
import {
  computeTimeline,
  resolveSceneDurationSec,
  countWords,
  type ScenePlan,
} from "@dalang/core";
import {
  computeFrameLayout,
  FPS,
  TRANSITION_FRAMES,
} from "@dalang/templates/layout";
import {
  loadPlan,
  renderPlanStills,
  renderPlanToVideo,
  type ProgressEvent,
  type RenderProfile,
} from "@dalang/renderer";

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
  .option("-t, --time <detik...>", "waktu (detik) yang di-render", ["1"])
  .option("-o, --out-dir <dir>", "folder output", "out")
  .option("-s, --scale <scale>", "skala render (1 = 1080p)", "1")
  .option("--profile <profile>", "draft | final", "final")
  .option("--format <format>", "png | jpeg", "png")
  .description("Render satu atau beberapa frame (PNG/JPEG) untuk cek visual")
  .action(
    async (
      planPath: string,
      options: {
        time: string[];
        outDir: string;
        scale: string;
        profile: RenderProfile;
        format: "png" | "jpeg";
      },
    ) => {
      const absPlan = resolve(planPath);
      const name = basename(dirname(absPlan));
      mkdirSync(resolve(options.outDir), { recursive: true });
      const frames = options.time.map((t) => Math.round(Number(t) * FPS));
      const extension = options.format === "jpeg" ? "jpg" : "png";
      const { outputs } = await renderPlanStills({
        planPath: absPlan,
        frames,
        scale: Number(options.scale),
        profile: options.profile,
        imageFormat: options.format,
        outputLocationFor: (frame) =>
          join(resolve(options.outDir), `${name}-f${frame}.${extension}`),
        onProgress: progressPrinter(),
      });
      process.stdout.write("\n");
      for (const output of outputs) {
        console.log(`✓ frame ${output.frame} → ${output.outputLocation}`);
      }
    },
  );

program
  .command("render")
  .argument("<plan>", "path ke scene-plan JSON")
  .option("-o, --out <file>", "file output .mp4")
  .option("--profile <profile>", "draft | final", "draft")
  .description("Render scene-plan menjadi MP4 (H.264) secara lokal")
  .action(
    async (
      planPath: string,
      options: { out?: string; profile: RenderProfile },
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
        onProgress: progressPrinter(),
      });
      process.stdout.write("\n");

      const elapsed = (Date.now() - startedAt) / 1000;
      console.log(
        `✓ ${result.outputLocation}\n` +
          `  ${result.width}×${result.height} · ${formatSec(result.durationSec)} · ` +
          `${(result.sizeBytes / 1024 / 1024).toFixed(1)} MB · render ${formatSec(elapsed)}`,
      );
    },
  );

program.parseAsync().catch((error: unknown) => {
  console.error(
    `\n✗ ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
