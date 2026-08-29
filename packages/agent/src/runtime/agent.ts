import { generateText, type ModelMessage } from "ai";
import type { ResolvedModel } from "../models/resolve";
import { SYSTEM_PROMPT } from "../system-prompt";
import { type AgentDeps, buildAgentTools } from "../tools";
import type { TurnStopReason } from "./guardrails";
import type { ProjectSession } from "./session";

/**
 * Satu giliran chat agent (PRD §6): konteks dinamis disuntikkan ke pesan
 * user, loop tool berjalan di bawah guardrails (step cap + budget), riwayat
 * penuh (termasuk jejak tool) dipersist untuk giliran berikutnya.
 */

export interface AgentTurnResult {
  text: string;
  stop: TurnStopReason;
  steps: number;
  /** Estimasi biaya LLM giliran ini; null bila harga model tak diketahui. */
  llmCostUsd: number | null;
  toolCostUsd: number;
  costIsPartial: boolean;
}

export const runAgentTurn = async ({
  session,
  deps,
  model,
  userText,
}: {
  session: ProjectSession;
  deps: AgentDeps;
  model: ResolvedModel;
  userText: string;
}): Promise<AgentTurnResult> => {
  const { guards } = deps;
  session.turn += 1;
  guards.beginTurn();

  const externalNote = session.detectExternalEdit();
  const contextBlock = [
    "[KEADAAN PROYEK — disusun otomatis oleh sistem, bukan ditulis user]",
    ...(externalNote ? [`⚠ ${externalNote}`] : []),
    session.summary(),
  ].join("\n");

  const userMessage: ModelMessage = {
    role: "user",
    content: `${contextBlock}\n\n[PESAN USER]\n${userText}`,
  };

  const result = await generateText({
    model: model.model,
    system: SYSTEM_PROMPT,
    messages: [...session.history, userMessage],
    tools: buildAgentTools(session, deps),
    stopWhen: guards.stopConditions(),
    onStepFinish: (step) => {
      guards.addLlmUsage(model.info, step.usage);
    },
  });

  session.events.record({
    turn: session.turn,
    kind: "llm",
    name: `turn:${model.key}`,
    input: { chars: userText.length, steps: result.steps.length },
    output: {
      inputTokens: result.totalUsage.inputTokens,
      outputTokens: result.totalUsage.outputTokens,
    },
    costUsd: guards.turnCostIsPartial ? null : Number(guards.llmCostTurn.toFixed(6)),
  });

  session.history.push(userMessage, ...(result.responseMessages as ModelMessage[]));
  session.persist();

  const stop = guards.classifyStop(result.steps.length);
  const fallbackText =
    stop === "step-cap"
      ? "(Berhenti: batas langkah per giliran tercapai — lanjutkan dengan instruksi berikutnya.)"
      : stop === "budget-giliran"
        ? "(Berhenti: budget biaya giliran tercapai — lanjutkan bila ingin meneruskan.)"
        : "(selesai tanpa teks)";

  return {
    text: result.text.trim() !== "" ? result.text : fallbackText,
    stop,
    steps: result.steps.length,
    llmCostUsd: guards.turnCostIsPartial ? null : guards.llmCostTurn,
    toolCostUsd: guards.toolCostTurn,
    costIsPartial: guards.turnCostIsPartial,
  };
};
