import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PipelineDb, projectPaths, readPlanFile, runTtsStage } from "../src/index";
import { basicPlan, fakeTts, makeTempProject, silentLog } from "./helpers";

let cleanupFns: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanupFns) fn();
  cleanupFns = [];
});

const setup = (planOverrides = {}) => {
  const project = makeTempProject(basicPlan(planOverrides));
  cleanupFns.push(project.cleanup);
  const paths = projectPaths(project.planPath);
  const plan = readPlanFile(paths.planPath);
  const db = new PipelineDb(":memory:");
  cleanupFns.push(() => db.close());
  return { paths, plan, db };
};

describe("runTtsStage", () => {
  it("synthesizes narrated scenes and fills renderState (audio-relative words)", async () => {
    const { paths, plan, db } = setup();
    const provider = fakeTts("utama");
    const { plan: next, results } = await runTtsStage({
      paths,
      plan,
      providers: [provider],
      db,
      log: silentLog,
    });

    expect(results.map((r) => r.status)).toEqual(["done", "done"]);
    expect(provider.calls).toHaveLength(2);
    const entry = next.renderState.narrationAudio["sc-001"];
    expect(entry?.durationSec).toBe(2.5);
    expect(entry?.fallbackQuality).toBeUndefined();
    expect(entry?.file.startsWith(".dalang/tts/")).toBe(true);
    expect(existsSync(join(paths.planDir, entry!.file))).toBe(true);
    expect(db.getRun(plan.projectId, "sc-001", "tts")?.status).toBe("done");
  });

  it("second run is a cache no-op (idempotent, provider untouched)", async () => {
    const { paths, plan, db } = setup();
    const provider = fakeTts("utama");
    const first = await runTtsStage({
      paths,
      plan,
      providers: [provider],
      db,
      log: silentLog,
    });
    const second = await runTtsStage({
      paths,
      plan: first.plan,
      providers: [provider],
      db,
      log: silentLog,
    });
    expect(provider.calls).toHaveLength(2); // only the first run called it
    expect(second.results.map((r) => r.status)).toEqual(["cached", "cached"]);
    expect(second.plan.renderState.narrationAudio["sc-001"]).toEqual(
      first.plan.renderState.narrationAudio["sc-001"],
    );
  });

  it("cache re-materializes renderState even when the plan lost it", async () => {
    const { paths, plan, db } = setup();
    const provider = fakeTts("utama");
    await runTtsStage({ paths, plan, providers: [provider], db, log: silentLog });
    // Simulate a reverted plan: renderState empty, ledger + files intact.
    const { plan: healed, results } = await runTtsStage({
      paths,
      plan, // original without narrationAudio
      providers: [provider],
      db,
      log: silentLog,
    });
    expect(results.every((r) => r.status === "cached")).toBe(true);
    expect(healed.renderState.narrationAudio["sc-001"]).toBeDefined();
    expect(provider.calls).toHaveLength(2);
  });

  it("narration change re-runs only because the hash changed", async () => {
    const { paths, plan, db } = setup();
    const provider = fakeTts("utama");
    const first = await runTtsStage({
      paths,
      plan,
      providers: [provider],
      db,
      log: silentLog,
    });
    const edited = structuredClone(first.plan);
    edited.scenes[0]!.narration = "Narasi baru yang berbeda.";
    const second = await runTtsStage({
      paths,
      plan: edited,
      providers: [provider],
      db,
      log: silentLog,
    });
    expect(second.results.find((r) => r.sceneId === "sc-001")?.status).toBe("done");
    expect(second.results.find((r) => r.sceneId === "sc-002")?.status).toBe("cached");
    expect(provider.calls).toHaveLength(3);
  });

  it("force re-runs everything", async () => {
    const { paths, plan, db } = setup();
    const provider = fakeTts("utama");
    const first = await runTtsStage({
      paths,
      plan,
      providers: [provider],
      db,
      log: silentLog,
    });
    const second = await runTtsStage({
      paths,
      plan: first.plan,
      providers: [provider],
      db,
      force: true,
      log: silentLog,
    });
    expect(second.results.every((r) => r.status === "done")).toBe(true);
    expect(provider.calls).toHaveLength(4);
  });

  it("falls back down the chain and marks fallbackQuality", async () => {
    const { paths, plan, db } = setup();
    const primary = fakeTts("utama", { fail: true });
    const backup = fakeTts("cadangan");
    const { plan: next, results } = await runTtsStage({
      paths,
      plan,
      providers: [primary, backup],
      db,
      log: silentLog,
    });
    expect(results[0]).toMatchObject({
      status: "done",
      provider: "cadangan",
      fallback: true,
    });
    expect(next.renderState.narrationAudio["sc-001"]?.fallbackQuality).toBe(true);
    expect(db.getRun(plan.projectId, "sc-001", "tts")?.fallback).toBe(true);
  });

  it("placeholder provider marks fallbackQuality even as primary", async () => {
    const { paths, plan, db } = setup();
    const placeholder = fakeTts("silence", { placeholder: true });
    const { plan: next } = await runTtsStage({
      paths,
      plan,
      providers: [placeholder],
      db,
      log: silentLog,
    });
    expect(next.renderState.narrationAudio["sc-001"]?.fallbackQuality).toBe(true);
  });

  it("records errors per scene when the whole chain fails", async () => {
    const { paths, plan, db } = setup();
    const broken = fakeTts("rusak", { fail: true });
    const { plan: next, results } = await runTtsStage({
      paths,
      plan,
      providers: [broken],
      db,
      log: silentLog,
    });
    expect(results.every((r) => r.status === "error")).toBe(true);
    expect(next.renderState.narrationAudio["sc-001"]).toBeUndefined();
    expect(db.getRun(plan.projectId, "sc-001", "tts")?.status).toBe("error");
  });

  it("skips cleanly when audio.voice is not set", async () => {
    const { paths, plan, db } = setup({ audio: {} });
    const provider = fakeTts("utama");
    const { results } = await runTtsStage({
      paths,
      plan,
      providers: [provider],
      db,
      log: silentLog,
    });
    expect(results.every((r) => r.status === "skipped")).toBe(true);
    expect(provider.calls).toHaveLength(0);
  });
});
