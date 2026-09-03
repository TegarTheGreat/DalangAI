import { readFileSync, writeFileSync } from "node:fs";
import { PatchError } from "@dalang/core";
import { afterEach, describe, expect, it } from "vitest";
import { PRUNE_MARKER, ProjectSession } from "../src/index";
import { basicPlan, tempProject } from "./helpers";

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

describe("ProjectSession", () => {
  it("proyek kosong → isEmpty; initializePlan menulis file; init kedua ditolak", () => {
    const { session, planPath } = open(null);
    expect(session.isEmpty).toBe(true);
    expect(session.summary()).toContain("Proyek kosong");

    session.initializePlan(basicPlan());
    expect(session.isEmpty).toBe(false);
    expect(JSON.parse(readFileSync(planPath, "utf8")).projectId).toBe("proj-agent-test");
    expect(() => session.initializePlan(basicPlan())).toThrow(/sudah punya/);
  });

  it("applyAgentPatch mempersist plan + patch log; lock ditegakkan", () => {
    const { session, planPath } = open(basicPlan());
    const { summary } = session.applyAgentPatch([
      { op: "updateScene", id: "sc-001", patch: { narration: "Diubah agent." } },
    ]);
    expect(summary).toContain("agent: mengubah scene sc-001");
    expect(JSON.parse(readFileSync(planPath, "utf8")).scenes[0].narration).toBe(
      "Diubah agent.",
    );

    const locked = open(
      basicPlan({
        scenes: [
          {
            id: "sc-001",
            locked: true,
            narration: "Terkunci.",
            clips: [{ id: "sc-001-k1", type: "solid" }],
          },
          {
            id: "sc-002",
            narration: "Bebas.",
            clips: [{ id: "sc-002-k1", type: "solid" }],
          },
        ],
      }),
    );
    expect(() =>
      locked.session.applyAgentPatch([
        { op: "updateScene", id: "sc-001", patch: { narration: "Hack" } },
      ]),
    ).toThrow(PatchError);
  });

  it("undo/redo bertahan lintas restart sesi (patch log dipersist)", () => {
    const { session, planPath } = open(basicPlan());
    session.applyAgentPatch([
      { op: "updateScene", id: "sc-001", patch: { narration: "Versi agent." } },
    ]);
    session.close();
    cleanups.pop(); // close manual — jangan double-close

    const reopened = ProjectSession.open(planPath);
    cleanups.push(() => reopened.close());
    expect(reopened.patchLog.canUndo).toBe(true);
    const undone = reopened.undo();
    expect(undone).toContain("sc-001");
    expect(reopened.plan?.scenes[0]?.narration).toBe("Kalimat pertama untuk agent.");
    expect(reopened.redo()).toContain("sc-001");
    expect(reopened.plan?.scenes[0]?.narration).toBe("Versi agent.");
  });

  it("detectExternalEdit memuat ulang & menyebut scene yang berubah manual", () => {
    const { session, planPath } = open(basicPlan());
    expect(session.detectExternalEdit()).toBeNull();

    const onDisk = JSON.parse(readFileSync(planPath, "utf8"));
    onDisk.scenes[1].narration = "Diedit user secara manual di editor.";
    writeFileSync(planPath, JSON.stringify(onDisk, null, 2));

    const note = session.detectExternalEdit();
    expect(note).toContain("MANUAL");
    expect(note).toContain("sc-002");
    expect(session.plan?.scenes[1]?.narration).toContain("manual");
    expect(session.detectExternalEdit()).toBeNull(); // sudah tersinkron
  });

  it("summary memuat status kunci/suara dan patch terakhir", () => {
    const { session } = open(
      basicPlan({
        scenes: [
          {
            id: "sc-001",
            locked: true,
            narration: "Scene terkunci user.",
            clips: [{ id: "sc-001-k1", type: "solid" }],
          },
        ],
      }),
    );
    const summary = session.summary();
    expect(summary).toContain("TERKUNCI");
    expect(summary).toContain("silence/v");
    expect(summary).toContain("Belum ada perubahan.");
  });

  it("riwayat chat dipersist dan dimuat ulang", () => {
    const { session, planPath } = open(basicPlan());
    session.history.push({ role: "user", content: "halo" });
    session.persist();
    session.close();
    cleanups.pop();

    const reopened = ProjectSession.open(planPath);
    cleanups.push(() => reopened.close());
    expect(reopened.history).toHaveLength(1);
  });

  it("riwayat panjang dipangkas AMAN: tanpa tool yatim di depan + penanda (ADR-0013)", () => {
    const { session, planPath } = open(basicPlan());
    // Dua pesan pembuka + 13 kelompok [user, assistant-toolcall, tool, assistant]
    // = 54 pesan; potongan -40 jatuh TEPAT di pesan `tool` (kasus terburuk).
    session.history.push(
      { role: "user", content: "pembuka satu" },
      { role: "user", content: "pembuka dua" },
    );
    for (let i = 0; i < 13; i++) {
      session.history.push(
        { role: "user", content: `pesan ${i}` },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: `c${i}`,
              toolName: "getProjectState",
              input: {},
            },
          ],
        } as never,
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: `c${i}`,
              toolName: "getProjectState",
              output: { type: "text", value: "ok" },
            },
          ],
        } as never,
        { role: "assistant", content: `jawaban ${i}` },
      );
    }
    session.persist();

    expect(session.history.length).toBeLessThanOrEqual(41);
    expect(session.history[0]?.content).toBe(PRUNE_MARKER);
    expect(session.history[1]?.role).not.toBe("tool");

    session.close();
    cleanups.pop();
    const reopened = ProjectSession.open(planPath);
    cleanups.push(() => reopened.close());
    expect(reopened.history[0]?.role).not.toBe("tool");
    expect(reopened.history.length).toBeLessThanOrEqual(41);
  });
});
