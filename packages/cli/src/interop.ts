import { mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseScenePlan } from "@dalang/core";
import {
  buildEditTimeline,
  formatInteropNotes,
  fromOtio,
  otioToJson,
  toFcpxml,
} from "@dalang/interop";
import { atomicWriteFile, readPlanFile } from "@dalang/pipeline";
import { templatesPublicDir } from "@dalang/templates/paths";
import { type Command, InvalidArgumentError } from "commander";
import { planPathOf } from "./project-path";

/**
 * `dalang export` dan `dalang import` — jalan keluar dan masuk (ADR-0023).
 *
 * Keduanya SELALU mencetak apa yang tidak ikut menyeberang. Itu bukan basa-basi
 * kehati-hatian: orang yang membuka hasil ekspor di Resolve dan melihat klip
 * polos tanpa caption, tanpa teks, tanpa Ken Burns akan mengira Dalang yang
 * rusak. Menyebutkannya di depan mengubah kejutan jadi keputusan.
 */

const FORMATS = ["otio", "fcpxml"] as const;
type InteropFormat = (typeof FORMATS)[number];

const parseFormat = (value: string): InteropFormat => {
  if ((FORMATS as readonly string[]).includes(value)) return value as InteropFormat;
  throw new InvalidArgumentError(`format harus salah satu: ${FORMATS.join(", ")}`);
};

const EXTENSION: Record<InteropFormat, string> = { otio: ".otio", fcpxml: ".fcpxml" };

export const registerInteropCommands = (program: Command): void => {
  program
    .command("export")
    .argument("<proyek>", "folder proyek atau path plan.json")
    .option(
      "--format <nama>",
      `format tujuan (${FORMATS.join(" | ")})`,
      parseFormat,
      "otio",
    )
    .option("-o, --out <berkas>", "tulis ke berkas ini (bawaan: di samping plan.json)")
    .description(
      "Ekspor garis waktu ke OpenTimelineIO atau FCPXML untuk difinishing di Resolve/Premiere/Final Cut (ADR-0023)",
    )
    .action((proyek: string, options: { format: InteropFormat; out?: string }) => {
      const absPlan = planPathOf(proyek);
      const plan = readPlanFile(absPlan);
      const timeline = buildEditTimeline(plan, {
        planPath: absPlan,
        // Musik pustaka hidup di public/ paket templates, bukan di folder
        // proyek — tanpa ini ia dilaporkan hilang padahal berkasnya ada.
        siteAssetDir: templatesPublicDir,
      });

      const target =
        options.out ??
        join(
          dirname(absPlan),
          `${basename(absPlan, extname(absPlan))}${EXTENSION[options.format]}`,
        );
      const body = options.format === "otio" ? otioToJson(timeline) : toFcpxml(timeline);
      mkdirSync(dirname(resolve(target)), { recursive: true });
      atomicWriteFile(resolve(target), body);

      const clips = timeline.tracks.reduce(
        (sum, track) => sum + track.items.filter((item) => item.kind === "clip").length,
        0,
      );
      console.log(`${options.format.toUpperCase()} ditulis ke ${resolve(target)}`);
      console.log(
        `  ${timeline.tracks.length} trek · ${clips} klip · ${(timeline.totalFrames / timeline.fps).toFixed(1)} detik @ ${timeline.fps}fps`,
      );
      console.log("\nYang TIDAK ikut menyeberang:");
      for (const line of formatInteropNotes(timeline.notes)) console.log(line);
      console.log(
        "\n  Aset dirujuk lewat path absolut. Kalau proyeknya dipindah, tautannya perlu disambungkan ulang di editor tujuan.",
      );
    });

  program
    .command("import")
    .argument("<berkas>", "berkas .otio yang mau dijadikan scene-plan")
    .requiredOption(
      "-o, --out <folder>",
      "folder proyek tujuan (plan.json ditulis di sini)",
    )
    .option("--judul <teks>", "judul proyek (bawaan: nama timeline di berkasnya)")
    .description(
      "Impor garis waktu OpenTimelineIO jadi KERANGKA scene-plan — urutan dan durasi, tanpa naskah (ADR-0023)",
    )
    .action((berkas: string, options: { out: string; judul?: string }) => {
      const source = resolve(berkas);
      const projectDir = resolve(options.out);
      let document: unknown;
      try {
        document = JSON.parse(readFileSync(source, "utf8"));
      } catch (error) {
        process.exitCode = 1;
        console.error(
          `Tidak bisa membaca ${source} sebagai JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
        console.error(
          "  Perintah ini hanya membaca .otio (JSON). FCPXML belum didukung.",
        );
        return;
      }

      const result = fromOtio(document, {
        projectDir,
        ...(options.judul ? { title: options.judul } : {}),
      });
      // Divalidasi ulang lewat skema sebelum ditulis: hasil impor berasal dari
      // berkas asing, dan plan.json yang tidak sah lebih buruk daripada impor
      // yang gagal dengan jelas.
      const plan = parseScenePlan(result.plan);
      mkdirSync(projectDir, { recursive: true });
      const planPath = join(projectDir, "plan.json");
      atomicWriteFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);

      console.log(`Scene-plan ditulis ke ${planPath}`);
      console.log(`  ${plan.scenes.length} scene · ${plan.meta.title}`);
      console.log("\nCatatan impor:");
      for (const line of formatInteropNotes(result.notes)) console.log(line);
      console.log(
        `\n  Langkah berikutnya: isi naskahnya — dalang studio ${projectDir}, atau dalang chat ${projectDir}`,
      );
    });
};
