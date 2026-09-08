import { memoryConflictLines, memoryContextLines } from "@dalang/core";
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

/** Lampiran gambar dari user (chat multimodal, ADR-0011). */
export interface ImageAttachment {
  /** Base64 TANPA prefix data URL. */
  base64: string;
  mediaType: string;
}

/**
 * Susun pesan user: blok konteks + teks (+ gambar bila ada). Diekspor murni
 * agar bentuk multimodalnya bisa diuji unit tanpa model.
 */
export const buildUserMessage = (
  contextBlock: string,
  userText: string,
  images: ImageAttachment[] = [],
): ModelMessage => {
  const text = `${contextBlock}\n\n[PESAN USER]\n${userText}`;
  if (images.length === 0) {
    return { role: "user", content: text };
  }
  return {
    role: "user",
    content: [
      // Bagian "file", bukan "image": bentuk "image" sudah usang di AI SDK v7
      // dan memicu peringatan deprecation di setiap panggilan multimodal.
      ...images.map((image) => ({
        type: "file" as const,
        data: image.base64,
        mediaType: image.mediaType,
      })),
      { type: "text" as const, text },
    ],
  };
};

export const runAgentTurn = async ({
  session,
  deps,
  model,
  userText,
  images = [],
}: {
  session: ProjectSession;
  deps: AgentDeps;
  model: ResolvedModel;
  userText: string;
  images?: ImageAttachment[];
}): Promise<AgentTurnResult> => {
  const { guards } = deps;
  session.turn += 1;
  guards.beginTurn();

  const externalNote = session.detectExternalEdit();
  // ADR-0029: preferensi lintas proyek ikut tiap giliran — di pesan user,
  // bukan di system prompt, supaya prompt-cache tetap utuh saat memori berubah.
  const memory = deps.memory?.read();
  const memoryLines = memory ? memoryContextLines(memory) : [];
  // Dua preferensi mutlak yang bertabrakan bukan untuk dipilih agent sendiri:
  // barisnya menyuruh bertanya.
  const conflictLines = memory ? memoryConflictLines(memory) : [];
  const contextBlock = [
    "[KEADAAN PROYEK — disusun otomatis oleh sistem, bukan ditulis user]",
    ...(externalNote ? [`PERHATIAN: ${externalNote}`] : []),
    session.summary(),
    ...(memoryLines.length > 0
      ? [
          "",
          "[PREFERENSI USER LINTAS PROYEK — dari memori; berlaku untuk semua proyek kecuali user berkata lain di proyek ini]",
          ...memoryLines,
          ...conflictLines,
        ]
      : []),
  ].join("\n");

  const userMessage = buildUserMessage(contextBlock, userText, images);

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

  // Riwayat dipersist tanpa byte gambar (hemat; konteks giliran depan cukup
  // tahu bahwa ada lampiran).
  const persistedUserMessage: ModelMessage =
    images.length === 0
      ? userMessage
      : {
          role: "user",
          content: `${contextBlock}\n\n[PESAN USER — dengan ${images.length} gambar terlampir]\n${userText}`,
        };
  session.history.push(
    persistedUserMessage,
    ...(result.responseMessages as ModelMessage[]),
  );
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
