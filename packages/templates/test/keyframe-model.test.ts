import {
  graphicSchema,
  type KeyframeTrack,
  parseScenePlan,
  videoLayerSchema,
} from "@dalang/core";
import { describe, expect, it } from "vitest";
import { graphicMotion, graphicStyle } from "../src/graphic-model";
import {
  evaluateTracks,
  isAnimated,
  KEYFRAME_EASING_FN,
  trackProgress,
  trackValue,
} from "../src/keyframe-model";
import { layerBoxStyle, layerMotion, layerSize } from "../src/layer-model";

/**
 * ADR-0027: evaluasi track keyframe.
 *
 * Gerak yang meleset adalah cacat yang paling mudah lolos dari mata: frame
 * diamnya terlihat benar, dan yang salah cuma perjalanannya. Jadi aturannya
 * diuji sebagai angka, satu per satu.
 */

const track = (points: [number, number][], easing = "linear"): KeyframeTrack =>
  ({
    property: "opacity",
    points: points.map(([at, value]) => ({ at, value, easing })),
  }) as KeyframeTrack;

describe("trackValue", () => {
  it("titik ujung dikembalikan apa adanya", () => {
    const t = track([
      [0, 0],
      [1, 1],
    ]);
    expect(trackValue(t, 0)).toBe(0);
    expect(trackValue(t, 1)).toBe(1);
  });

  it("linear berjalan lurus di antara dua titik", () => {
    const t = track([
      [0, 0],
      [1, 1],
    ]);
    expect(trackValue(t, 0.25)).toBeCloseTo(0.25, 6);
    expect(trackValue(t, 0.5)).toBeCloseTo(0.5, 6);
  });

  /**
   * DITAHAN di luar rentang, bukan diekstrapolasi. Ekstrapolasi akan membawa
   * properti keluar dari rentang sahnya sendiri di frame-frame tepi — persis
   * yang dijaga skema saat menulis, jadi melanggarnya saat membaca membuat
   * penjagaan itu tidak ada artinya.
   */
  it("di luar titik pertama/terakhir nilainya ditahan", () => {
    const t = track([
      [0.3, 0.2],
      [0.7, 0.9],
    ]);
    expect(trackValue(t, 0)).toBe(0.2);
    expect(trackValue(t, 0.1)).toBe(0.2);
    expect(trackValue(t, 0.9)).toBe(0.9);
    expect(trackValue(t, 1)).toBe(0.9);
  });

  it("tiga titik: tiap segmen dihitung sendiri", () => {
    const t = track([
      [0, 0],
      [0.5, 1],
      [1, 0],
    ]);
    expect(trackValue(t, 0.25)).toBeCloseTo(0.5, 6);
    expect(trackValue(t, 0.5)).toBeCloseTo(1, 6);
    expect(trackValue(t, 0.75)).toBeCloseTo(0.5, 6);
  });

  /**
   * Easing diambil dari titik yang MEMULAI segmen. Kalau diambil dari titik
   * penutup, mengubah easing sebuah titik akan mengubah segmen SEBELUMNYA —
   * perilaku yang tidak bisa ditebak siapa pun yang menggeser satu keyframe.
   */
  it("easing datang dari titik pembuka segmen", () => {
    const campur = {
      property: "opacity",
      points: [
        { at: 0, value: 0, easing: "linear" },
        { at: 0.5, value: 1, easing: "settle" },
        { at: 1, value: 0, easing: "linear" },
      ],
    } as KeyframeTrack;
    // Segmen pertama linear -> tepat di tengah.
    expect(trackValue(campur, 0.25)).toBeCloseTo(0.5, 6);
    // Segmen kedua settle -> TIDAK lurus; sudah jauh melewati tengah.
    expect(trackValue(campur, 0.75)).toBeLessThan(0.5);
  });

  it("setiap kurva easing mulai di 0 dan berakhir di 1", () => {
    for (const [nama, fn] of Object.entries(KEYFRAME_EASING_FN)) {
      expect(fn(0), nama).toBeCloseTo(0, 5);
      expect(fn(1), nama).toBeCloseTo(1, 5);
    }
  });

  it("nilai tetap di dalam rentang titik-titiknya", () => {
    // Kurva ber-easing boleh melengkung, tapi tidak boleh melewati ujungnya:
    // opacity 1,05 atau -0,02 akan ditolak Remotion saat render.
    for (const easing of Object.keys(KEYFRAME_EASING_FN)) {
      const t = track(
        [
          [0, 0],
          [1, 1],
        ],
        easing,
      );
      for (let i = 0; i <= 20; i++) {
        const v = trackValue(t, i / 20);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("evaluateTracks", () => {
  it("hanya properti yang PUNYA track yang muncul", () => {
    const tracks = [
      track([
        [0, 0],
        [1, 1],
      ]),
    ];
    const nilai = evaluateTracks(tracks, 0.5);
    expect(nilai.opacity).toBeCloseTo(0.5, 6);
    // Yang tidak punya track TIDAK diisi bawaan — pemanggilnya yang memutuskan
    // dengan `??`, dan itulah cara aturan "track menang penuh" bisa ditulis.
    expect("offsetX" in nilai).toBe(false);
    expect(evaluateTracks([], 0.5)).toEqual({});
  });

  it("isAnimated menjawab properti mana yang dikendalikan track", () => {
    const tracks = [
      track([
        [0, 0],
        [1, 1],
      ]),
    ];
    expect(isAnimated(tracks, "opacity")).toBe(true);
    expect(isAnimated(tracks, "offsetX")).toBe(false);
  });
});

describe("trackProgress", () => {
  it("membentang 0..1 sepanjang jendela", () => {
    expect(trackProgress(0, 61)).toBe(0);
    expect(trackProgress(30, 61)).toBeCloseTo(0.5, 6);
    expect(trackProgress(60, 61)).toBe(1);
  });

  it("dijepit, dan jendela sependek 1 frame tidak menghasilkan NaN", () => {
    expect(trackProgress(-5, 61)).toBe(0);
    expect(trackProgress(999, 61)).toBe(1);
    // Pembagian nol di sini akan menjalar jadi NaN ke seluruh gaya CSS elemen
    // dan membuatnya hilang tanpa jejak di video.
    expect(trackProgress(0, 1)).toBe(0);
    expect(Number.isNaN(trackProgress(0, 1))).toBe(false);
  });
});

/**
 * Aturan pusat ADR-0027, diuji lewat model SUNGGUHAN, bukan lewat evaluator
 * saja: properti yang punya track ditentukan PENUH olehnya — preset dan nilai
 * statis tidak lagi ikut menghitung properti itu — sementara properti lain
 * tetap dianimasikan preset seperti biasa.
 */
describe("track menang atas preset", () => {
  const graphic = (over: Record<string, unknown> = {}) =>
    graphicSchema.parse({ id: "g1", ref: "iconify:mdi:home", ...over });

  it("opacity yang di-track mengabaikan fade masuk preset", () => {
    // `pop` memudarkan grafis dari 0. Dengan track opacity tetap 1, frame
    // pertama pun harus sudah 1 — kalau dikalikan, hasilnya 0.
    const item = graphic({
      anim: "pop",
      tracks: [
        {
          property: "opacity",
          points: [
            { at: 0, value: 1 },
            { at: 1, value: 1 },
          ],
        },
      ],
    });
    expect(graphicMotion(item, 0, 60).opacity).toBe(1);
    // Tanpa track, frame pertama memang memudar.
    expect(graphicMotion(graphic({ anim: "pop" }), 0, 60).opacity).toBe(0);
  });

  it("rotate yang di-track mengabaikan putaran preset `putar`", () => {
    const item = graphic({
      anim: "putar",
      tracks: [
        {
          property: "rotate",
          points: [
            { at: 0, value: 10 },
            { at: 1, value: 10 },
          ],
        },
      ],
    });
    expect(graphicMotion(item, 40, 60).rotate).toBe(10);
    // Preset `putar` sendirian jelas sudah berputar jauh di frame 40.
    expect(graphicMotion(graphic({ anim: "putar" }), 40, 60).rotate).toBeGreaterThan(10);
  });

  /**
   * Satu track TIDAK boleh mematikan seluruh preset. Kalau ia melakukannya,
   * menganimasikan satu properti akan diam-diam membuang gerak yang sudah
   * dipilih orang untuk properti lain.
   */
  it("properti lain tetap dianimasikan preset", () => {
    const item = graphic({
      anim: "pop",
      tracks: [
        {
          property: "offsetX",
          points: [
            { at: 0, value: 0 },
            { at: 1, value: 0.2 },
          ],
        },
      ],
    });
    // offsetX ikut track...
    expect(graphicMotion(item, 59, 60).offsetX).toBeCloseTo(0.2, 4);
    // ...sementara `scale` milik `pop` tetap hidup.
    expect(graphicMotion(item, 0, 60).scale).toBeLessThan(1);
  });

  it("lapisan: opacity yang di-track mengabaikan entrance `fade`", () => {
    const layer = (over: Record<string, unknown> = {}) =>
      videoLayerSchema.parse({ id: "lap-1", visual: { type: "stock" }, ...over });
    const item = layer({
      entrance: "fade",
      tracks: [
        {
          property: "opacity",
          points: [
            { at: 0, value: 1 },
            { at: 1, value: 1 },
          ],
        },
      ],
    });
    expect(layerMotion(item, 0, 90).opacity).toBe(1);
    expect(layerMotion(layer({ entrance: "fade" }), 0, 90).opacity).toBe(0);
  });

  it("lapisan: lebar yang di-track dipakai kotaknya, bukan lebar statis", () => {
    const item = videoLayerSchema.parse({
      id: "lap-1",
      visual: { type: "stock" },
      width: 0.3,
      tracks: [
        {
          property: "width",
          points: [
            { at: 0, value: 0.2 },
            { at: 1, value: 0.6 },
          ],
        },
      ],
    });
    const motion = layerMotion(item, 89, 90);
    expect(motion.width).toBeCloseTo(0.6, 4);
    // Kotaknya benar-benar memakai angka itu — bukan 0,3 yang statis.
    expect(
      layerSize(motion, { width: 1000, height: 500, marginX: 0, marginTop: 0 }).width,
    ).toBeCloseTo(600, 1);
  });
});

/**
 * Gaya CSS yang BENAR-BENAR dipakai harus ikut track, bukan cuma objek motion.
 *
 * Ditemukan lewat mutasi: mengembalikan `graphicStyle`/`layerBoxStyle` ke nilai
 * statis membuat seluruh tes di atas TETAP HIJAU — track dihitung dengan benar,
 * lalu hasilnya dibuang saat menyusun gaya. Di video itu terlihat sebagai
 * ukuran yang diam sementara sisanya bergerak.
 */
describe("gaya terpakai mengikuti track", () => {
  const bingkai = { width: 1000, height: 500, marginX: 0, marginTop: 0 };

  it("grafis: lebar & geseran CSS memakai nilai hasil track", () => {
    const item = graphicSchema.parse({
      id: "g1",
      ref: "iconify:mdi:home",
      anim: "diam",
      size: 0.1,
      offsetX: 0,
      tracks: [
        {
          property: "size",
          points: [
            { at: 0, value: 0.1 },
            { at: 1, value: 0.4 },
          ],
        },
        {
          property: "offsetX",
          points: [
            { at: 0, value: 0 },
            { at: 1, value: 0.25 },
          ],
        },
      ],
    });
    const akhir = graphicStyle(item, graphicMotion(item, 59, 60), bingkai);
    // 0,4 x 500 = 200px, bukan 0,1 x 500 = 50px.
    expect(akhir.width).toBeCloseTo(200, 1);
    // 0,25 x 1000 = 250px, bukan 0.
    expect(String(akhir.translate)).toContain("250");
  });

  it("lapisan: lebar & geseran CSS memakai nilai hasil track", () => {
    const item = videoLayerSchema.parse({
      id: "lap-1",
      visual: { type: "stock" },
      anchor: "kiri-atas",
      entrance: "diam",
      width: 0.2,
      offsetX: 0,
      tracks: [
        {
          property: "width",
          points: [
            { at: 0, value: 0.2 },
            { at: 1, value: 0.5 },
          ],
        },
        {
          property: "offsetX",
          points: [
            { at: 0, value: 0 },
            { at: 1, value: 0.1 },
          ],
        },
      ],
    });
    const gaya = layerBoxStyle(item, layerMotion(item, 89, 90), bingkai, "#fff");
    expect(gaya.width).toBeCloseTo(500, 1);
    expect(String(gaya.translate)).toContain("100");
  });
});

describe("track sebagai data plan", () => {
  it("plan dengan track lolos parse dan nilainya utuh", () => {
    const plan = parseScenePlan({
      version: 2,
      projectId: "uji-0027",
      meta: { title: "Uji Keyframe" },
      scenes: [
        {
          id: "a",
          narration: "Satu.",
          clips: [{ id: "a-k1", type: "solid" }],
          duration: 5,
          graphics: [
            {
              id: "g1",
              ref: "iconify:mdi:home",
              tracks: [
                {
                  property: "offsetX",
                  points: [
                    { at: 0, value: -0.3, easing: "glide" },
                    { at: 1, value: 0.1 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const tracks = plan.scenes[0]?.graphics[0]?.tracks ?? [];
    expect(tracks).toHaveLength(1);
    expect(trackValue(tracks[0] as KeyframeTrack, 0)).toBe(-0.3);
    expect(trackValue(tracks[0] as KeyframeTrack, 1)).toBe(0.1);
  });
});
