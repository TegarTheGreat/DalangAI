import { describe, expect, it } from "vitest";
import { applyPatch, PatchLog, type ScenePlan } from "../src/index";
import { makePlan } from "./fixtures";

const editNarration = (
  plan: ScenePlan,
  log: PatchLog,
  id: string,
  narration: string,
  origin: "user" | "agent" = "user",
): ScenePlan => {
  const { plan: next, applied } = applyPatch(
    plan,
    [{ op: "updateScene", id, patch: { narration } }],
    { origin },
  );
  log.record(applied);
  return next;
};

describe("PatchLog", () => {
  it("undo/redo roundtrip restores exact states", () => {
    const log = new PatchLog();
    const v0 = makePlan();
    const v1 = editNarration(v0, log, "sc-001", "Versi 1");
    const v2 = editNarration(v1, log, "sc-002", "Versi 2");

    const undo1 = log.undo(v2);
    expect(undo1?.plan).toEqual(v1);
    const undo2 = log.undo(undo1!.plan);
    expect(undo2?.plan).toEqual(v0);
    expect(log.canUndo).toBe(false);

    const redo1 = log.redo(undo2!.plan);
    expect(redo1?.plan).toEqual(v1);
    const redo2 = log.redo(redo1!.plan);
    expect(redo2?.plan).toEqual(v2);
    expect(log.canRedo).toBe(false);
  });

  it("a new record clears the redo stack", () => {
    const log = new PatchLog();
    const v0 = makePlan();
    const v1 = editNarration(v0, log, "sc-001", "Satu");
    const { plan: v0again } = log.undo(v1)!;
    expect(log.canRedo).toBe(true);
    editNarration(v0again, log, "sc-003", "Cabang baru");
    expect(log.canRedo).toBe(false);
  });

  it("undo works even if the scene got locked after the agent edit", () => {
    const log = new PatchLog();
    const v0 = makePlan();
    const v1 = editNarration(v0, log, "sc-001", "Edit agent", "agent");
    // User locks the scene afterwards (not recorded — irrelevant for this test).
    const { plan: v2 } = applyPatch(
      v1,
      [{ op: "lockScene", id: "sc-001", locked: true }],
      { origin: "user" },
    );
    const undone = log.undo(v2);
    expect(undone?.plan.scenes[0]?.narration).toBe(
      "Borobudur dibangun pada abad ke-9.",
    );
  });

  it("summarize reports recent changes, filterable by origin", () => {
    const log = new PatchLog();
    const v0 = makePlan();
    const v1 = editNarration(v0, log, "sc-001", "Oleh user", "user");
    editNarration(v1, log, "sc-002", "Oleh agent", "agent");

    expect(log.summarize()).toContain("user: mengubah scene sc-001");
    expect(log.summarize()).toContain("agent: mengubah scene sc-002");
    expect(log.summarize(5, "user")).not.toContain("agent:");
    expect(new PatchLog().summarize()).toBe("Belum ada perubahan.");
  });

  it("survives JSON serialization", () => {
    const log = new PatchLog();
    const v0 = makePlan();
    const v1 = editNarration(v0, log, "sc-001", "Serialisasi");
    const restored = PatchLog.fromJSON(JSON.parse(JSON.stringify(log.toJSON())));
    const undone = restored.undo(v1);
    expect(undone?.plan).toEqual(v0);
  });
});
