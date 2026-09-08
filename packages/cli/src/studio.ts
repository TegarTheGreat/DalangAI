import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import {
  defaultMemoryPath,
  loadModelRegistry,
  pickDefaultModels,
  type ResolvedModel,
  resolveModel,
} from "@dalang/agent";
import {
  buildAsrChain,
  buildGifChain,
  buildIconProvider,
  buildPublishTargets,
  buildSfxChain,
  buildStockChain,
  buildTtsChain,
} from "@dalang/providers";
import {
  detectSilence,
  probeLocalVideo,
  remotionAudioProbe,
  remotionTranscoder,
  renderPlanStills,
  renderPlanToVideo,
  saveMediaToProject,
} from "@dalang/renderer";
import { resolveEntry, startStudioServer, studioAppDistDir } from "@dalang/studio/server";
import { type Command, InvalidArgumentError } from "commander";

/**
 * `dalang studio` — UI hybrid 3 panel (Fase 3, PRD §8): server API + SSE +
 * app web di satu port. Composition root yang sama dengan `dalang chat`;
 * proyek kosong pun bisa dibuka (mulai dari brief di panel chat).
 *
 * Argumennya menentukan sendiri apa yang dibuka: folder berisi plan.json =
 * proyek itu (lobinya folder induk), folder lain = lobi berisi proyek-proyek
 * di dalamnya. Tidak ada flag yang harus diingat pengguna.
 */

const parsePort = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new InvalidArgumentError(`"${value}" bukan port yang valid`);
  }
  return parsed;
};

export const registerStudioCommand = (program: Command): void => {
  program
    .command("studio")
    .argument("[proyek]", "folder proyek atau path plan.json", ".")
    .option("-p, --port <n>", "port server", parsePort, 4646)
    .option("--model <key>", "model orkestrator (provider/model-id)")
    .option("--model-volume <key>", "model tier-volume (riset/vision)")
    .option(
      "--lan",
      "buka ke jaringan lokal supaya orang lain bisa ikut menyunting (ADR-0038) — URL-nya memuat kunci acak",
    )
    .description("Buka UI hybrid 3 panel: chat agent · preview · timeline (Fase 3)")
    .action(
      async (
        proyek: string,
        options: { port: number; model?: string; modelVolume?: string; lan?: boolean },
      ) => {
        const entry = resolveEntry(proyek);
        const workspaceRoot =
          entry.mode === "workspace" ? entry.root : dirname(dirname(entry.planPath));
        const planPath = entry.mode === "project" ? entry.planPath : undefined;

        const registry = await loadModelRegistry();
        // Netral vendor: environment user yang menentukan (API key terpasang /
        // DALANG_MODEL). Chat butuh model; panel manual tidak — tanpa pilihan
        // yang sah, studio tetap hidup dengan chat nonaktif + alasannya.
        const defaults = pickDefaultModels(process.env, registry);
        const orchestratorKey = options.model ?? defaults.orchestrator;
        const volumeKey = options.modelVolume ?? defaults.volume;
        let orchestrator: ResolvedModel | undefined;
        let chatDisabledReason: string | undefined;
        if (!orchestratorKey) {
          chatDisabledReason = defaults.reason;
        } else {
          try {
            orchestrator = resolveModel(orchestratorKey, { registry });
          } catch (error) {
            chatDisabledReason = error instanceof Error ? error.message : String(error);
          }
        }
        let volumeModel: ResolvedModel | undefined;
        if (volumeKey) {
          try {
            volumeModel = resolveModel(volumeKey, { registry });
          } catch {
            // tier-volume opsional — researchTopic/analyzeImage akan menolak rapi
          }
        }

        // Kunci tautan (ADR-0038): dibuat sekali per proses, dan HANYA saat
        // dibuka ke jaringan. Tanpa --lan tidak ada kunci sama sekali, jadi
        // pemakaian lokal tidak berubah satu langkah pun.
        const linkKey = options.lan ? randomBytes(16).toString("base64url") : undefined;
        const studio = await startStudioServer({
          workspaceRoot,
          ...(options.lan ? { hostname: "0.0.0.0" } : {}),
          ...(linkKey ? { linkKey } : {}),
          // ADR-0029: memori preferensi milik orangnya — satu berkas di rumah Dalang.
          memoryPath: defaultMemoryPath(),
          ...(planPath ? { planPath } : {}),
          port: options.port,
          deps: {
            ttsChainFor: (provider) => buildTtsChain({ provider }),
            stockChain: () => buildStockChain(),
            stickerChain: () => buildGifChain({ stickers: true }),
            asrChain: () => buildAsrChain(),
            renderStills: async ({ planPath, frames, outDir, scale }) => {
              mkdirSync(outDir, { recursive: true });
              await renderPlanStills({
                planPath,
                frames,
                outputLocationFor: (frame) => join(outDir, `review-${frame}.png`),
                scale,
              });
              return frames.map((frame) => join(outDir, `review-${frame}.png`));
            },
            renderVideo: (renderOptions) => renderPlanToVideo(renderOptions),
            probeVideo: probeLocalVideo,
            // ADR-0026: tanpa ini hanya berkas WAV yang bisa diukur.
            audioProbe: remotionAudioProbe,
            // ADR-0028: proxy pratinjau, bingkai rekaman, bentuk gelombang.
            transcoder: remotionTranscoder,
            // ADR-0030: tujuan publikasi; kosong tanpa token.
            publishTargets: () => buildPublishTargets(),
            detectSilence,
            iconProvider: () => buildIconProvider(),
            sfxChain: () => buildSfxChain(),
            saveMedia: (planPath, media) => saveMediaToProject({ planPath, ...media }),
            ...(orchestrator ? { orchestrator } : {}),
            ...(chatDisabledReason ? { chatDisabledReason } : {}),
            ...(volumeModel ? { volumeModel } : {}),
            registrySource: registry.source,
          },
          appDistDir: studioAppDistDir,
        });

        const hasApp = existsSync(join(studioAppDistDir, "index.html"));
        // URL yang bisa DIBAGIKAN, bukan 0.0.0.0 yang tidak menunjuk apa pun
        // dari komputer orang lain. Semua alamat IPv4 non-internal dicetak
        // karena mesin dengan Wi-Fi plus Ethernet punya lebih dari satu, dan
        // menebak satu yang benar bukan urusan kami.
        const lanUrls = options.lan
          ? Object.values(networkInterfaces())
              .flat()
              .filter((item) => item && item.family === "IPv4" && !item.internal)
              .map(
                (item) =>
                  `http://${item?.address}:${studio.port}/?kunci=${linkKey ?? ""}`,
              )
          : [];
        console.log(
          `Dalang Studio · ${studio.url}\n` +
            (planPath ? `  proyek  : ${planPath}\n` : "") +
            `  lobi    : ${workspaceRoot}\n` +
            (orchestrator
              ? `  model   : ${orchestrator.key}${volumeModel ? ` · volume: ${volumeModel.key}` : ""} (registry: ${registry.source})\n`
              : `  PERHATIAN: chat nonaktif — ${chatDisabledReason}; panel manual tetap berfungsi\n`) +
            (options.lan
              ? "\n  TERBUKA KE JARINGAN LOKAL (ADR-0038)\n" +
                "  Siapa pun yang punya tautan di bawah bisa menyunting proyek, memicu render\n" +
                "  berbayar, dan mengunggah. Tidak ada akun dan tidak ada izin per-orang —\n" +
                "  yang punya tautan punya semuanya. Bagikan hanya ke orang yang kamu percaya,\n" +
                "  dan hentikan Studio untuk mencabutnya (jalan lagi = kunci baru).\n" +
                lanUrls.map((url) => `  bagikan : ${url}\n`).join("") +
                (lanUrls.length === 0
                  ? "  (tidak ada alamat IPv4 non-internal — mesin ini tidak terlihat di jaringan)\n"
                  : "") +
                "\n"
              : "") +
            (hasApp
              ? "  Buka URL di browser. Ctrl+C untuk berhenti.\n"
              : "  PERHATIAN: app UI belum ter-build — jalankan: pnpm --filter @dalang/studio build\n"),
        );

        const shutdown = () => {
          studio.close();
          process.exit(0);
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
      },
    );
};
