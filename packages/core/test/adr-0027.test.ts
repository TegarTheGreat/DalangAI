import { describe, expect, it } from "vitest";
import {
  ANIMATABLE_RANGE,
  applyPatch,
  clearTrack,
  graphicSchema,
  type KeyframeTrack,
  MAX_KEYFRAMES_PER_TRACK,
  parseScenePlan,
  removeKeyframe,
  type ScenePlan,
  setKeyframe,
  trackOf,
  videoLayerSchema,
} from "../src";

/**
 * ADR-0027: keyframe sembarang untuk properti.
 *
 * Yang diuji kontraknya: properti tertutup, nilai dijepit rentang yang SAMA
 * dengan properti statisnya, waktu menaik, dan hasil tiap penyuntingan tetap
 * SAH menurut skema. Yang terakhir itu yang paling mudah terlewat — helper
 * yang menghasilkan track satu titik akan membuat plan gagal di-parse pada
 * klik berikutnya, jauh dari tempat kesalahannya.
 */

const graphic = (over: Record<string, unknown> = {}) =>
  graphicSchema.parse({ id: "g1", ref: "iconify:mdi:home", ...over });

const dengan = (points: { at: number; value: number }[]): KeyframeTrack[] =>
  graphic({ tracks: [{ property: "offsetX", points }] }).tracks;

describe("rentang keyframe = rentang properti statis", () => {
  /**
   * Satu bentuk data tidak boleh punya dua batas. Kalau keyframe boleh
   * membawa `size` ke 5,0 sementara nilai statisnya ditolak di atas 0,6,
   * maka penjagaan statisnya cuma hiasan.
   */
  it("tiap properti animatable punya rentang, dan skema menegakkannya", () => {
    for (const range of Object.values(ANIMATABLE_RANGE)) {
      expect(range[0]).toBeLessThan(range[1]);
    }
    expect(() =>
      graphic({
        tracks: [
          {
            property: "size",
            points: [
              { at: 0, value: 0.1 },
              { at: 1, value: 5 },
            ],
          },
        ],
      }),
    ).toThrow(/di luar rentang size/);
  });

  it("properti yang tidak boleh di elemen ini ditolak", () => {
    // `width` milik lapisan, bukan grafis: grafis persegi, ukurannya satu angka.
    expect(() =>
      graphic({
        tracks: [
          {
            property: "width",
            points: [
              { at: 0, value: 0.2 },
              { at: 1, value: 0.5 },
            ],
          },
        ],
      }),
    ).toThrow(/tidak bisa dianimasikan pada elemen ini/);
    // Di lapisan, properti yang sama diterima.
    expect(() =>
      videoLayerSchema.parse({
        id: "lap-1",
        visual: { type: "stock" },
        tracks: [
          {
            property: "width",
            points: [
              { at: 0, value: 0.2 },
              { at: 1, value: 0.5 },
            ],
          },
        ],
      }),
    ).not.toThrow();
  });

  it("waktu harus menaik dan minimal dua titik", () => {
    expect(() =>
      dengan([
        { at: 0.8, value: 0 },
        { at: 0.2, value: 0.1 },
      ]),
    ).toThrow(/harus menaik/);
    expect(() => dengan([{ at: 0, value: 0 }])).toThrow();
  });
});

describe("setKeyframe", () => {
  it("track pertama lahir dengan dua titik dan benar-benar bergerak", () => {
    // Titik pasangan ditaruh di ujung TERJAUH: track yang sah tapi diam
    // membuat orang mengira fiturnya rusak.
    const tracks = setKeyframe([], "offsetX", 0, 0.3, { current: 0 });
    const track = trackOf(tracks, "offsetX");
    expect(track?.points).toHaveLength(2);
    expect(track?.points[0]?.at).toBe(0);
    expect(track?.points[1]?.at).toBe(1);
    expect(track?.points[0]?.value).toBe(0.3);
  });

  it("keyframe pada waktu yang sudah ada MENGGANTI, bukan menumpuk", () => {
    const awal = setKeyframe([], "opacity", 0, 1, { current: 1 });
    const ganti = setKeyframe(awal, "opacity", 0, 0.4);
    const track = trackOf(ganti, "opacity");
    expect(track?.points).toHaveLength(2);
    expect(track?.points[0]?.value).toBe(0.4);
  });

  it("titik selalu tersimpan urut waktu", () => {
    let tracks = setKeyframe([], "opacity", 0, 0, { current: 0 });
    tracks = setKeyframe(tracks, "opacity", 0.5, 1);
    tracks = setKeyframe(tracks, "opacity", 0.25, 0.5);
    const at = trackOf(tracks, "opacity")?.points.map((p) => p.at) ?? [];
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it("nilai di luar rentang DIJEPIT, bukan ditolak diam-diam", () => {
    const tracks = setKeyframe([], "opacity", 0, 5, { current: 1 });
    expect(trackOf(tracks, "opacity")?.points[0]?.value).toBe(1);
  });

  it("tidak pernah melewati batas jumlah titik", () => {
    let tracks = setKeyframe([], "opacity", 0, 0, { current: 0 });
    for (let i = 1; i <= 20; i++) tracks = setKeyframe(tracks, "opacity", i / 21, 0.5);
    expect(trackOf(tracks, "opacity")?.points.length).toBeLessThanOrEqual(
      MAX_KEYFRAMES_PER_TRACK,
    );
  });

  /**
   * Aturan penutup: apa pun urutan penyuntingannya, hasilnya harus tetap bisa
   * di-parse. Helper yang menghasilkan bentuk tidak sah akan meledak jauh dari
   * tempat kesalahannya — pada klik berikutnya, di parse plan.
   */
  it("hasil rangkaian penyuntingan apa pun tetap sah menurut skema", () => {
    let tracks = setKeyframe([], "offsetX", 0.3, 0.2, { current: 0 });
    tracks = setKeyframe(tracks, "offsetX", 0.9, -0.4);
    tracks = setKeyframe(tracks, "offsetY", 0.5, 0.1, { current: 0 });
    tracks = removeKeyframe(tracks, "offsetX", 0.3);
    expect(() => graphic({ tracks })).not.toThrow();
  });
});

describe("removeKeyframe & clearTrack", () => {
  it("track yang tinggal satu titik DIBUANG seluruhnya", () => {
    // Track satu titik tidak sah menurut skema; menyimpannya berarti plan
    // yang tidak bisa di-parse lagi setelah satu klik hapus.
    const tracks = setKeyframe([], "opacity", 0, 0, { current: 1 });
    const sisa = removeKeyframe(tracks, "opacity", 0);
    expect(sisa).toHaveLength(0);
    expect(() => graphic({ tracks: sisa })).not.toThrow();
  });

  it("clearTrack mengembalikan properti jadi statis", () => {
    const tracks = setKeyframe([], "rotate", 0, 45, { current: 0 });
    expect(clearTrack(tracks, "rotate")).toHaveLength(0);
    expect(clearTrack(tracks, "opacity")).toHaveLength(1);
  });
});

describe("track sebagai data plan biasa", () => {
  const plan = (): ScenePlan =>
    parseScenePlan({
      version: 1,
      projectId: "uji-0027",
      meta: { title: "Uji" },
      scenes: [
        {
          id: "a",
          narration: "Satu.",
          visual: { type: "solid" },
          duration: 5,
          graphics: [{ id: "g1", ref: "iconify:mdi:home" }],
        },
      ],
    });

  it("dipasang lewat patch op dan bisa dibatalkan utuh", () => {
    const awal = plan();
    const graphics = awal.scenes[0]!.graphics.map((item) => ({
      ...item,
      tracks: setKeyframe(item.tracks, "offsetX", 0, 0.25, { current: 0 }),
    }));
    const maju = applyPatch(awal, [{ op: "updateScene", id: "a", patch: { graphics } }], {
      origin: "user",
    });
    expect(maju.plan.scenes[0]?.graphics[0]?.tracks).toHaveLength(1);
    const balik = applyPatch(maju.plan, maju.applied.inverse, { origin: "user" });
    expect(balik.plan.scenes[0]?.graphics[0]?.tracks).toEqual([]);
  });
});
