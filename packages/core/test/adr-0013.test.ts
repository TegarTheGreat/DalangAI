import { describe, expect, it } from "vitest";
import {
  applyPatch,
  MAX_TRANSITION_FRAMES,
  MIN_TRANSITION_FRAMES,
  parseScenePlan,
} from "../src/index";

/** ADR-0013: gaya teks (align/size/emphasis) + durasi transisi per scene. */

const basePlan = () =>
  parseScenePlan({
    version: 1,
    projectId: "adr-0013",
    meta: { title: "Uji" },
    scenes: [
      {
        id: "sc-1",
        narration: "Scene pertama.",
        clips: [{ id: "sc-1-k1", type: "solid" }],
        texts: [{ id: "tx", content: "Angka kunci" }],
      },
      {
        id: "sc-2",
        narration: "Scene kedua.",
        clips: [{ id: "sc-2-k1", type: "solid" }],
      },
    ],
  } as never);

describe("ADR-0013 — kompatibilitas mundur", () => {
  it("plan lama terparse identik: default align/size/emphasis + durationFrames 15", () => {
    const plan = basePlan();
    expect(plan.scenes[0]?.texts[0]).toMatchObject({
      align: "center",
      size: "m",
      emphasis: "none",
    });
    expect(plan.scenes[0]?.transition.durationFrames).toBe(15);
  });

  it("durationFrames di luar batas ditolak", () => {
    const raw = {
      version: 1,
      projectId: "x",
      meta: { title: "t" },
      scenes: [
        {
          id: "a",
          narration: "n",
          clips: [{ id: "a-k1", type: "solid" }],
          transition: { type: "cross-fade", durationFrames: MAX_TRANSITION_FRAMES + 1 },
        },
      ],
    };
    expect(() => parseScenePlan(raw as never)).toThrow();
    raw.scenes[0]!.transition.durationFrames = MIN_TRANSITION_FRAMES - 1;
    expect(() => parseScenePlan(raw as never)).toThrow();
  });
});

describe("ADR-0013 — patch + inverse", () => {
  it("updateScene transisi berdurasi kustom & gaya teks; undo mengembalikan", () => {
    const plan = basePlan();
    const { plan: next, applied } = applyPatch(
      plan,
      [
        {
          op: "updateScene",
          id: "sc-1",
          patch: {
            transition: { type: "wipe-right", durationFrames: 22 },
            texts: [
              {
                id: "tx",
                content: "Angka kunci",
                role: "kicker",
                position: "top",
                align: "left",
                size: "l",
                emphasis: "box",
              },
            ],
          },
        },
      ],
      { origin: "user" },
    );
    expect(next.scenes[0]?.transition).toEqual({
      type: "wipe-right",
      durationFrames: 22,
    });
    expect(next.scenes[0]?.texts[0]).toMatchObject({
      align: "left",
      size: "l",
      emphasis: "box",
    });

    const { plan: reverted } = applyPatch(next, applied.inverse, { origin: "user" });
    expect(reverted.scenes[0]?.transition.durationFrames).toBe(15);
    expect(reverted.scenes[0]?.texts[0]).toMatchObject({
      align: "center",
      size: "m",
      emphasis: "none",
    });
  });
});
