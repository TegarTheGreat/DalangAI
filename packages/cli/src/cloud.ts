import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseScenePlan } from "@dalang/core";
import {
  type CloudConfig,
  createLambdaRenderClient,
  createLambdaRenderTarget,
  createS3AssetStore,
  estimateLambdaCost,
  readCloudConfig,
} from "@dalang/render-lambda";
import type { RenderTarget } from "@dalang/renderer";
import type { Command } from "commander";
import { planPathOf } from "./project-path";

/** Perintah CLI untuk render cloud (ADR-0019). */

export const buildLambdaTarget = (config: CloudConfig): RenderTarget => {
  const aws = {
    region: config.region as Parameters<typeof createS3AssetStore>[0]["region"],
    functionName: config.functionName,
    bucketName: config.bucketName,
  };
  return createLambdaRenderTarget(
    {
      serveUrl: config.serveUrl,
      compositionId: "Dalang",
      memorySizeInMb: config.memorySizeInMb,
      framesPerLambda: config.framesPerLambda,
    },
    { client: createLambdaRenderClient(aws), assets: createS3AssetStore(aws) },
  );
};

export const registerCloudCommands = (program: Command): void => {
  program
    .command("cloud:check")
    .argument("[proyek]", "folder proyek atau plan.json untuk contoh estimasi biaya")
    .description(
      "Periksa konfigurasi render cloud (Remotion Lambda) dan estimasi biayanya",
    )
    .action(async (planPath?: string) => {
      const read = readCloudConfig();
      if (!read.ok) {
        console.log("Render cloud BELUM diatur. Yang kurang:\n");
        for (const line of read.missing) console.log(`  - ${line}`);
        console.log(
          "\nLangkah penyiapan (dijalankan sekali, di akun AWS-mu):\n" +
            "  npx remotion lambda functions deploy\n" +
            "  npx remotion lambda sites create packages/templates/src/index.ts --site-name=dalang\n" +
            "lalu salin nama fungsi, bucket, dan serve URL ke .env.\n" +
            "\nTanpa ini, `dalang render` tetap berjalan penuh di mesin ini.",
        );
        process.exitCode = 1;
        return;
      }

      const { config } = read;
      console.log("Konfigurasi render cloud:");
      console.log(`  region     : ${config.region}`);
      console.log(`  fungsi     : ${config.functionName}`);
      console.log(`  bucket     : ${config.bucketName}`);
      console.log(`  situs      : ${config.serveUrl}`);
      console.log(`  memori     : ${config.memorySizeInMb} MB`);
      console.log(`  frame/lambda: ${config.framesPerLambda}`);

      if (!planPath) {
        console.log(
          "\nBeri path scene-plan untuk melihat estimasi biaya render proyek itu.",
        );
        return;
      }

      const abs = planPathOf(planPath);
      const plan = parseScenePlan(JSON.parse(readFileSync(abs, "utf8")));
      const target = buildLambdaTarget(config);
      const estimate = await target.estimateCost({
        planPath: abs,
        // Estimasi dihitung dari durasi plan saja; tidak ada berkas yang
        // ditulis ke sini. Medannya wajib ada di RenderRequest, jadi diisi
        // path sementara milik sistem — "/tmp" yang ditulis tangan membuat
        // perintah ini gagal di Windows tanpa alasan yang bisa dilihat.
        outputLocation: join(tmpdir(), "dalang-estimasi.mp4"),
        profile: "final",
      });
      console.log(`\nEstimasi untuk "${plan.meta.title}":`);
      console.log(`  ~$${estimate.usd.toFixed(4)} — ${estimate.detail}`);
      console.log(
        "\nCatatan: angka ini dihitung dari durasi plan, tanpa memanggil AWS. " +
          "Biaya sesungguhnya dilaporkan Remotion setelah render selesai.",
      );
    });
};

export { estimateLambdaCost, readCloudConfig };
