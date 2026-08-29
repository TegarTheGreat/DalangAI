import { describe, expect, it } from "vitest";
import { DIMENSIONS, parseScenePlan, safeParseScenePlan } from "../src/index";
import { basePlanInput, makePlan } from "./fixtures";

describe("scene-plan schema v0", () => {
  it("parses a minimal plan and applies defaults", () => {
    const plan = makePlan();
    expect(plan.meta.stylePreset).toBe("documentary-01");
    expect(plan.scenes[0]?.locked).toBe(false);
    expect(plan.scenes[0]?.duration).toBe("auto");
    expect(plan.scenes[0]?.caption).toEqual({ enabled: true, style: "inherit" });
    expect(plan.scenes[0]?.visual.assetId).toBeNull();
    expect(plan.scenes[0]?.visual.pinned).toBe(false);
    expect(plan.renderState).toEqual({ narrationAudio: {}, resolvedAssets: {} });
  });

  it("rejects duplicate scene ids", () => {
    const input = basePlanInput();
    input.scenes[1]!.id = "sc-001";
    const result = safeParseScenePlan(input);
    expect(result.success).toBe(false);
  });

  it("rejects unknown aspect ratios", () => {
    const input = basePlanInput();
    // @ts-expect-error — intentionally invalid
    input.meta.aspectRatio = "4:3";
    expect(safeParseScenePlan(input).success).toBe(false);
  });

  it("rejects unknown top-level fields (strict schema catches typos)", () => {
    const input = { ...basePlanInput(), scnes: [] } as unknown;
    expect(safeParseScenePlan(input).success).toBe(false);
  });

  it("rejects non-normalized annotation targets", () => {
    const input = basePlanInput();
    input.scenes[0]!.annotations = [
      {
        type: "zoom",
        target: { x: 0.5, y: 0.5, w: 1.5, h: 0.2 },
        timing: { startSec: 0 },
      },
    ];
    expect(safeParseScenePlan(input).success).toBe(false);
  });

  it("accepts renderState entries with license metadata", () => {
    const input = basePlanInput();
    input.renderState = {
      narrationAudio: {
        "sc-001": {
          file: "audio/sc-001.mp3",
          durationSec: 4.2,
          wordTimestamps: [{ word: "Borobudur", startSec: 0, endSec: 0.6 }],
        },
      },
      resolvedAssets: {
        "sc-001": {
          file: "assets/borobudur.jpg",
          kind: "image",
          source: "pexels",
          license: "Pexels License",
          author: "Test Author",
        },
      },
    };
    const plan = parseScenePlan(input);
    expect(plan.renderState.resolvedAssets["sc-001"]?.license).toBe("Pexels License");
  });

  it("throws a readable error message on invalid plans", () => {
    expect(() => parseScenePlan({ version: 1 })).toThrowError(/Scene-plan tidak valid/);
  });

  it("names unsupported schema versions explicitly", () => {
    expect(() => parseScenePlan({ version: 2 })).toThrowError(
      /Versi scene-plan 2 tidak didukung/,
    );
  });

  it("accepts an editor $schema field without leaking it into strictness", () => {
    const input = {
      ...basePlanInput(),
      $schema: "../../packages/core/schema/scene-plan.v1.schema.json",
    };
    const plan = parseScenePlan(input);
    expect(plan.$schema).toContain("scene-plan.v1");
  });

  it("exposes 1080p dimensions per aspect ratio", () => {
    expect(DIMENSIONS["9:16"]).toEqual({ width: 1080, height: 1920 });
    expect(DIMENSIONS["16:9"]).toEqual({ width: 1920, height: 1080 });
    expect(DIMENSIONS["1:1"]).toEqual({ width: 1080, height: 1080 });
  });
});
