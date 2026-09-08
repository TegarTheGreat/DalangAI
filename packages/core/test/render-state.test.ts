import { describe, expect, it } from "vitest";
import {
  assignResolvedAsset,
  pruneRenderState,
  setClipAsset,
  setNarrationAudio,
} from "../src/index";
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

  it("setClipAsset stores license metadata", () => {
    const plan = makePlan();
    const next = setClipAsset(plan, "sc-002-k1", {
      file: "assets/x.jpg",
      kind: "image",
      source: "pexels",
      license: "Pexels License",
    });
    expect(next.renderState.clipAssets["sc-002-k1"]?.license).toBe("Pexels License");
  });

  it("assignResolvedAsset fills visual.assetId without pinning", () => {
    const plan = makePlan();
    const next = assignResolvedAsset(plan, "sc-001", "pexels:video:7", {
      file: "assets/x.mp4",
      kind: "video",
      source: "pexels",
      license: "Pexels License",
    });
    const scene = next.scenes[0]!;
    expect(scene.clips[0]?.assetId).toBe("pexels:video:7");
    expect(scene.clips[0]?.pinned).toBe(false);
    expect(next.renderState.clipAssets["sc-001-k1"]?.kind).toBe("video");
    expect(plan.scenes[0]?.clips[0]?.assetId).toBeNull(); // immutably
  });

  it("assignResolvedAsset refuses pinned scenes and unknown ids", () => {
    const plan = makePlan((input) => {
      input.scenes[0]!.clips[0]!.pinned = true;
      input.scenes[0]!.clips[0]!.assetId = "pilihan:user";
    });
    expect(() =>
      assignResolvedAsset(plan, "sc-001", "auto:1", {
        file: "assets/x.jpg",
        kind: "image",
        source: "pexels",
      }),
    ).toThrow(/ter-pin/);
    expect(() =>
      assignResolvedAsset(plan, "sc-hantu", "auto:1", {
        file: "assets/x.jpg",
        kind: "image",
        source: "pexels",
      }),
    ).toThrow(/tidak ditemukan/);
  });

  it("pruneRenderState drops entries for removed scenes only", () => {
    let plan = makePlan();
    plan = setNarrationAudio(plan, "sc-001", {
      file: "a.mp3",
      durationSec: 1,
    });
    plan = setClipAsset(plan, "sc-hantu-k1", {
      file: "assets/x.jpg",
      kind: "image",
      source: "local",
    });
    const pruned = pruneRenderState(plan);
    expect(pruned.renderState.narrationAudio["sc-001"]).toBeDefined();
    expect(pruned.renderState.clipAssets["sc-hantu-k1"]).toBeUndefined();
  });
});
