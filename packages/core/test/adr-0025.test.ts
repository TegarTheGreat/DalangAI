import { describe, expect, it } from "vitest";
import {
  applyPatch,
  assignLayerAsset,
  critiquePlan,
  layerRect,
  MAX_LAYERS,
  orphanMediaAssetIds,
  PatchError,
  parseScenePlan,
  placeLayer,
  type ScenePlan,
  setLayerAsset,
  uniqueLayerId,
  videoLayerSchema,
} from "../src";

/**
 * ADR-0025: lapisan video (B-roll / PiP / sisipan).
 *
 * Yang diuji bukan tampilannya, melainkan kontraknya: default masuk akal,
 * batas ditegakkan, id tidak boleh kembar se-plan, dan tiap perubahan bisa
 * dibatalkan utuh seperti patch lain.
 */

const asset = {
  file: "assets/broll.mp4",
  kind: "video" as const,
  source: "pexels",
  license: "Pexels License",
};

const plan = (layers: unknown[] = []): ScenePlan =>
  parseScenePlan({
    version: 1,
    projectId: "uji-0025",
    meta: { title: "Uji Lapisan" },
    scenes: [
      { id: "a", narration: "Satu.", visual: { type: "solid" }, duration: 5, layers },
      { id: "b", narration: "Dua.", visual: { type: "solid" }, duration: 5 },
    ],
  });

describe("skema lapisan", () => {
  it("default lapisan aman: bisu, kanan-bawah, tampil penuh, tanpa bingkai", () => {
    const layer = videoLayerSchema.parse({ id: "l1", visual: { type: "stock" } });
    expect(layer).toMatchObject({
      anchor: "kanan-bawah",
      width: 0.34,
      height: 0.34,
      shape: "persegi",
      border: 0,
      opacity: 1,
      fit: "cover",
      entrance: "fade",
      startFrac: 0,
      endFrac: 1,
    });
    // Bawaan bisu: seluruh perilaku sebelum ADR ini tidak berubah.
    // (ADR-0026 mengganti angka gain tunggal ini dengan amplop penuh.)
    expect(layer.visual.audio.volume).toBe(0);
  });

  /**
   * `variant` dan tipe latar dibuang dari visual lapisan dengan sengaja.
   * Keduanya adalah LATAR — sebagai sisipan mereka cuma jadi kotak yang
   * menutupi videonya sendiri.
   */
  it("visual lapisan menolak variant, solid, dan template-anim", () => {
    for (const bad of [
      { type: "stock", variant: "title" },
      { type: "solid" },
      { type: "template-anim" },
    ]) {
      expect(videoLayerSchema.safeParse({ id: "l1", visual: bad }).success).toBe(false);
    }
  });

  it("scene menolak lebih dari batas lapisan", () => {
    const many = Array.from({ length: MAX_LAYERS + 1 }, (_, index) => ({
      id: `l${index}`,
      visual: { type: "stock" },
    }));
    expect(() => plan(many)).toThrow();
  });

  /**
   * Id lapisan mengunci BERKAS di renderState. Dua lapisan bernama sama di
   * scene berbeda karenanya akan berbagi satu berkas — dan menghapus salah
   * satunya mencabut berkas milik yang lain. Pelajaran yang sama dengan
   * id grafis/cue di ADR-0018, dan kali ini dijaga skema.
   */
  it("id lapisan kembar ditolak walau di scene berbeda", () => {
    expect(() =>
      parseScenePlan({
        version: 1,
        projectId: "uji-0025",
        meta: { title: "Uji" },
        scenes: [
          {
            id: "a",
            visual: { type: "solid" },
            duration: 5,
            layers: [{ id: "sama", visual: { type: "stock" } }],
          },
          {
            id: "b",
            visual: { type: "solid" },
            duration: 5,
            layers: [{ id: "sama", visual: { type: "stock" } }],
          },
        ],
      }),
    ).toThrow(/dipakai lebih dari sekali/);
  });

  it("uniqueLayerId menghindari id yang dipakai plan MAUPUN renderState", () => {
    const base = setLayerAsset(
      plan([{ id: "lap-a", visual: { type: "stock" } }]),
      "lap-b",
      asset,
    );
    expect(uniqueLayerId(base, "lap a")).toBe("lap-a-2");
    expect(uniqueLayerId(base, "lap b")).toBe("lap-b-2");
  });
});

describe("patch op lapisan", () => {
  it("updateScene mengganti larik lapisan dan inversnya mengembalikannya utuh", () => {
    const before = plan();
    const result = applyPatch(
      before,
      [
        {
          op: "updateScene",
          id: "a",
          patch: {
            layers: [{ id: "lap-1", visual: { type: "stock", query: "rain" } }],
          },
        },
      ],
      { origin: "user" },
    );
    expect(result.plan.scenes[0]?.layers).toHaveLength(1);
    const back = applyPatch(result.plan, result.applied.inverse, {
      origin: "user",
      enforce: false,
    });
    expect(back.plan).toEqual(before);
  });

  /**
   * `replaceAsset` dipakai ULANG untuk lapisan alih-alih op baru: keduanya
   * menjawab pertanyaan yang sama ("aset mana yang dipakai di sini"), dan op
   * kedua berarti aturan pin/lock hidup di dua tempat yang harus tetap seragam.
   */
  it("replaceAsset dengan layerId menyasar lapisan, bukan visual dasar", () => {
    const start = plan([{ id: "lap-1", visual: { type: "stock" } }]);
    const result = applyPatch(
      start,
      [
        {
          op: "replaceAsset",
          sceneId: "a",
          layerId: "lap-1",
          assetId: "pexels:99",
        },
      ],
      { origin: "user" },
    );
    expect(result.plan.scenes[0]?.layers[0]?.visual.assetId).toBe("pexels:99");
    expect(result.plan.scenes[0]?.layers[0]?.visual.pinned).toBe(true);
    // Visual dasar tidak tersentuh.
    expect(result.plan.scenes[0]?.visual.assetId).toBeNull();

    const back = applyPatch(result.plan, result.applied.inverse, { origin: "user" });
    expect(back.plan.scenes[0]?.layers[0]?.visual.assetId).toBeNull();
    expect(back.plan.scenes[0]?.layers[0]?.visual.pinned).toBe(false);
  });

  it("replaceAsset ke lapisan yang tidak ada gagal dengan kode yang jelas", () => {
    try {
      applyPatch(
        plan(),
        [{ op: "replaceAsset", sceneId: "a", layerId: "hantu", assetId: "x" }],
        { origin: "user" },
      );
      expect.unreachable("seharusnya melempar");
    } catch (error) {
      expect(error).toBeInstanceOf(PatchError);
      expect((error as PatchError).code).toBe("LAYER_NOT_FOUND");
    }
  });

  it("scene terkunci menolak lapisan dari agent", () => {
    const locked = applyPatch(plan(), [{ op: "lockScene", id: "a", locked: true }], {
      origin: "user",
    }).plan;
    expect(() =>
      applyPatch(locked, [{ op: "updateScene", id: "a", patch: { layers: [] } }], {
        origin: "agent",
      }),
    ).toThrow();
  });
});

describe("renderState lapisan", () => {
  it("assignLayerAsset mengisi assetId dan berkasnya tanpa mem-pin", () => {
    const next = assignLayerAsset(
      plan([{ id: "lap-1", visual: { type: "stock" } }]),
      "a",
      "lap-1",
      "pexels:1",
      asset,
    );
    expect(next.scenes[0]?.layers[0]?.visual.assetId).toBe("pexels:1");
    expect(next.scenes[0]?.layers[0]?.visual.pinned).toBe(false);
    expect(next.renderState.layerAssets["lap-1"]?.file).toBe(asset.file);
  });

  it("assignLayerAsset menolak lapisan ter-pin — pilihan eksplisit tidak ditimpa", () => {
    const pinned = plan([
      { id: "lap-1", visual: { type: "stock", assetId: "milikku", pinned: true } },
    ]);
    expect(() => assignLayerAsset(pinned, "a", "lap-1", "lain", asset)).toThrow(
      /ter-pin/,
    );
  });

  /**
   * Entri yatim sengaja TIDAK dihapus saat lapisannya dibuang: undo yang
   * mengembalikan lapisan itu harus mengembalikan berkasnya juga. Yang
   * dibutuhkan pemanggil hanya "jangan ikut dipentaskan".
   */
  it("lapisan yang dihapus meninggalkan entri yatim yang dilaporkan, bukan dihapus", () => {
    const withLayer = setLayerAsset(
      plan([{ id: "lap-1", visual: { type: "stock" } }]),
      "lap-1",
      asset,
    );
    const removed = applyPatch(
      withLayer,
      [{ op: "updateScene", id: "a", patch: { layers: [] } }],
      { origin: "user" },
    ).plan;
    expect(removed.renderState.layerAssets["lap-1"]).toBeDefined();
    expect(orphanMediaAssetIds(removed).layers).toEqual(["lap-1"]);
  });
});

describe("geometri kanvas lapisan", () => {
  const safe = { x: 0.06, y: 0.08 };

  it("layerRect menempelkan tepi ke margin aman, bukan ke tepi bingkai", () => {
    const box = {
      anchor: "kiri-atas" as const,
      width: 0.3,
      height: 0.2,
      offsetX: 0,
      offsetY: 0,
    };
    expect(layerRect(box, safe)).toEqual({ x: 0.06, y: 0.08, width: 0.3, height: 0.2 });
    const kanan = layerRect({ ...box, anchor: "kanan-bawah" }, safe);
    expect(kanan.x).toBeCloseTo(1 - 0.06 - 0.3, 4);
    expect(kanan.y).toBeCloseTo(1 - 0.08 - 0.2, 4);
  });

  /**
   * `placeLayer` harus PERSIS kebalikan `layerRect`. Kalau tidak, melepas
   * seretan tanpa memindahkan apa pun akan menggeser kotaknya — cacat yang
   * tidak terlihat di kode, hanya di tangan.
   */
  it("placeLayer adalah kebalikan layerRect: menaruh di tempatnya sendiri = nol geseran", () => {
    for (const anchor of ["kiri-atas", "tengah", "kanan-bawah"] as const) {
      const rect = layerRect(
        { anchor, width: 0.3, height: 0.25, offsetX: 0, offsetY: 0 },
        safe,
      );
      const back = placeLayer(rect, safe);
      expect(back.anchor).toBe(anchor);
      expect(back.offsetX).toBeCloseTo(0, 3);
      expect(back.offsetY).toBeCloseTo(0, 3);
    }
  });

  it("placeLayer memilih ULANG jangkar terdekat, jadi geseran tidak pernah menabrak batas", () => {
    // Kotak kecil di pojok kiri-atas, tapi dijangkarkan kanan-bawah sebelumnya.
    const placement = placeLayer({ x: 0.05, y: 0.06, width: 0.2, height: 0.2 }, safe);
    expect(placement.anchor).toBe("kiri-atas");
    expect(Math.abs(placement.offsetX)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(placement.offsetY)).toBeLessThanOrEqual(0.5);
  });
});

describe("kritik lapisan", () => {
  it("lapisan tanpa berkas jadi PERHATIAN, bukan saran", () => {
    const note = critiquePlan(plan([{ id: "lap-1", visual: { type: "stock" } }])).find(
      (entry) => entry.code === "lapisan-tanpa-aset",
    );
    expect(note?.level).toBe("perhatian");
    expect(note?.sceneId).toBe("a");
  });

  it("lapisan sepanjang scene ditegur; yang berjendela tidak", () => {
    const penuh = setLayerAsset(
      plan([{ id: "lap-1", visual: { type: "stock" }, startFrac: 0, endFrac: 1 }]),
      "lap-1",
      asset,
    );
    expect(critiquePlan(penuh).map((n) => n.code)).toContain("lapisan-sepanjang-scene");

    const berjendela = setLayerAsset(
      plan([{ id: "lap-1", visual: { type: "stock" }, startFrac: 0.2, endFrac: 0.7 }]),
      "lap-1",
      asset,
    );
    expect(critiquePlan(berjendela).map((n) => n.code)).not.toContain(
      "lapisan-sepanjang-scene",
    );
  });
});
