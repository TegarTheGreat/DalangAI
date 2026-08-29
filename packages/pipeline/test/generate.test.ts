import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { generatePlan } from "../src/index";
import { basicPlan, fakeStock, fakeTts, makeTempProject, silentLog } from "./helpers";

let cleanupFns: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanupFns) fn();
  cleanupFns = [];
});

describe("generatePlan (end-to-end, fake providers)", () => {
  it("runs both stages and writes renderState back to the plan file", async () => {
    const project = makeTempProject(basicPlan());
    cleanupFns.push(project.cleanup);
    const tts = fakeTts("t");
    const stock = fakeStock("s");

    const summary = await generatePlan({
      planPath: project.planPath,
      ttsProviders: [tts],
      stockProviders: [stock],
      log: silentLog,
    });

    expect(summary.planChanged).toBe(true);
    expect(summary.errorCount).toBe(0);
    expect(summary.totalCostUsd).toBeCloseTo(0.02, 5);

    const onDisk = JSON.parse(readFileSync(project.planPath, "utf8"));
    expect(onDisk.renderState.narrationAudio["sc-001"].file).toContain(".dalang/tts/");
    expect(onDisk.renderState.resolvedAssets["sc-001"].source).toBe("s");
    expect(onDisk.scenes[0].visual.assetId).toBe("s:video:42");
    // Creative fields untouched.
    expect(onDisk.scenes[0].narration).toBe("Kalimat pertama untuk diuji.");
  });

  it("second run is fully cached and does not rewrite the plan", async () => {
    const project = makeTempProject(basicPlan());
    cleanupFns.push(project.cleanup);
    const tts = fakeTts("t");
    const stock = fakeStock("s");
    const args = {
      planPath: project.planPath,
      ttsProviders: [tts],
      stockProviders: [stock],
      log: silentLog,
    };

    await generatePlan(args);
    const before = readFileSync(project.planPath, "utf8");
    const second = await generatePlan(args);

    expect(second.planChanged).toBe(false);
    expect(readFileSync(project.planPath, "utf8")).toBe(before);
    expect(tts.calls).toHaveLength(2);
    expect(stock.searchCalls).toHaveLength(1);
    expect(
      [...second.tts, ...second.assets].every(
        (r) => r.status === "cached" || r.status === "skipped",
      ),
    ).toBe(true);
  });

  it("propagates per-scene errors into errorCount without stopping the run", async () => {
    const project = makeTempProject(basicPlan());
    cleanupFns.push(project.cleanup);
    const summary = await generatePlan({
      planPath: project.planPath,
      ttsProviders: [fakeTts("rusak", { fail: true })],
      stockProviders: [fakeStock("s")],
      log: silentLog,
    });
    expect(summary.errorCount).toBe(2); // both narrated scenes failed TTS
    expect(summary.assets.find((r) => r.sceneId === "sc-001")?.status).toBe("done"); // asset stage still ran
  });
});
