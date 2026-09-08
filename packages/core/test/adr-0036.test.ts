import { describe, expect, it } from "vitest";
import {
  ANIMATABLE_RANGE,
  CLIP_ANIMATABLE,
  clipSchema,
  critiquePlan,
  MAX_TRACKS_PER_ELEMENT,
  panBeyondCover,
  sceneUpdateSchema,
} from "../src/index";
import { makePlan } from "./fixtures";

/**
 * Keyframe kamera visual dasar scene (ADR-0036).
 *
 * Yang dijaga di sini adalah pagar-pagar yang kalau jebol menghasilkan cacat
 * yang tidak akan pernah dilacak balik ke skemanya: keyframe yang terhapus
 * oleh patch yang sama sekali tidak menyebut keyframe, dan zum yang membawa
 * gambar keluar dari bingkainya sendiri.
 */

const track = (
  property: string,
  points: Array<[number, number]>,
): { property: string; points: Array<{ at: number; value: number }> } => ({
  property,
  points: points.map(([at, value]) => ({ at, value })),
});

describe("skema track klip", () => {
  it("klip tanpa keyframe punya daftar track kosong, bukan undefined", () => {
    expect(clipSchema.parse({ id: "k1", type: "solid" }).tracks).toEqual([]);
  });

  it("empat properti yang boleh muat semuanya sekaligus", () => {
    // Sengaja tepat sebanyak batas per elemen: tidak ada satu pun yang harus
    // dikorbankan untuk memasang yang lain.
    expect(CLIP_ANIMATABLE).toHaveLength(MAX_TRACKS_PER_ELEMENT);
    const parsed = clipSchema.parse({
      id: "k1",
      type: "solid",
      tracks: CLIP_ANIMATABLE.map((property) =>
        track(property, [
          [0, ANIMATABLE_RANGE[property][0]],
          [1, ANIMATABLE_RANGE[property][1]],
        ]),
      ),
    });
    expect(parsed.tracks).toHaveLength(4);
  });

  it("rotate ditolak: bidang cover yang diputar berhenti menutupi bingkai", () => {
    const hasil = clipSchema.safeParse({
      id: "k1",
      type: "solid",
      tracks: [
        track("rotate", [
          [0, 0],
          [1, 15],
        ]),
      ],
    });
    expect(hasil.success).toBe(false);
  });

  it("zum di bawah 1 ditolak", () => {
    // 0,9 akan menarik tepi gambar ke dalam bingkai dan memunculkan warna
    // latar preset di pinggirnya — bukan efek, melainkan cacat.
    const hasil = clipSchema.safeParse({
      id: "k1",
      type: "solid",
      tracks: [
        track("zoom", [
          [0, 0.9],
          [1, 1.4],
        ]),
      ],
    });
    expect(hasil.success).toBe(false);
  });
});

describe("patch klip", () => {
  it("patch yang tidak menyebut tracks TIDAK menghapus keyframe", () => {
    // Bawaan `[]` di dalam field opsional adalah penghapusan yang menyamar:
    // "ganti gerak kamera" akan sekalian membuang seluruh animasi tangan.
    const parsed = sceneUpdateSchema.parse({ clip: { motion: "pan-left" } });
    expect(parsed.clip?.tracks).toBeUndefined();
  });

  it("patch yang menyebut tracks tetap divalidasi properti-nya", () => {
    const hasil = sceneUpdateSchema.safeParse({
      clip: {
        tracks: [
          track("size", [
            [0, 0.1],
            [1, 0.3],
          ]),
        ],
      },
    });
    expect(hasil.success).toBe(false);
  });
});

describe("panBeyondCover", () => {
  it("tanpa track pan, tidak ada yang bisa keluar bingkai", () => {
    expect(panBeyondCover([])).toBe(0);
    expect(
      panBeyondCover([
        track("zoom", [
          [0, 1],
          [1, 2],
        ]),
      ] as never),
    ).toBe(0);
  });

  it("pan tanpa zum langsung membuka bidang kosong", () => {
    // Zum 1 tidak menjulur sama sekali, jadi seluruh geseran adalah tepi
    // kosong: 0,2 bingkai geser = 0,2 bingkai kosong.
    expect(
      panBeyondCover([
        track("offsetX", [
          [0, 0],
          [1, 0.2],
        ]),
      ] as never),
    ).toBeCloseTo(0.2, 4);
  });

  it("zum yang cukup menutup pan-nya", () => {
    // Zum 1,5 menjulur 0,25 tiap sisi; geser 0,2 masih di dalamnya.
    expect(
      panBeyondCover([
        track("offsetX", [
          [0, 0],
          [1, 0.2],
        ]),
        track("zoom", [
          [0, 1.5],
          [1, 1.5],
        ]),
      ] as never),
    ).toBe(0);
  });

  it("menangkap saat yang zum-nya SUDAH mengecil tapi pan-nya belum pulang", () => {
    // Cacat ini tidak terlihat di titik keyframe mana pun kalau hanya ujung
    // yang diperiksa: di 0 dan 1 keduanya aman, yang bocor ada di tengah.
    const worst = panBeyondCover([
      track("offsetX", [
        [0, 0],
        [0.5, 0.4],
        [1, 0],
      ]),
      track("zoom", [
        [0, 2],
        [1, 2],
      ]),
    ] as never);
    // Zum 2 menjulur 0,5; puncak pan 0,4 -> masih aman.
    expect(worst).toBe(0);
    const bocor = panBeyondCover([
      track("offsetX", [
        [0, 0],
        [0.5, 0.4],
        [1, 0],
      ]),
      track("zoom", [
        [0, 1.2],
        [1, 1.2],
      ]),
    ] as never);
    expect(bocor).toBeCloseTo(0.3, 4);
  });

  it("sumbu Y dihitung sama seperti sumbu X", () => {
    expect(
      panBeyondCover([
        track("offsetY", [
          [0, 0],
          [1, -0.3],
        ]),
      ] as never),
    ).toBeCloseTo(0.3, 4);
  });
});

describe("saran sutradara", () => {
  it("pan yang melebihi zum diberitahukan, berikut angkanya", () => {
    const plan = makePlan((input) => {
      input.scenes[0]!.clips[0]!.tracks = [
        track("offsetX", [
          [0, 0],
          [1, 0.3],
        ]),
      ] as never;
    });
    const note = critiquePlan(plan).find((n) => n.code === "keyframe-pan-melebihi-zum");
    expect(note?.sceneId).toBe("sc-001");
    expect(note?.message).toContain("30%");
  });

  it("pan yang tertutup zum tidak diomeli", () => {
    const plan = makePlan((input) => {
      input.scenes[0]!.clips[0]!.tracks = [
        track("offsetX", [
          [0, 0],
          [1, 0.2],
        ]),
        track("zoom", [
          [0, 1.6],
          [1, 1.6],
        ]),
      ] as never;
    });
    expect(critiquePlan(plan).some((n) => n.code === "keyframe-pan-melebihi-zum")).toBe(
      false,
    );
  });

  it("preset tutorial-01 mengaku tidak akan memakai keyframe kamera itu", () => {
    // Kalau tidak dikatakan, keyframe-nya hilang tanpa satu pun jejak di
    // gambar — dan yang memasangnya akan mengira Dalang yang rusak.
    const plan = makePlan((input) => {
      input.meta.stylePreset = "tutorial-01";
      input.scenes[0]!.clips[0]!.tracks = [
        track("zoom", [
          [0, 1],
          [1, 1.4],
        ]),
      ] as never;
    });
    const note = critiquePlan(plan).find(
      (n) => n.code === "keyframe-kamera-diabaikan-preset",
    );
    expect(note?.level).toBe("perhatian");
  });
});
