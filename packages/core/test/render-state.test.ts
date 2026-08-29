import { describe, expect, it } from "vitest";
import { pruneRenderState, setNarrationAudio, setResolvedAsset } from "../src/index";
import { makePlan } from "./fixtures";

describe("renderState helpers (pipeline write path)", () => {
  it("setNarrationAudio validates and writes immutably", () => {
    const plan = makePlan();
    const next = setNarrationAudio(plan, "sc-001", {
      file: "audio/sc-001.mp3",
      durationSec: 4.2,
      wordTimestamps: [{ word: "Borobudur", startSec: 0, endSec: 0.62 }],
    });
    expect(next.renderState.narrationAudio["sc-001"]?.durationSec).toBe(4.2);
    expect(plan.renderState.narrationAudio["sc-001"]).toBeUndefined();
  });

  it("setNarrationAudio rejects invalid entries", () => {
    const plan = makePlan();
    expect(() =>
      setNarrationAudio(plan, "sc-001", {
        file: "",
        durationSec: -1,
      } as never),
    ).toThrow();
  });

  it("setResolvedAsset stores license metadata", () => {
    const plan = makePlan();
    const next = setResolvedAsset(plan, "sc-002", {
      file: "assets/x.jpg",
      kind: "image",
      source: "pexels",
      license: "Pexels License",
    });
    expect(next.renderState.resolvedAssets["sc-002"]?.license).toBe("Pexels License");
  });

  it("pruneRenderState drops entries for removed scenes only", () => {
    let plan = makePlan();
    plan = setNarrationAudio(plan, "sc-001", {
      file: "a.mp3",
      durationSec: 1,
    });
    plan = setResolvedAsset(plan, "sc-hantu", {
      file: "assets/x.jpg",
      kind: "image",
      source: "local",
    });
    const pruned = pruneRenderState(plan);
    expect(pruned.renderState.narrationAudio["sc-001"]).toBeDefined();
    expect(pruned.renderState.resolvedAssets["sc-hantu"]).toBeUndefined();
  });
});
