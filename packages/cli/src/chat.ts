import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  type AgentDeps,
  AgentEventLog,
  type ApprovalFn,
  DEFAULT_ORCHESTRATOR_MODEL,
  DEFAULT_VOLUME_MODEL,
  Guardrails,
  loadModelRegistry,
  ProjectSession,
  type ResolvedModel,
  resolveModel,
  runAgentTurn,
} from "@dalang/agent";
import { PipelineDb, projectPaths, readPlanFile } from "@dalang/pipeline";
import { buildStockChain, buildTtsChain } from "@dalang/providers";
import { renderPlanToVideo } from "@dalang/renderer";
import { type Command, InvalidArgumentError } from "commander";

/**
 * `dalang chat` — loop chat agent di CLI (Fase 2, PRD §11) dan
 * `dalang log` — garis waktu observability (stage runs + agent events).
 */

const resolvePlanPath = (input: string): string => {
  const abs = resolve(input);
  if (existsSync(abs) && statSync(abs).isDirectory()) {
    return join(abs, "plan.json");
  }
  return abs;
};

const parseUsd = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvalidArgumentError(`"${value}" bukan nominal USD yang valid`);
  }
  return parsed;
};

const parsePositiveInt = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError(`"${value}" bukan bilangan bulat ≥ 1`);
  }
  return parsed;
};

const formatCost = (result: {
  llmCostUsd: number | null;
  toolCostUsd: number;
  costIsPartial: boolean;
  steps: number;
  stop: string;
}): string => {
  const llm =
    result.llmCostUsd === null
      ? "LLM: harga model tak diketahui"
      : `LLM ~$${result.llmCostUsd.toFixed(4)}`;
  const tool = result.toolCostUsd > 0 ? ` · tool ~$${result.toolCostUsd.toFixed(4)}` : "";
  const stop = result.stop !== "selesai" ? ` · berhenti: ${result.stop}` : "";
  return `  [${result.steps} langkah · ${llm}${tool}${result.costIsPartial ? " (parsial)" : ""}${stop}]`;
};

export const registerChatCommand = (program: Command): void => {
  program
    .command("chat")
    .argument("[proyek]", "folder proyek atau path plan.json", ".")
    .option("--model <key>", "model orkestrator (provider/model-id)")
    .option("--model-volume <key>", "model tier-volume (riset/vision)")
    .option("--once <pesan>", "satu giliran non-interaktif lalu keluar")
    .option("--yes", "setujui otomatis approval gate (hanya bersama --once)")
    .option("--step-cap <n>", "maksimum tool call per giliran", parsePositiveInt)
    .option("--budget <usd>", "budget biaya per giliran (USD)", parseUsd)
    .description("Chat dengan agent Dalang di atas sebuah proyek (Fase 2)")
    .action(
      async (
        proyek: string,
        options: {
          model?: string;
          modelVolume?: string;
          once?: string;
          yes?: boolean;
          stepCap?: number;
          budget?: number;
        },
      ) => {
        const planPath = resolvePlanPath(proyek);
        const registry = await loadModelRegistry();
        const orchestratorKey =
          options.model ?? process.env.DALANG_MODEL ?? DEFAULT_ORCHESTRATOR_MODEL;
        const volumeKey =
          options.modelVolume ?? process.env.DALANG_MODEL_VOLUME ?? DEFAULT_VOLUME_MODEL;

        const orchestrator = resolveModel(orchestratorKey, { registry });
        let volumeModel: ResolvedModel | undefined;
        try {
          volumeModel = resolveModel(volumeKey, { registry });
        } catch (error) {
          console.warn(
            `  (model volume tidak tersedia: ${error instanceof Error ? error.message : error})`,
          );
        }
        if (orchestrator.info && !orchestrator.info.toolCall) {
          throw new Error(
            `Model ${orchestratorKey} tidak mendukung tool-calling — pilih model lain (registry: ${registry.source})`,
          );
        }

        const session = ProjectSession.open(planPath);
        const rl = options.once
          ? null
          : createInterface({ input: process.stdin, output: process.stdout });

        const approve: ApprovalFn = async (request) => {
          const detail = `${request.detail}${
            request.estimatedUsd !== undefined
              ? ` (~$${request.estimatedUsd.toFixed(4)})`
              : ""
          }`;
          if (!rl) {
            if (options.yes) {
              console.log(`  [izin] ${detail} — disetujui otomatis (--yes)`);
              return true;
            }
            console.log(`  [izin] ${detail} — DITOLAK (mode --once tanpa --yes)`);
            return false;
          }
          const answer = await rl.question(`  [izin] ${detail}. Lanjutkan? (y/T) `);
          return answer.trim().toLowerCase().startsWith("y");
        };

        const guards = new Guardrails(
          {
            ...(options.stepCap !== undefined ? { stepCap: options.stepCap } : {}),
            ...(options.budget !== undefined ? { turnBudgetUsd: options.budget } : {}),
          },
          approve,
        );

        const deps: AgentDeps = {
          guards,
          ttsChainFor: (provider) => buildTtsChain({ provider }),
          stockChain: () => buildStockChain(),
          renderVideo: (renderOptions) => renderPlanToVideo(renderOptions),
          volumeModel,
          onToolActivity: (line) => console.log(line),
        };

        const turn = async (text: string) => {
          const result = await runAgentTurn({
            session,
            deps,
            model: orchestrator,
            userText: text,
          });
          console.log(`\n${result.text}`);
          console.log(formatCost(result));
        };

        console.log(
          `Dalang chat · proyek: ${session.paths.planPath}\n` +
            `model: ${orchestrator.key}${volumeModel ? ` · volume: ${volumeModel.key}` : ""}` +
            ` · registry: ${registry.source}\n` +
            (session.isEmpty
              ? "Proyek kosong — ceritakan brief videomu.\n"
              : `Plan termuat (${session.plan?.scenes.length} scene). Perintah: /status /undo /redo /biaya /keluar\n`),
        );

        if (options.once) {
          try {
            await turn(options.once);
          } finally {
            session.close();
          }
          return;
        }

        const readline = rl!;
        try {
          for (;;) {
            const line = (await readline.question("dalang> ")).trim();
            if (line === "") continue;
            if (line === "/keluar" || line === "/exit") break;
            if (line === "/status") {
              console.log(session.summary());
              continue;
            }
            if (line === "/undo") {
              const undone = session.undo();
              console.log(undone ? `undo: ${undone}` : "Tidak ada yang bisa di-undo.");
              continue;
            }
            if (line === "/redo") {
              const redone = session.redo();
              console.log(redone ? `redo: ${redone}` : "Tidak ada yang bisa di-redo.");
              continue;
            }
            if (line === "/biaya") {
              console.log(
                `  Sesi ini ~$${guards.sessionTotalUsd.toFixed(4)} · total tercatat proyek ~$${session.events
                  .totalCostUsd()
                  .toFixed(4)}`,
              );
              continue;
            }
            if (line === "/help") {
              console.log(
                "Perintah: /status /undo /redo /biaya /keluar — selain itu dikirim ke agent.",
              );
              continue;
            }
            await turn(line);
          }
        } finally {
          readline.close();
          session.close();
        }
      },
    );
};

export const registerLogCommand = (program: Command): void => {
  program
    .command("log")
    .argument("[proyek]", "folder proyek atau path plan.json", ".")
    .option("-n, --limit <n>", "jumlah entri", parsePositiveInt, 30)
    .description("Tampilkan garis waktu pipeline + agent (observability)")
    .action((proyek: string, options: { limit: number }) => {
      const planPath = resolvePlanPath(proyek);
      const paths = projectPaths(planPath);
      const db = new PipelineDb(paths.dbPath);
      const events = new AgentEventLog(paths.dbPath);
      try {
        if (existsSync(paths.planPath)) {
          const plan = readPlanFile(paths.planPath);
          const runs = db.listRuns(plan.projectId);
          if (runs.length > 0) {
            console.log("— Stage runs (pipeline) —");
            console.table(
              runs.map((run) => ({
                scene: run.sceneId,
                stage: run.stage,
                status: run.status,
                provider: run.provider ?? "",
                fallback: run.fallback ? "ya" : "",
                biayaUsd: run.costUsd ?? "",
                error: run.error ? run.error.slice(0, 40) : "",
              })),
            );
          }
        }
        const recent = events.recent(options.limit);
        if (recent.length > 0) {
          console.log("— Agent events —");
          console.table(
            recent.map((event) => ({
              waktu: event.at.slice(11, 19),
              giliran: event.turn,
              jenis: event.kind,
              nama: event.name,
              durasiMs: event.durationMs ?? "",
              biayaUsd: event.costUsd ?? "",
              error: event.error ? event.error.slice(0, 40) : "",
            })),
          );
        }
        console.log(`Total biaya tercatat: ~$${events.totalCostUsd().toFixed(4)}`);
      } finally {
        db.close();
        events.close();
      }
    });
};
