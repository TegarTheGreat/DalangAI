import type { Clip, KeyframeTrack } from "@dalang/core";
import { panBeyondCover } from "@dalang/core";
import { describe, expect, it } from "vitest";
import { easeDolly } from "../src/anim";
import { trackValue } from "../src/keyframe-model";
import { clipCamera, motionTransform } from "../src/motion-model";

/**
 * Kamera visual dasar scene (ADR-0036).
 *
 * Yang diuji bukan "geraknya enak dilihat" — itu penilaian mata, dan buktinya
 * bingkai yang dirender. Yang diuji adalah aturan-aturan yang tidak terlihat
 * di gambar mana pun sampai seseorang bertanya kenapa: plan lama harus
 * menghasilkan transform yang sama persis, satu track kamera harus mengambil
 * alih seluruh jalur kamera, dan jam keyframe tidak boleh ber-easing dua kali.
 */

const clip = (over: Partial<Clip> = {}): Clip =>
  ({
    id: "k1",
    type: "solid",
    motion: "none",
    flipH: false,
    focusX: 0.5,
    focusY: 0.5,
    tracks: [],
    ...over,
  }) as Clip;

const trek = (
  property: string,
  points: Array<[number, number]>,
  easing = "linear",
): KeyframeTrack =>
  ({
    property,
    points: points.map(([at, value]) => ({ at, value, easing })),
  }) as KeyframeTrack;

/** Progres preset seperti yang dihitung Backdrop sebelum ADR-0036. */
const presetProgress = (frame: number, frames: number): number =>
  easeDolly(Math.min(1, Math.max(0, frame / Math.max(frames, 1))));

describe("klip tanpa keyframe", () => {
  it("menghasilkan transform yang SAMA PERSIS dengan sebelum ADR-0036", () => {
    // Janji "skema naik tanpa menggeser satu piksel pun": setiap plan yang
    // sudah ada harus keluar dari fungsi baru ini dengan angka yang identik.
    for (const motion of [
      "none",
      "kenburns-in",
      "kenburns-out",
      "pan-left",
      "pan-right",
      "pan-up",
      "pan-down",
      "drift",
    ] as const) {
      for (const frame of [0, 1, 37, 90, 180]) {
        const c = clip({ motion });
        expect(clipCamera(c, frame, 180)).toMatchObject(
          motionTransform(c, presetProgress(frame, 180)),
        );
      }
    }
  });

  it("opasitas TIDAK diisi 1, dan kamera bukan milik keyframe", () => {
    // `undefined` dan bukan 1: opasitas statis visual dasar hidup di
    // `filter.opacity` (ADR-0011), dan mengembalikan 1 di sini akan membuat
    // setiap klip berfilter transparan mendadak legap.
    const camera = clipCamera(clip({ motion: "kenburns-in" }), 40, 180);
    expect(camera.opacity).toBeUndefined();
    expect(camera.keyed).toBe(false);
  });
});

describe("track opasitas berdiri di luar kamera", () => {
  it("tidak merenggut preset gerak yang sudah dipilih orang", () => {
    // Ini bedanya opacity dari zum/geser: memberi klip satu kedipan tidak
    // boleh diam-diam mematikan ken burns-nya.
    const c = clip({
      motion: "kenburns-in",
      tracks: [
        trek("opacity", [
          [0, 1],
          [1, 0],
        ]),
      ],
    });
    expect(c.tracks).toHaveLength(1);
    const camera = clipCamera(c, 90, 181);
    expect(camera.keyed).toBe(false);
    expect(camera.scale).toBe(motionTransform(c, presetProgress(90, 181)).scale);
    expect(camera.opacity).toBeCloseTo(0.5, 2);
  });
});

describe("track kamera mengambil alih SELURUH jalur kamera", () => {
  it("satu track zum membuang preset gerak seluruhnya", () => {
    // "pan-left" adalah skala 1,1 DAN geseran 2,2% yang diputuskan bersama.
    // Menyisakan separuhnya menghasilkan gerak yang bukan preset dan bukan
    // pula yang digambar keyframe.
    const c = clip({
      motion: "pan-left",
      tracks: [
        trek("zoom", [
          [0, 1],
          [1, 2],
        ]),
      ],
    });
    const camera = clipCamera(c, 100, 101);
    expect(camera.keyed).toBe(true);
    expect(Number(camera.scale)).toBe(2);
    expect(camera.translate).toBe("0% 0%");
  });

  it("sumbu yang tidak di-track duduk di NETRAL, bukan di nilai presetnya", () => {
    const c = clip({
      motion: "pan-down",
      tracks: [
        trek("offsetX", [
          [0, 0],
          [1, 0.1],
        ]),
      ],
    });
    const camera = clipCamera(c, 100, 101);
    expect(camera.translate).toBe("10% 0%");
    expect(Number(camera.scale)).toBe(1);
  });

  it("cermin dan titik fokus tetap berlaku — keduanya pembingkaian, bukan gerak", () => {
    const c = clip({
      flipH: true,
      focusX: 0.2,
      focusY: 0.85,
      tracks: [
        trek("zoom", [
          [0, 1.5],
          [1, 1.5],
        ]),
      ],
    });
    const camera = clipCamera(c, 0, 60);
    expect(camera.scale).toBe("-1.5 1.5");
    expect(camera.objectPosition).toBe("20.0% 85.0%");
  });
});

describe("jam keyframe", () => {
  it("LINEAR, bukan lewat easeDolly: easing segmen tidak dikenakan dua kali", () => {
    // Kalau jamnya ikut ber-easing dolly, easing "linear" pun akan melambat
    // di ujung — dan tidak ada apa pun di plan yang menjelaskan kenapa.
    const c = clip({
      tracks: [
        trek("zoom", [
          [0, 1],
          [1, 3],
        ]),
      ],
    });
    expect(Number(clipCamera(c, 50, 101).scale)).toBeCloseTo(2, 6);
    expect(easeDolly(0.5)).not.toBeCloseTo(0.5, 6);
  });

  it("klip sepanjang satu frame memakai titik pertama, bukan NaN", () => {
    const c = clip({
      tracks: [
        trek("zoom", [
          [0, 1.2],
          [1, 2],
        ]),
      ],
    });
    expect(Number(clipCamera(c, 0, 1).scale)).toBeCloseTo(1.2, 6);
  });
});

describe("dua pembaca track yang sama", () => {
  it("pembacaan linear di core sepakat dengan interpolator templates", () => {
    // `panBeyondCover` hidup di core dan tidak bisa memakai kurva easing yang
    // tinggal di templates, jadi ia punya pembacaan linearnya sendiri. Dua
    // implementasi berarti dua yang bisa menyimpang; test ini pagarnya.
    const pan = trek("offsetX", [
      [0, 0],
      [0.5, 0.4],
      [1, 0],
    ]);
    const zoom = trek("zoom", [
      [0, 1.2],
      [1, 1.2],
    ]);
    let worst = 0;
    for (let i = 0; i <= 40; i++) {
      const at = i / 40;
      const over = Math.abs(trackValue(pan, at)) - (trackValue(zoom, at) - 1) / 2;
      if (over > worst) worst = over;
    }
    expect(panBeyondCover([pan, zoom])).toBeCloseTo(worst, 4);
  });
});
