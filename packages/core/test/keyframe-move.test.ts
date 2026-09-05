import { describe, expect, it } from "vitest";
import { type KeyframeTrack, moveKeyframe } from "../src";

/**
 * Menyeret berlian keyframe (mencabut batas ADR-0027): hanya waktunya yang
 * pindah; nilai dan easing ikut, urutan dijaga, tabrakan ditolak.
 */

const tracks: KeyframeTrack[] = [
  {
    property: "offsetX",
    points: [
      { at: 0, value: -0.2, easing: "settle" },
      { at: 0.5, value: 0, easing: "linear" },
      { at: 1, value: 0.2, easing: "settle" },
    ],
  },
  {
    property: "opacity",
    points: [
      { at: 0, value: 0, easing: "settle" },
      { at: 1, value: 1, easing: "settle" },
    ],
  },
];

describe("moveKeyframe", () => {
  it("memindahkan waktu satu titik, nilai & easing ikut, titik diurutkan ulang", () => {
    const next = moveKeyframe(tracks, "offsetX", 0.5, 0.9);
    expect(next[0]?.points.map((p) => p.at)).toEqual([0, 0.9, 1]);
    expect(next[0]?.points[1]).toEqual({ at: 0.9, value: 0, easing: "linear" });
    // Track lain tidak tersentuh, larik aslinya tidak dimutasi.
    expect(next[1]).toEqual(tracks[1]);
    expect(tracks[0]?.points[1]?.at).toBe(0.5);
  });

  it("melewati titik lain saat diseret: urutan mengikuti waktu baru", () => {
    const next = moveKeyframe(tracks, "offsetX", 0, 0.7);
    expect(next[0]?.points.map((p) => p.at)).toEqual([0.5, 0.7, 1]);
    expect(next[0]?.points[1]?.value).toBe(-0.2);
  });

  it("dipangkas ke 0..1; pangkasan yang mendarat di titik lain ikut ditolak", () => {
    const pendek: KeyframeTrack[] = [
      {
        property: "offsetX",
        points: [
          { at: 0, value: -0.2, easing: "settle" },
          { at: 0.5, value: 0, easing: "settle" },
        ],
      },
    ];
    expect(moveKeyframe(pendek, "offsetX", 0.5, 1.7)[0]?.points.map((p) => p.at)).toEqual(
      [0, 1],
    );
    expect(moveKeyframe(pendek, "offsetX", 0.5, -3)).toBe(pendek);
  });

  it("mendarat tepat di atas titik lain ditolak — larik yang SAMA kembali (identitas)", () => {
    // Identitas, bukan sekadar isi yang sama: pemanggil memakai `===` untuk
    // tahu tidak ada yang berubah. Salinan pernah membuat seretan yang ditolak
    // tetap mengirim patch kosong dan memakan satu langkah undo.
    expect(moveKeyframe(tracks, "offsetX", 0.5, 1)).toBe(tracks);
    expect(moveKeyframe(tracks, "offsetX", 0.5, 0.0005)).toBe(tracks);
    expect(moveKeyframe(tracks, "offsetX", 0.5, 0.5)).toBe(tracks);
  });

  it("titik atau track yang tidak ada tidak mengubah apa pun", () => {
    expect(moveKeyframe(tracks, "offsetX", 0.3, 0.4)).toBe(tracks);
    expect(moveKeyframe(tracks, "rotate", 0, 0.4)).toBe(tracks);
  });
});
