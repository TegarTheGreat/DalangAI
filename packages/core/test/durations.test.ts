import { describe, expect, it } from "vitest";
import {
  computeTimeline,
  estimateNarrationSeconds,
  estimateWordTimestamps,
  MIN_SCENE_SEC,
  NARRATION_LEAD_IN_SEC,
  resolveSceneDurationSec,
  SCENE_PADDING_SEC,
  SILENT_SCENE_SEC,
} from "../src/index";
import { makePlan } from "./fixtures";

describe("duration resolution (deterministic)", () => {
  it("fixed numeric durations pass through", () => {
    const plan = makePlan((input) => {
      input.scenes[0]!.duration = 7.5;
    });
    expect(resolveSceneDurationSec(plan.scenes[0]!, plan)).toBe(7.5);
  });

  it("auto uses TTS audio duration when available", () => {
    const plan = makePlan((input) => {
      input.renderState = {
        narrationAudio: {
          "sc-001": { file: "audio/sc-001.mp3", durationSec: 6 },
        },
        resolvedAssets: {},
      };
    });
    expect(resolveSceneDurationSec(plan.scenes[0]!, plan)).toBe(
      NARRATION_LEAD_IN_SEC + 6 + SCENE_PADDING_SEC,
    );
  });

  it("auto estimates from word count before TTS exists", () => {
    const plan = makePlan();
    const scene = plan.scenes[0]!; // 5 kata
    const estimated = estimateNarrationSeconds(scene.narration);
    expect(estimated).toBeCloseTo(5 / 2.4, 5);
    expect(resolveSceneDurationSec(scene, plan)).toBeCloseTo(
      Math.max(
        MIN_SCENE_SEC,
        NARRATION_LEAD_IN_SEC + estimated + SCENE_PADDING_SEC,
      ),
      5,
    );
  });

  it("clamps very short narrations to the minimum scene duration", () => {
    const plan = makePlan((input) => {
      input.scenes[0]!.narration = "Ya.";
    });
    expect(resolveSceneDurationSec(plan.scenes[0]!, plan)).toBe(MIN_SCENE_SEC);
  });

  it("narration-less scenes get the silent default", () => {
    const plan = makePlan((input) => {
      input.scenes[0]!.narration = "";
    });
    expect(resolveSceneDurationSec(plan.scenes[0]!, plan)).toBe(
      SILENT_SCENE_SEC,
    );
  });

  it("voice speed shortens the estimate", () => {
    const plan = makePlan((input) => {
      input.audio = {
        voice: { provider: "elevenlabs", voiceId: "v", speed: 1.2 },
      };
    });
    const scene = plan.scenes[0]!;
    const expected =
      NARRATION_LEAD_IN_SEC +
      estimateNarrationSeconds(scene.narration, 1.2) +
      SCENE_PADDING_SEC;
    expect(resolveSceneDurationSec(scene, plan)).toBeCloseTo(
      Math.max(MIN_SCENE_SEC, expected),
      5,
    );
  });

  it("computeTimeline lays scenes out sequentially", () => {
    const plan = makePlan((input) => {
      input.scenes[0]!.duration = 3;
      input.scenes[1]!.duration = 4;
      input.scenes[2]!.duration = 5;
    });
    const { timings, totalSec } = computeTimeline(plan);
    expect(totalSec).toBe(12);
    expect(timings.map((timing) => timing.startSec)).toEqual([0, 3, 7]);
  });
});

describe("estimateWordTimestamps", () => {
  it("returns empty for empty narration", () => {
    expect(estimateWordTimestamps("", 5)).toEqual([]);
  });

  it("covers the narration window monotonically", () => {
    const words = estimateWordTimestamps(
      "Borobudur dibangun pada abad ke-9 oleh dinasti Syailendra",
      6,
    );
    expect(words[0]?.startSec).toBeCloseTo(NARRATION_LEAD_IN_SEC, 3);
    expect(words.at(-1)?.endSec).toBeCloseTo(6 - SCENE_PADDING_SEC * 0.5, 3);
    for (let i = 1; i < words.length; i++) {
      expect(words[i]!.startSec).toBeGreaterThanOrEqual(words[i - 1]!.endSec - 1e-9);
    }
    // Longer words get more time.
    const borobudur = words.find((w) => w.word === "Borobudur")!;
    const pada = words.find((w) => w.word === "pada")!;
    expect(borobudur.endSec - borobudur.startSec).toBeGreaterThan(
      pada.endSec - pada.startSec,
    );
  });
});
