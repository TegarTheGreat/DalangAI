import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  loadModelRegistry,
  pickDefaultModels,
  type ResolvedModel,
  resolveModel,
} from "@dalang/agent";
import {
  buildGifChain,
  buildIconProvider,
  buildSfxChain,
  buildStockChain,
  buildTtsChain,
} from "@dalang/providers";
import {
  detectSilence,
  probeLocalVideo,
  renderPlanToVideo,
  saveMediaToProject,
} from "@dalang/renderer";
import { startStudioServer, studioAppDistDir } from "@dalang/studio/server";
import { type Command, InvalidArgumentError } from "commander";

/**
 * `dalang studio` — UI hybrid 3 panel (Fase 3, PRD §8): server API + SSE +
 * app web di satu port. Composition root yang sama dengan `dalang chat`;
 * proyek kosong pun bisa dibuka (mulai dari brief di panel chat).
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
    .description("Buka UI hybrid 3 panel: chat agent · preview · timeline (Fase 3)")
    .action(
      async (
        proyek: string,
        options: { port: number; model?: string; modelVolume?: string },
      ) => {
        const abs = resolve(proyek);
        const planPath =
          existsSync(abs) && statSync(abs).isDirectory() ? join(abs, "plan.json") : abs;

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

        const studio = await startStudioServer({
          planPath,
          port: options.port,
          deps: {
            ttsChainFor: (provider) => buildTtsChain({ provider }),
            stockChain: () => buildStockChain(),
            stickerChain: () => buildGifChain({ stickers: true }),
            renderVideo: (renderOptions) => renderPlanToVideo(renderOptions),
            probeVideo: probeLocalVideo,
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
        console.log(
          `Dalang Studio · ${studio.url}\n` +
            `  proyek  : ${planPath}\n` +
            (orchestrator
              ? `  model   : ${orchestrator.key}${volumeModel ? ` · volume: ${volumeModel.key}` : ""} (registry: ${registry.source})\n`
              : `  PERHATIAN: chat nonaktif — ${chatDisabledReason}; panel manual tetap berfungsi\n`) +
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
