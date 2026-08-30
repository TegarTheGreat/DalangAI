import { describe, expect, it } from "vitest";
import { applyPatch, parseScenePlan } from "../src";

const plan = (visual: Record<string, unknown>) =>
  parseScenePlan({
    version: 1,
    projectId: "uji-0015",
    meta: { title: "Uji 0015" },
    scenes: [{ id: "sc-1", narration: "", visual, duration: 4 }],
  });

describe("ADR-0015: motion baru, blur, speed, flipH, fokus", () => {
  it("default kompatibel: plan lama mendapat nilai netral", () => {
    const v = plan({ type: "stock", query: "a" }).scenes[0]?.visual;
    expect(v).toMatchObject({ speed: 1, flipH: false, focusX: 0.5, focusY: 0.5 });
  });

  it("motion pan-up/pan-down/drift sah; blur ikut filter", () => {
    const v = plan({
      type: "stock",
      query: "a",
      motion: "drift",
      filter: { blur: 8 },
      speed: 2,
      flipH: true,
      focusX: 0.2,
      focusY: 0.8,
    }).scenes[0]?.visual;
    expect(v?.motion).toBe("drift");
    expect(v?.filter?.blur).toBe(8);
    expect(v?.speed).toBe(2);
    expect(v?.flipH).toBe(true);
  });

  it("di luar rentang ditolak (speed 8, blur 30)", () => {
    expect(() => plan({ type: "stock", speed: 8 })).toThrow();
    expect(() => plan({ type: "stock", filter: { blur: 30 } })).toThrow();
  });

  it("patch + inverse bolak-balik utuh untuk field baru", () => {
    const before = plan({ type: "stock", query: "a" });
    const { plan: after, applied } = applyPatch(
      before,
      [
        {
          op: "updateScene",
          id: "sc-1",
          patch: { visual: { motion: "pan-up", speed: 0.5, flipH: true } },
        },
      ],
      { origin: "user" },
    );
    expect(after.scenes[0]?.visual).toMatchObject({
      motion: "pan-up",
      speed: 0.5,
      flipH: true,
    });
    const { plan: reverted } = applyPatch(after, applied.inverse, { origin: "user" });
    expect(reverted).toEqual(before);
  });
});
