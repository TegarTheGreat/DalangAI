import type { MockLanguageModelV3 } from "ai/test";
import { afterEach, describe, expect, it } from "vitest";
import { Guardrails, runAgentTurn, SYSTEM_PROMPT } from "../src/index";
import {
  basicPlan,
  COST_PER_STEP,
  makeDeps,
  resolvedScripted,
  tempProject,
  textStep,
  toolCallStep,
} from "./helpers";

let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups) fn();
  cleanups = [];
});

const open = (plan: Parameters<typeof tempProject>[0]) => {
  const project = tempProject(plan);
  cleanups.push(project.cleanup);
  return project;
};

describe("runAgentTurn (loop multi-step di bawah guardrails)", () => {
  it("skenario bahagia: tool call → jawaban; konteks & riwayat benar", async () => {
    const project = open(basicPlan());
    const { deps } = makeDeps({});
    const model = resolvedScripted([
      toolCallStep("getProjectState", {}),
      textStep("Plan berisi 2 scene, siap kuubah sesuai brief."),
    ]);

    const result = await runAgentTurn({
      session: project.session,
      deps,
      model,
      userText: "Ceritakan keadaan proyek.",
    });

    expect(result.text).toContain("2 scene");
    expect(result.stop).toBe("selesai");
    expect(result.steps).toBe(2);
    expect(result.llmCostUsd).toBeCloseTo(2 * COST_PER_STEP, 6);

    // Prompt yang dikirim membawa system prompt & blok keadaan proyek.
    const mock = model.model as MockLanguageModelV3;
    const firstCall = mock.doGenerateCalls[0]!;
    const promptText = JSON.stringify(firstCall.prompt);
    expect(promptText).toContain("KEADAAN PROYEK");
    expect(promptText).toContain("sc-001");
    expect(promptText).toContain(SYSTEM_PROMPT.slice(0, 40));

    // Riwayat tumbuh (user + jejak assistant/tool) dan dipersist.
    expect(project.session.history.length).toBeGreaterThanOrEqual(3);
    const events = project.session.events.recent();
    expect(events.some((event) => event.kind === "llm")).toBe(true);
    expect(events.some((event) => event.name === "getProjectState")).toBe(true);
  });

  it("agent yang mengubah plan lewat applyPatch benar-benar mempersist", async () => {
    const project = open(basicPlan());
    const { deps } = makeDeps({});
    const model = resolvedScripted([
      toolCallStep("applyPatch", {
        ops: [
          {
            op: "updateScene",
            id: "sc-001",
            patch: { narration: "Narasi baru dari agent." },
          },
        ],
      }),
      textStep("Sudah kuubah narasi scene pertama."),
    ]);

    const result = await runAgentTurn({
      session: project.session,
      deps,
      model,
      userText: "Perbaiki narasi scene 1.",
    });
    expect(result.stop).toBe("selesai");
    expect(project.session.plan?.scenes[0]?.narration).toBe("Narasi baru dari agent.");
    expect(project.session.patchLog.summarize()).toContain("agent: mengubah");
  });

  it("step cap menghentikan loop yang tak berujung (PRD §6.3)", async () => {
    const project = open(basicPlan());
    const recorder = makeDeps({});
    recorder.deps.guards = new Guardrails({ stepCap: 3 }, async () => true);
    const model = resolvedScripted(() => toolCallStep("getProjectState", {}));

    const result = await runAgentTurn({
      session: project.session,
      deps: recorder.deps,
      model,
      userText: "loop terus",
    });
    expect(result.steps).toBe(3);
    expect(result.stop).toBe("step-cap");
    expect(result.text).toContain("batas langkah");
  });

  it("budget giliran menghentikan loop lebih awal", async () => {
    const project = open(basicPlan());
    const limited = makeDeps({});
    // COST_PER_STEP = 0.0015 → budget 0.001 terlampaui setelah 1 langkah.
    limited.deps.guards = new Guardrails(
      { turnBudgetUsd: 0.001, stepCap: 15 },
      async () => true,
    );
    const model = resolvedScripted(() => toolCallStep("getProjectState", {}));

    const result = await runAgentTurn({
      session: project.session,
      deps: limited.deps,
      model,
      userText: "kerjakan banyak hal",
    });
    expect(result.steps).toBe(1);
    expect(result.stop).toBe("budget-giliran");
  });

  it("harga model tak diketahui → biaya null + ditandai parsial (bukan nol palsu)", async () => {
    const project = open(basicPlan());
    const { deps } = makeDeps({});
    const model = { ...resolvedScripted([textStep("Halo.")]), info: undefined };

    const result = await runAgentTurn({
      session: project.session,
      deps,
      model,
      userText: "halo",
    });
    expect(result.llmCostUsd).toBeNull();
    expect(result.costIsPartial).toBe(true);
  });

  it("editan manual antar giliran muncul sebagai peringatan konteks", async () => {
    const project = open(basicPlan());
    const { deps } = makeDeps({});

    // Giliran 1 memuat sesi; lalu user mengedit file di luar.
    await runAgentTurn({
      session: project.session,
      deps,
      model: resolvedScripted([textStep("Siap.")]),
      userText: "halo",
    });
    const { readFileSync, writeFileSync } = await import("node:fs");
    const onDisk = JSON.parse(readFileSync(project.planPath, "utf8"));
    onDisk.scenes[0].narration = "Editan manual user.";
    writeFileSync(project.planPath, JSON.stringify(onDisk, null, 2));

    const model = resolvedScripted([textStep("Kuhormati editanmu.")]);
    await runAgentTurn({
      session: project.session,
      deps,
      model,
      userText: "lanjutkan",
    });
    const mock = model.model as MockLanguageModelV3;
    const promptText = JSON.stringify(mock.doGenerateCalls[0]!.prompt);
    expect(promptText).toContain("MANUAL");
    expect(project.session.plan?.scenes[0]?.narration).toBe("Editan manual user.");
  });
});
