import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  DEFAULT_ORCHESTRATOR_MODEL,
  DEFAULT_VOLUME_MODEL,
  loadModelRegistry,
  type ResolvedModel,
  resolveModel,
} from "@dalang/agent";
import { buildStockChain, buildTtsChain } from "@dalang/providers";
import { renderPlanToVideo } from "@dalang/renderer";
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
        const orchestratorKey =
          options.model ?? process.env.DALANG_MODEL ?? DEFAULT_ORCHESTRATOR_MODEL;
        const volumeKey =
          options.modelVolume ?? process.env.DALANG_MODEL_VOLUME ?? DEFAULT_VOLUME_MODEL;
        // Chat butuh model; panel manual tidak. Tanpa API key, studio tetap
        // hidup dengan chat nonaktif + alasan yang tampil di UI.
        let orchestrator: ResolvedModel | undefined;
        let chatDisabledReason: string | undefined;
        try {
          orchestrator = resolveModel(orchestratorKey, { registry });
        } catch (error) {
          chatDisabledReason = error instanceof Error ? error.message : String(error);
        }
        let volumeModel: ResolvedModel | undefined;
        try {
          volumeModel = resolveModel(volumeKey, { registry });
        } catch {
          // tier-volume opsional — researchTopic/analyzeImage akan menolak rapi
        }

        const studio = await startStudioServer({
          planPath,
          port: options.port,
          deps: {
            ttsChainFor: (provider) => buildTtsChain({ provider }),
            stockChain: () => buildStockChain(),
            renderVideo: (renderOptions) => renderPlanToVideo(renderOptions),
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
