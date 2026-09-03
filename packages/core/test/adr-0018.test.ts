import { describe, expect, it } from "vitest";
import {
  applyPatch,
  GRAPHIC_ANCHORS,
  GRAPHIC_ANIMS,
  type Graphic,
  idSlug,
  orphanMediaAssetIds,
  parseScenePlan,
  type SfxCue,
  setGraphicAsset,
  setSfxAsset,
  uniqueGraphicId,
  uniqueSfxCueId,
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
      {
        id: "a",
        narration: "Satu.",
        clips: [{ id: "a-k1", type: "solid" }],
        duration: 5,
      },
      { id: "b", narration: "Dua.", clips: [{ id: "b-k1", type: "solid" }], duration: 5 },
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
          clips: [{ id: "a-k1", type: "solid" }],
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
      // ADR-0027: grafis baru lahir TANPA keyframe — geraknya sepenuhnya dari
      // preset `anim` sampai seseorang memutuskan lain.
      tracks: [],
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
            clips: [{ id: "a-k1", type: "solid" }],
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
              clips: [{ id: "a-k1", type: "solid" }],
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
            clips: [{ id: "a-k1", type: "solid" }],
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
  it("grafis dan sfx punya petanya sendiri, tidak menumpang clipAssets", () => {
    const p = plan();
    expect(p.renderState.graphicAssets).toEqual({});
    expect(p.renderState.sfxAssets).toEqual({});
    // clipAssets tetap dikunci per SCENE; dua peta baru dikunci per
    // grafis/cue, sehingga satu scene bisa punya banyak tempelan.
    expect(p.renderState.clipAssets).toEqual({});
  });
});

describe("id media unik se-plan", () => {
  const withGraphic = () => {
    const base = plan({
      scenes: [
        {
          id: "a",
          clips: [{ id: "a-k1", type: "solid" }],
          duration: 5,
          graphics: [graphic({ id: "ikon-mdi-home" })],
        },
        { id: "b", clips: [{ id: "b-k1", type: "solid" }], duration: 5 },
      ],
    });
    return setGraphicAsset(base, "ikon-mdi-home", {
      file: "assets/icons/mdi-home.svg",
      kind: "image",
      source: "iconify",
      license: "MIT",
    });
  };

  it("id yang belum terpakai dikembalikan apa adanya", () => {
    expect(uniqueGraphicId(withGraphic(), "ikon-mdi-map")).toBe("ikon-mdi-map");
  });

  /**
   * Inti masalahnya: renderState.graphicAssets dikunci per id untuk SELURUH
   * plan, jadi scene kedua yang memasang ikon yang sama tidak boleh memakai id
   * yang sama — entri berkasnya akan saling menimpa.
   */
  it("id yang sudah dipakai scene lain diberi nomor", () => {
    expect(uniqueGraphicId(withGraphic(), "ikon-mdi-home")).toBe("ikon-mdi-home-2");
  });

  it("entri renderState yatim pun dihitung sebagai terpakai", () => {
    // Grafisnya sudah dihapus dari scene, entri berkasnya sengaja ditinggal
    // (supaya undo mengembalikannya utuh) — id itu tetap tidak boleh dipakai ulang.
    const base = setGraphicAsset(plan(), "ikon-mdi-home", {
      file: "assets/icons/mdi-home.svg",
      kind: "image",
      source: "iconify",
      license: "MIT",
    });
    expect(uniqueGraphicId(base, "ikon-mdi-home")).toBe("ikon-mdi-home-2");
  });

  it("cue efek suara memakai aturan yang sama", () => {
    const base = setSfxAsset(plan(), "sfx-a", {
      file: "assets/sfx/sfx-a.mp3",
      kind: "audio",
      source: "openverse",
      license: "cc0",
    });
    expect(uniqueSfxCueId(base, "sfx-a")).toBe("sfx-a-2");
    expect(uniqueSfxCueId(base, "sfx-b")).toBe("sfx-b");
  });

  it("slug membersihkan karakter yang tidak sah untuk nama berkas", () => {
    expect(idSlug("iconify:mdi:home")).toBe("iconify-mdi-home");
    expect(idSlug("  ../etc/passwd  ")).toBe("etc-passwd");
    expect(idSlug("###")).toBe("aset");
  });
});

describe("aset media yatim", () => {
  const populated = () => {
    let base = plan({
      scenes: [
        {
          id: "a",
          clips: [{ id: "a-k1", type: "solid" }],
          duration: 5,
          graphics: [graphic({ id: "hidup" })],
        },
        { id: "b", clips: [{ id: "b-k1", type: "solid" }], duration: 5 },
      ],
      audio: {
        voice: { provider: "silence", voiceId: "x", speed: 1 },
        sfx: [{ id: "cue-hidup", assetId: "openverse:1", sceneId: "a", atSec: 0 }],
      },
    });
    for (const id of ["hidup", "yatim"]) {
      base = setGraphicAsset(base, id, {
        file: `assets/icons/${id}.svg`,
        kind: "image",
        source: "iconify",
        license: "MIT",
      });
    }
    for (const id of ["cue-hidup", "cue-yatim"]) {
      base = setSfxAsset(base, id, {
        file: `assets/sfx/${id}.mp3`,
        kind: "audio",
        source: "openverse",
        license: "cc0",
      });
    }
    return base;
  };

  it("hanya entri yang tidak dirujuk lagi yang dilaporkan", () => {
    expect(orphanMediaAssetIds(populated())).toEqual({
      graphics: ["yatim"],
      layers: [],
      sfx: ["cue-yatim"],
      tracks: [],
    });
  });

  /**
   * Kuerinya TIDAK boleh memutasi plan: menghapus entri yatim saat grafisnya
   * dibuang akan merusak undo — patch yang mengembalikan grafis itu tidak
   * mengembalikan berkasnya, sehingga render jadi 404 pada aksi yang justru
   * bermaksud membatalkan penghapusan.
   */
  it("tidak mengubah plan yang diperiksanya", () => {
    const base = populated();
    const before = structuredClone(base);
    orphanMediaAssetIds(base);
    expect(base).toEqual(before);
  });
});
