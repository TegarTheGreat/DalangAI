import { describe, expect, it } from "vitest";
import {
  applyPatch,
  GRAPHIC_ANCHORS,
  GRAPHIC_ANIMS,
  type Graphic,
  parseScenePlan,
  type SfxCue,
} from "../src";

/**
 * ADR-0018: grafis tempelan (ikon/stiker) dan cue efek suara. Yang diuji
 * bukan tampilannya, melainkan kontraknya: default masuk akal, batas ditegakkan,
 * dan setiap perubahan bisa dibatalkan utuh seperti patch lain.
 */

const plan = (over: Record<string, unknown> = {}) =>
  parseScenePlan({
    version: 1,
    projectId: "uji-0018",
    meta: { title: "Uji Grafis" },
    scenes: [
      { id: "a", narration: "Satu.", visual: { type: "solid" }, duration: 5 },
      { id: "b", narration: "Dua.", visual: { type: "solid" }, duration: 5 },
    ],
    ...over,
  });

const graphic = (over: Partial<Graphic> = {}) => ({
  id: "g1",
  ref: "iconify:mdi:home",
  ...over,
});

describe("grafis tempelan", () => {
  it("default masuk akal tanpa perlu ditulis", () => {
    const p = plan({
      scenes: [
        {
          id: "a",
          narration: "Satu.",
          visual: { type: "solid" },
          duration: 5,
          graphics: [graphic()],
        },
      ],
    });
    expect(p.scenes[0]?.graphics[0]).toEqual({
      id: "g1",
      ref: "iconify:mdi:home",
      anchor: "kanan-bawah",
      size: 0.12,
      offsetX: 0,
      offsetY: 0,
      rotate: 0,
      opacity: 1,
      color: null,
      anim: "pop",
      startFrac: 0,
      endFrac: 1,
    });
  });

  it("jangkar dan animasi hanya menerima nilai yang dikenal", () => {
    expect(GRAPHIC_ANCHORS).toContain("kanan-bawah");
    expect(GRAPHIC_ANIMS).toContain("denyut");
    expect(() =>
      plan({
        scenes: [
          {
            id: "a",
            narration: "x",
            visual: { type: "solid" },
            duration: 5,
            graphics: [graphic({ anchor: "entah" as never })],
          },
        ],
      }),
    ).toThrow();
  });

  it("ukuran di luar batas ditolak (grafis tidak boleh menelan frame)", () => {
    for (const size of [0.001, 0.9]) {
      expect(() =>
        plan({
          scenes: [
            {
              id: "a",
              narration: "x",
              visual: { type: "solid" },
              duration: 5,
              graphics: [graphic({ size })],
            },
          ],
        }),
      ).toThrow();
    }
  });

  it("maksimal 4 grafis per scene", () => {
    const five = Array.from({ length: 5 }, (_, i) => graphic({ id: `g${i}` }));
    expect(() =>
      plan({
        scenes: [
          {
            id: "a",
            narration: "x",
            visual: { type: "solid" },
            duration: 5,
            graphics: five,
          },
        ],
      }),
    ).toThrow();
  });

  it("patch grafis bisa dibatalkan utuh", () => {
    const before = plan();
    const { plan: after, applied } = applyPatch(
      before,
      [
        {
          op: "updateScene",
          id: "a",
          patch: { graphics: [graphic({ anchor: "kiri-atas", size: 0.2 })] },
        },
      ],
      { origin: "user" },
    );
    expect(after.scenes[0]?.graphics).toHaveLength(1);
    expect(after.scenes[0]?.graphics[0]?.anchor).toBe("kiri-atas");

    const { plan: back } = applyPatch(after, applied.inverse, { origin: "user" });
    expect(back).toEqual(before);
  });
});

describe("cue efek suara", () => {
  const cue = (over: Partial<SfxCue> = {}) => ({
    id: "s1",
    assetId: "pustaka:whoosh",
    sceneId: "a",
    ...over,
  });

  it("default: mulai di awal scene, volume sedang", () => {
    const p = plan({ audio: { sfx: [cue()] } });
    expect(p.audio.sfx[0]).toEqual({
      id: "s1",
      assetId: "pustaka:whoosh",
      sceneId: "a",
      atSec: 0,
      volume: 0.6,
    });
  });

  it("waktu negatif ditolak", () => {
    expect(() => plan({ audio: { sfx: [cue({ atSec: -1 })] } })).toThrow();
  });

  it("patch sfx bisa dibatalkan utuh", () => {
    const before = plan();
    const { plan: after, applied } = applyPatch(
      before,
      [{ op: "setAudio", patch: { sfx: [cue({ atSec: 1.5, volume: 0.3 })] } }],
      { origin: "agent" },
    );
    expect(after.audio.sfx[0]?.atSec).toBe(1.5);

    const { plan: back } = applyPatch(after, applied.inverse, { origin: "agent" });
    expect(back).toEqual(before);
  });

  it("cue ditambatkan ke scene, bukan garis waktu mutlak", () => {
    // Kontrak ini yang membuat cue ikut bergeser saat scene dipindah.
    const p = plan({ audio: { sfx: [cue({ sceneId: "b", atSec: 2 })] } });
    expect(p.audio.sfx[0]?.sceneId).toBe("b");
  });
});

describe("lumbung berkas terpisah di renderState", () => {
  it("grafis dan sfx punya petanya sendiri, tidak menumpang resolvedAssets", () => {
    const p = plan();
    expect(p.renderState.graphicAssets).toEqual({});
    expect(p.renderState.sfxAssets).toEqual({});
    // resolvedAssets tetap dikunci per SCENE; dua peta baru dikunci per
    // grafis/cue, sehingga satu scene bisa punya banyak tempelan.
    expect(p.renderState.resolvedAssets).toEqual({});
  });
});
