import { parseScenePlan } from "@dalang/core";
import { describe, expect, it } from "vitest";
import { planMeta } from "../src/app/model/plan-meta";
import {
  CLIP_GAP_PX,
  clipBoxes,
  filmstripFrames,
  frameToX,
  rulerTicks,
  timelineWidth,
  xToFrame,
} from "../src/app/model/timeline-scale";
import { makePlan } from "./helpers";

describe("timeline-scale (pemetaan frame <-> piksel)", () => {
  const meta = planMeta(parseScenePlan(makePlan()));
  const boxes = clipBoxes(meta, 24);

  it("lebar klip sebanding durasi (dengan lantai minimum) dan berurutan", () => {
    expect(boxes).toHaveLength(3);
    boxes.forEach((box, index) => {
      const expected = Math.max(
        56,
        Math.round((meta.sceneFrames[index]! / meta.fps) * 24),
      );
      expect(box.w).toBe(expected);
      if (index > 0) {
        expect(box.x).toBe(boxes[index - 1]!.x + boxes[index - 1]!.w + CLIP_GAP_PX);
      }
    });
    expect(timelineWidth(boxes)).toBe(boxes[2]!.x + boxes[2]!.w);
  });

  it("frameToX monoton dan roundtrip xToFrame akurat", () => {
    let lastX = -1;
    for (let frame = 0; frame < meta.durationInFrames; frame += 7) {
      const x = frameToX(frame, meta, boxes);
      expect(x).toBeGreaterThanOrEqual(lastX);
      lastX = x;
      const roundtrip = xToFrame(x, meta, boxes);
      // piecewise-linear: kesalahan roundtrip maksimal ~1 frame per piksel
      expect(Math.abs(roundtrip - frame)).toBeLessThanOrEqual(
        Math.ceil(meta.fps / 24) + 1,
      );
    }
  });

  it("xToFrame menjepit ke [0, durasi-1] di luar kanvas", () => {
    expect(xToFrame(-50, meta, boxes)).toBe(0);
    expect(xToFrame(timelineWidth(boxes) + 500, meta, boxes)).toBe(
      meta.durationInFrames - 1,
    );
  });

  it("filmstripFrames berada di dalam scene dan menaik", () => {
    const frames = filmstripFrames(meta, 1, 4);
    expect(frames).toHaveLength(4);
    const start = meta.sceneStarts[1]!;
    const end = start + meta.sceneFrames[1]!;
    frames.forEach((frame, i) => {
      expect(frame).toBeGreaterThanOrEqual(start);
      expect(frame).toBeLessThan(end);
      if (i > 0) expect(frame).toBeGreaterThan(frames[i - 1]!);
    });
  });

  it("rulerTicks: tick per detik, label tiap 5 detik, posisi monoton", () => {
    const ticks = rulerTicks(meta, boxes);
    expect(ticks[0]).toMatchObject({ sec: 0, label: true });
    expect(ticks.filter((tick) => tick.label).every((tick) => tick.sec % 5 === 0)).toBe(
      true,
    );
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]!.x).toBeGreaterThan(ticks[i - 1]!.x);
    }
  });
});
