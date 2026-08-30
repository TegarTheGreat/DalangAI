import { describe, expect, it } from "vitest";
import { applyPatch, parseScenePlan } from "../src/index";

/** Kontrak ADR-0011: filter, transisi, teks overlay — additive & undo-able. */

const basePlan = () =>
  parseScenePlan({
    version: 1,
    projectId: "uji-adr11",
    meta: {
      title: "Uji",
      aspectRatio: "9:16",
      language: "id",
      stylePreset: "documentary-01",
    },
    audio: {},
    scenes: [
      { id: "a", narration: "Satu.", visual: { type: "solid" } },
      { id: "b", narration: "Dua.", visual: { type: "solid" } },
    ],
    renderState: { narrationAudio: {}, resolvedAssets: {} },
  });

describe("ADR-0011: default mundur-kompatibel", () => {
  it("plan lama tanpa field baru terparse dengan default netral", () => {
    const plan = basePlan();
    expect(plan.scenes[0]?.transition).toEqual({
      type: "cross-fade",
      durationFrames: 15, // ADR-0013 menambah field ini dengan default kompatibel
    });
    expect(plan.scenes[0]?.texts).toEqual([]);
    expect(plan.scenes[0]?.visual.filter).toBeUndefined();
  });
});

describe("ADR-0011: patch ops", () => {
  it("filter bisa diset, di-undo, dan dihapus dengan null", () => {
    const plan = basePlan();
    const { plan: withFilter, applied } = applyPatch(
      plan,
      [
        {
          op: "updateScene",
          id: "a",
          patch: { visual: { filter: { preset: "warm", saturation: 1.3 } } },
        },
      ],
      { origin: "user" },
    );
    const filter = withFilter.scenes[0]?.visual.filter;
    expect(filter?.preset).toBe("warm");
    expect(filter?.saturation).toBe(1.3);
    expect(filter?.brightness).toBe(1);

    const { plan: reverted } = applyPatch(withFilter, applied.inverse, {
      origin: "user",
      enforce: false,
    });
    expect(reverted.scenes[0]?.visual.filter).toBeUndefined();

    const { plan: cleared } = applyPatch(
      withFilter,
      [{ op: "updateScene", id: "a", patch: { visual: { filter: null } } }],
      { origin: "user" },
    );
    expect(cleared.scenes[0]?.visual.filter).toBeUndefined();
  });

  it("transition dan texts bisa diubah + inverse mengembalikan nilai lama", () => {
    const plan = basePlan();
    const { plan: next, applied } = applyPatch(
      plan,
      [
        {
          op: "updateScene",
          id: "b",
          patch: {
            transition: { type: "slide-left" },
            texts: [
              { id: "t1", content: "Judul Besar", role: "headline", position: "top" },
            ],
          },
        },
      ],
      { origin: "agent" },
    );
    expect(next.scenes[1]?.transition.type).toBe("slide-left");
    expect(next.scenes[1]?.texts[0]?.content).toBe("Judul Besar");
    expect(next.scenes[1]?.texts[0]?.endFrac).toBe(1);

    const { plan: back } = applyPatch(next, applied.inverse, {
      origin: "agent",
      enforce: false,
    });
    expect(back.scenes[1]?.transition.type).toBe("cross-fade");
    expect(back.scenes[1]?.texts).toEqual([]);
  });

  it("scene terkunci tetap menolak perubahan field baru dari agent", () => {
    const plan = parseScenePlan({
      ...basePlan(),
      scenes: basePlan().scenes.map((scene) =>
        scene.id === "a" ? { ...scene, locked: true } : scene,
      ),
    });
    expect(() =>
      applyPatch(
        plan,
        [{ op: "updateScene", id: "a", patch: { transition: { type: "none" } } }],
        { origin: "agent" },
      ),
    ).toThrow(/terkunci/);
  });

  it("teks overlay maksimal 3 ditegakkan skema", () => {
    const plan = basePlan();
    const texts = [1, 2, 3, 4].map((n) => ({ id: `t${n}`, content: `Teks ${n}` }));
    expect(() =>
      applyPatch(plan, [{ op: "updateScene", id: "a", patch: { texts } }], {
        origin: "user",
      }),
    ).toThrow();
  });
});
