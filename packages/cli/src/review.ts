import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  estimateLlmCostUsd,
  estimateReviewUsd,
  loadModelRegistry,
  NO_VISION_MODEL,
  pickDefaultModels,
  type ResolvedModel,
  resolveModel,
  runRenderReview,
  UNPARSED_WARNING,
} from "@dalang/agent";
import { projectPaths, readPlanFile } from "@dalang/pipeline";
import { renderPlanStills } from "@dalang/renderer";
import { type Command, InvalidArgumentError } from "commander";
import { planPathOf } from "./project-path";

/**
 * `dalang review` — tinjauan render (ADR-0022): agent MELIHAT hasil kerjanya.
 *
 * Permukaan ketiga di atas `runRenderReview`, setelah tool agent dan rute
 * Studio. Ada alasan kenapa perintahnya berdiri sendiri dan bukan cuma tool:
 * tinjauan berguna justru pada plan yang TIDAK sedang dikerjakan agent —
 * setelah editan manual, di mesin lain, atau sebagai pemeriksaan terakhir
 * sebelum ekspor. Semuanya tanpa harus membuka sesi chat.
 *
 * Yang sengaja TIDAK dilakukan: perintah ini tidak mengubah plan sama sekali.
 * Temuan model adalah pendapat, dan pendapat tidak boleh menulis ke sumber
 * kebenaran tanpa seseorang memutuskannya (PRD §5.1).
 */

const parseFrames = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) {
    throw new InvalidArgumentError(`"${value}" bukan jumlah frame yang wajar (1-8)`);
  }
  return parsed;
};

export const registerReviewCommand = (program: Command): void => {
  program
    .command("review")
    .argument("<proyek>", "folder proyek atau path plan.json")
    .option("--frame <n>", "jumlah frame yang dilihat (1-8)", parseFrames, 4)
    .option("--perhatian <teks>", "hal khusus yang ingin diperiksa")
    .option("--model-volume <key>", "model vision yang dipakai (mis. provider/model)")
    .description(
      "Render beberapa frame lalu minta model vision menilainya (ADR-0022) — tidak mengubah plan",
    )
    .action(
      async (
        proyek: string,
        options: { frame: number; perhatian?: string; modelVolume?: string },
      ) => {
        const absPlan = planPathOf(proyek);
        const paths = projectPaths(absPlan);
        const plan = readPlanFile(absPlan);

        const registry = await loadModelRegistry();
        const defaults = pickDefaultModels(process.env, registry);
        const volumeKey = options.modelVolume ?? defaults.volume;
        let volume: ResolvedModel | undefined;
        if (volumeKey) {
          try {
            volume = resolveModel(volumeKey, { registry });
          } catch (error) {
            process.exitCode = 1;
            console.error(
              `Model "${volumeKey}" tidak bisa dipakai: ${error instanceof Error ? error.message : String(error)}`,
            );
            return;
          }
        }
        // Dua kegagalan yang berbeda, dan keduanya disebut apa adanya: tidak
        // ada model sama sekali, atau ada tapi tidak menerima gambar. Yang
        // kedua paling sering terjadi (model teks murah dipasang untuk tier
        // volume) dan paling membingungkan kalau cuma ditulis "gagal".
        if (!volume) {
          process.exitCode = 1;
          console.error(NO_VISION_MODEL);
          console.error(
            `  ${defaults.reason ?? "Set DALANG_MODEL_VOLUME atau API key."}`,
          );
          console.error(
            "  Atau sebutkan langsung: dalang review <proyek> --model-volume <key>",
          );
          return;
        }
        if (volume.info && !volume.info.imageInput) {
          process.exitCode = 1;
          console.error(
            `Model ${volume.key} tidak menerima input gambar — tinjauan render butuh model vision.`,
          );
          console.error("  Sebutkan model lain: --model-volume <key>");
          return;
        }

        const estimate = estimateReviewUsd(volume, options.frame);
        console.log(
          `Tinjauan ${options.frame} frame lewat ${volume.key}` +
            (estimate !== null ? ` — perkiraan ~$${estimate.toFixed(4)}` : ""),
        );
        console.log(`  ${absPlan}`);

        const outDir = join(paths.dalangDir, "review");
        const review = await runRenderReview({
          plan,
          planPath: absPlan,
          outDir,
          model: volume,
          maxFrames: options.frame,
          ...(options.perhatian ? { extra: options.perhatian } : {}),
          renderStills: async ({ planPath, frames, outDir: dir, scale }) => {
            mkdirSync(dir, { recursive: true });
            await renderPlanStills({
              planPath,
              frames,
              outputLocationFor: (frame) => join(dir, `review-${frame}.png`),
              scale,
            });
            return frames.map((frame) => join(dir, `review-${frame}.png`));
          },
        });

        console.log("\nFrame yang dilihat:");
        for (const frame of review.frames) {
          console.log(
            `  #${frame.frame} · scene ${frame.sceneNumber} (${frame.sceneId}) — ${frame.reason}`,
          );
        }
        console.log(`  still tersimpan di ${outDir}`);

        console.log("\nTemuan gambar:");
        if (review.unparsed) {
          // Dipisah tegas dari "bersih": jawaban tak terurai berarti tinjauan
          // TIDAK terjadi, dan exit code harus mengatakannya.
          process.exitCode = 1;
          console.error(`  ${UNPARSED_WARNING}`);
        } else if (review.findings.length === 0) {
          console.log("  Tidak ada. Frame lain belum tentu bersih.");
        } else {
          for (const finding of review.findings) {
            const where = finding.sceneId ? ` [${finding.sceneId}]` : "";
            console.log(
              `  ${finding.level === "perhatian" ? "PERHATIAN" : "saran"}${where} ${finding.masalah}`,
            );
            console.log(`      -> ${finding.saran}`);
          }
        }
        if (review.dropped > 0) {
          console.log(
            `  (${review.dropped} entri dibuang karena bentuknya tidak sah atau scene-nya tidak ada)`,
          );
        }

        // Kritik struktur ikut dicetak walau tidak butuh model: sudut yang
        // TIDAK bisa dilihat dari gambar (ritme, panjang narasi) sama
        // pentingnya, dan orang yang menjalankan review jelas sedang menilai
        // draftnya secara keseluruhan.
        if (review.structural.length > 0) {
          console.log("\nCatatan struktur (dari plan, tanpa model):");
          for (const note of review.structural) {
            const where = note.sceneId ? ` [${note.sceneId}]` : "";
            console.log(
              `  ${note.level === "perhatian" ? "PERHATIAN" : "saran"}${where} ${note.message}`,
            );
          }
        }

        // Biaya NYATA dari usage, bukan perkiraan di awal: dua angka itu bisa
        // berbeda jauh, dan yang dilaporkan di akhir harus yang benar-benar
        // terjadi.
        const spent = estimateLabel(review.usage);
        const actual = estimateLlmCostUsd(volume.info, review.usage);
        if (spent) {
          console.log(
            `\n  token: ${spent}` +
              (actual !== null ? ` — biaya ~$${actual.toFixed(4)}` : ""),
          );
        }
        console.log("  Plan TIDAK diubah — semua temuan di atas bersifat saran.");
      },
    );
};

const estimateLabel = (usage: {
  inputTokens?: number;
  outputTokens?: number;
}): string | null => {
  if (usage.inputTokens === undefined && usage.outputTokens === undefined) return null;
  return `${usage.inputTokens ?? 0} masuk / ${usage.outputTokens ?? 0} keluar`;
};
