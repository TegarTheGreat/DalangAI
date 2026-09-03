import { type AspectRatio, DIMENSIONS, parseScenePlan } from "@dalang/core";
import { describe, expect, it } from "vitest";
import demoPlan from "../../../examples/borobudur-60s/plan.json";
import {
  activeSceneIndex,
  aspectMetrics,
  computeFrameLayout,
  FPS,
  TRANSITION_FRAMES,
} from "../src/layout";

describe("computeFrameLayout", () => {
  it("overlaps transitions and quantizes to frames", () => {
    const plan = parseScenePlan({
      version: 2,
      projectId: "p",
      meta: { title: "T" },
      scenes: [
        { id: "a", duration: 3, clips: [{ id: "a-k1", type: "solid" }] },
        { id: "b", duration: 4, clips: [{ id: "b-k1", type: "solid" }] },
        { id: "c", duration: 5, clips: [{ id: "c-k1", type: "solid" }] },
      ],
    });
    const layout = computeFrameLayout(plan);
    expect(layout.sceneFrames).toEqual([90, 120, 150]);
    expect(layout.sceneStarts).toEqual([
      0,
      90 - TRANSITION_FRAMES,
      90 + 120 - 2 * TRANSITION_FRAMES,
    ]);
    expect(layout.totalFrames).toBe(90 + 120 + 150 - 2 * TRANSITION_FRAMES);
  });

  it("clamps pathological short scenes so transitions always fit", () => {
    const plan = parseScenePlan({
      version: 2,
      projectId: "p",
      meta: { title: "T" },
      scenes: [
        { id: "a", duration: 0.2, clips: [{ id: "a-k1", type: "solid" }] },
        { id: "b", duration: 0.2, clips: [{ id: "b-k1", type: "solid" }] },
      ],
    });
    const layout = computeFrameLayout(plan);
    for (const frames of layout.sceneFrames) {
      expect(frames).toBeGreaterThanOrEqual(TRANSITION_FRAMES * 2 + 6);
    }
    expect(layout.totalFrames).toBeGreaterThan(0);
  });

  it("demo plan timeline stays stable (guards accidental timing changes)", () => {
    const plan = parseScenePlan(demoPlan);
    const layout = computeFrameLayout(plan);
    // ADR-0014: tempo transisi demo bervariasi (10-24 frame per batas).
    // ADR-0017: angka bergeser naik saat estimasi durasi pindah dari jumlah
    // KATA ke jumlah SUKU KATA. Nilai lama memuat tiga scene yang kebetulan
    // sama persis (216, 216, 216) — tanda bahwa hitungan kata tidak bisa
    // membedakan narasi yang panjang ucapannya berbeda. Nilai baru semuanya
    // berbeda karena mengukur apa yang benar-benar diucapkan.
    expect(layout.sceneFrames).toEqual([150, 244, 223, 286, 229, 255, 244, 135]);
    expect(layout.totalFrames).toBe(1647);
    expect(layout.totalFrames / FPS).toBeCloseTo(54.9, 1);
  });
});

describe("activeSceneIndex", () => {
  it("switches at the transition midpoint", () => {
    const plan = parseScenePlan({
      version: 2,
      projectId: "p",
      meta: { title: "T" },
      scenes: [
        { id: "a", duration: 3, clips: [{ id: "a-k1", type: "solid" }] },
        { id: "b", duration: 3, clips: [{ id: "b-k1", type: "solid" }] },
      ],
    });
    const layout = computeFrameLayout(plan);
    const cut = (layout.sceneStarts[1] ?? 0) + TRANSITION_FRAMES / 2;
    expect(activeSceneIndex(layout, 0)).toBe(0);
    expect(activeSceneIndex(layout, cut - 1)).toBe(0);
    expect(activeSceneIndex(layout, cut)).toBe(1);
    expect(activeSceneIndex(layout, layout.totalFrames - 1)).toBe(1);
  });
});

describe("aspectMetrics", () => {
  const aspects: AspectRatio[] = ["9:16", "16:9", "1:1"];

  it.each(aspects)("%s matches core dimensions", (aspect) => {
    const metrics = aspectMetrics(aspect);
    expect({ width: metrics.width, height: metrics.height }).toEqual(DIMENSIONS[aspect]);
  });

  it.each(aspects)(
    "%s respects video-layout minimums (safe area, text sizes)",
    (aspect) => {
      const metrics = aspectMetrics(aspect);
      const widthScale = metrics.width / 1080;
      // Remotion video-layout guidance: ≥80px sides, ≥44px supporting text,
      // ≥84px headline at 1080w — scaled by width.
      expect(metrics.marginX).toBeGreaterThanOrEqual(80 * widthScale);
      expect(metrics.captionFontSize).toBeGreaterThanOrEqual(44 * widthScale * 0.5);
      expect(metrics.titleFontSize).toBeGreaterThanOrEqual(84);
      // Captions must sit inside the frame with breathing room.
      expect(metrics.captionBottom).toBeGreaterThan(metrics.height * 0.05);
      expect(metrics.captionMaxWidth).toBeLessThanOrEqual(
        metrics.width - 2 * (metrics.marginX * 0.5),
      );
    },
  );
});
