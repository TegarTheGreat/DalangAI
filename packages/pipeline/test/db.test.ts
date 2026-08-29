import { describe, expect, it } from "vitest";
import { PipelineDb } from "../src/index";

const openDb = () => new PipelineDb(":memory:");

describe("PipelineDb", () => {
  it("start → finish roundtrip preserves all fields", () => {
    const db = openDb();
    db.startRun("p", "sc-001", "tts", "hash-1");
    expect(db.getRun("p", "sc-001", "tts")?.status).toBe("running");

    db.finishRun("p", "sc-001", "tts", {
      provider: "silence",
      fallback: true,
      outputJson: '{"file":"x.wav"}',
      costUsd: 0.02,
      durationMs: 120,
    });
    const run = db.getRun("p", "sc-001", "tts");
    expect(run).toMatchObject({
      status: "done",
      provider: "silence",
      fallback: true,
      outputJson: '{"file":"x.wav"}',
      costUsd: 0.02,
      durationMs: 120,
      inputHash: "hash-1",
    });
    db.close();
  });

  it("failRun records the error", () => {
    const db = openDb();
    db.startRun("p", "sc-001", "assets", "h");
    db.failRun("p", "sc-001", "assets", "provider mati", 50);
    expect(db.getRun("p", "sc-001", "assets")).toMatchObject({
      status: "error",
      error: "provider mati",
    });
    db.close();
  });

  it("startRun over a stale row resets it (crash recovery)", () => {
    const db = openDb();
    db.startRun("p", "sc-001", "tts", "old");
    db.finishRun("p", "sc-001", "tts", {
      provider: "x",
      fallback: false,
      outputJson: "{}",
      costUsd: 0,
      durationMs: 1,
    });
    db.startRun("p", "sc-001", "tts", "new");
    const run = db.getRun("p", "sc-001", "tts");
    expect(run).toMatchObject({
      status: "running",
      inputHash: "new",
      provider: null,
      outputJson: null,
    });
    db.close();
  });

  it("keys runs by project, scene, and stage independently", () => {
    const db = openDb();
    db.startRun("p", "sc-001", "tts", "a");
    db.startRun("p", "sc-001", "assets", "b");
    db.startRun("p2", "sc-001", "tts", "c");
    expect(db.getRun("p", "sc-001", "tts")?.inputHash).toBe("a");
    expect(db.getRun("p", "sc-001", "assets")?.inputHash).toBe("b");
    expect(db.getRun("p2", "sc-001", "tts")?.inputHash).toBe("c");
    expect(db.listRuns("p")).toHaveLength(2);
    db.close();
  });
});
