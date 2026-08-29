import { NARRATION_LEAD_IN_SEC, parseScenePlan, type ScenePlan } from "@dalang/core";
import { describe, expect, it } from "vitest";
import { buildCaptionPages } from "../src/captions-model";
import { FPS } from "../src/layout";

const planWith = (overrides: {
  narration?: string;
  captionEnabled?: boolean;
  wordTimestamps?: Array<{ word: string; startSec: number; endSec: number }>;
}): ScenePlan =>
  parseScenePlan({
    version: 1,
    projectId: "p",
    meta: { title: "T" },
    scenes: [
      {
        id: "sc-001",
        narration:
          overrides.narration ??
          "Dua juta balok batu andesit disusun tanpa semen sedikit pun",
        caption: { enabled: overrides.captionEnabled ?? true },
        visual: { type: "solid" },
        duration: 7,
      },
    ],
    renderState: overrides.wordTimestamps
      ? {
          narrationAudio: {
            "sc-001": {
              file: "audio/sc-001.mp3",
              durationSec: 5,
              wordTimestamps: overrides.wordTimestamps,
            },
          },
          resolvedAssets: {},
        }
      : undefined,
  });

const build = (plan: ScenePlan, sceneDurationFrames = 7 * FPS) =>
  buildCaptionPages({
    scene: plan.scenes[0]!,
    plan,
    sceneDurationFrames,
    fps: FPS,
  });

describe("buildCaptionPages", () => {
  it("returns nothing for disabled captions or empty narration", () => {
    expect(build(planWith({ captionEnabled: false }))).toEqual([]);
    expect(build(planWith({ narration: "   " }))).toEqual([]);
  });

  it("pages are sequential, non-overlapping, and inside the scene", () => {
    const pages = build(planWith({}));
    expect(pages.length).toBeGreaterThan(1);
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]!;
      expect(page.durationInFrames).toBeGreaterThan(0);
      expect(page.startFrame + page.durationInFrames).toBeLessThanOrEqual(7 * FPS);
      if (i > 0) {
        const prev = pages[i - 1]!;
        expect(page.startFrame).toBeGreaterThanOrEqual(
          prev.startFrame + prev.durationInFrames,
        );
      }
    }
  });

  it("estimated captions start after the narration lead-in", () => {
    const pages = build(planWith({}));
    expect(pages[0]!.startFrame).toBe(Math.round(NARRATION_LEAD_IN_SEC * FPS));
  });

  it("real TTS timestamps (audio-relative) get the same lead-in offset", () => {
    const pages = build(
      planWith({
        narration: "Halo dunia",
        wordTimestamps: [
          { word: "Halo", startSec: 0, endSec: 0.4 },
          { word: "dunia", startSec: 0.4, endSec: 0.9 },
        ],
      }),
    );
    expect(pages).toHaveLength(1);
    const page = pages[0]!;
    expect(page.startMs).toBeCloseTo(NARRATION_LEAD_IN_SEC * 1000, 3);
    expect(page.tokens[0]!.fromMs).toBeCloseTo(NARRATION_LEAD_IN_SEC * 1000, 3);
    expect(page.tokens[1]!.toMs).toBeCloseTo(900 + NARRATION_LEAD_IN_SEC * 1000, 3);
    // Token text keeps the leading-space convention for whiteSpace: pre-wrap.
    expect(page.tokens.map((token) => token.text).join("")).toBe("Halo dunia");
  });

  it("every narration word survives pagination, in order", () => {
    const narration =
      "Sembilan tingkatnya melambangkan perjalanan menuju pencerahan dihiasi panel relief dan arca Buddha";
    const pages = build(planWith({ narration }));
    const words = pages
      .flatMap((page) => page.tokens.map((token) => token.text.trim()))
      .filter(Boolean);
    expect(words).toEqual(narration.split(/\s+/));
  });
});
