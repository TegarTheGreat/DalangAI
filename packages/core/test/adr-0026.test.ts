import { describe, expect, it } from "vitest";
import {
  applyPatch,
  audioTrackSchema,
  clipAudioSchema,
  critiquePlan,
  dbToGain,
  effectiveLufs,
  LOUDNESS_TARGETS,
  loudnessGain,
  loudnessGainClamped,
  MAX_LOUDNESS_GAIN_DB,
  MIN_LOUDNESS_GAIN_DB,
  orphanMediaAssetIds,
  parseScenePlan,
  type ScenePlan,
  SILENT_CLIP_AUDIO,
  setLoudness,
  setTrackAsset,
  uniqueTrackId,
} from "../src";

/**
 * ADR-0026: audio per klip — amplop, ducking, normalisasi kenyaringan.
 *
 * Yang diuji kontraknya, bukan bunyinya: default yang aman, batas yang
 * ditegakkan, hasil ukur yang menyebar ke semua pemakai berkas yang sama, dan
 * perubahan yang bisa dibatalkan utuh seperti patch lain.
 */

const plan = (over: Record<string, unknown> = {}): ScenePlan =>
  parseScenePlan({
    version: 1,
    projectId: "uji-0026",
    meta: { title: "Uji Audio" },
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

describe("clipAudioSchema", () => {
  /**
   * Bisu adalah default yang benar untuk aset visual. Stock footage datang
   * dengan suara ruangan, musik toko, dan orang berbicara bahasa lain —
   * memutarnya secara bawaan berarti setiap video punya suara asing di
   * bawah narasinya sampai seseorang menyadarinya.
   */
  it("default-nya bisu, dengan ducking dan normalisasi menyala", () => {
    expect(clipAudioSchema.parse({})).toEqual(SILENT_CLIP_AUDIO);
    expect(SILENT_CLIP_AUDIO.volume).toBe(0);
    expect(SILENT_CLIP_AUDIO.ducking).toBe(true);
    expect(SILENT_CLIP_AUDIO.normalize).toBe(true);
  });

  it("menolak volume di luar 0..1 dan fade negatif", () => {
    expect(() => clipAudioSchema.parse({ volume: 1.5 })).toThrow();
    expect(() => clipAudioSchema.parse({ volume: -0.1 })).toThrow();
    expect(() => clipAudioSchema.parse({ fadeInSec: -1 })).toThrow();
  });

  it("menolak kunci asing — amplop audio adalah bentuk tertutup", () => {
    expect(() => clipAudioSchema.parse({ volume: 0.5, gain: 2 })).toThrow();
  });
});

describe("meta.loudnessTarget", () => {
  it("bawaannya -16 LUFS (web), dan null berarti normalisasi dimatikan", () => {
    expect(plan().meta.loudnessTarget).toBe(-16);
    expect(plan({ meta: { title: "x", loudnessTarget: null } }).meta.loudnessTarget).toBe(
      null,
    );
  });

  it("sasaran bawaan ada di daftar sasaran yang ditawarkan Studio", () => {
    expect(LOUDNESS_TARGETS.map((entry) => entry.lufs)).toContain(
      plan().meta.loudnessTarget,
    );
  });

  it("menolak sasaran yang tidak masuk akal", () => {
    expect(() => plan({ meta: { title: "x", loudnessTarget: -100 } })).toThrow();
    expect(() => plan({ meta: { title: "x", loudnessTarget: 0 } })).toThrow();
  });
});

describe("loudnessGain", () => {
  it("membawa hasil ukur ke sasaran", () => {
    expect(loudnessGain(-26, -16)).toBeCloseTo(dbToGain(10), 6);
    expect(loudnessGain(-6, -16)).toBeCloseTo(dbToGain(-10), 6);
    expect(loudnessGain(-16, -16)).toBeCloseTo(1, 6);
  });

  /**
   * Belum diukur berarti penguatan 1 — bukan tebakan. Ini aturan paling
   * penting di ADR-0026: satu tebakan yang meleset 20 dB terdengar sebagai
   * ledakan di tengah video, dan tidak ada gate visual yang bisa melihatnya.
   */
  it("tanpa hasil ukur, atau tanpa sasaran, penguatannya tepat 1", () => {
    expect(loudnessGain(undefined, -16)).toBe(1);
    expect(loudnessGain(-26, null)).toBe(1);
    expect(loudnessGain(Number.NaN, -16)).toBe(1);
    expect(loudnessGain(Number.NEGATIVE_INFINITY, -16)).toBe(1);
  });

  it("penguatan dijepit di kedua arah", () => {
    expect(loudnessGain(-60, -16)).toBeCloseTo(dbToGain(MAX_LOUDNESS_GAIN_DB), 6);
    expect(loudnessGain(-1, -40)).toBeCloseTo(dbToGain(MIN_LOUDNESS_GAIN_DB), 6);
  });

  /**
   * Koreksi MONO. Campurannya stereo, jadi berkas mono diputar sebagai
   * dual-mono dan terdengar 3,01 LU lebih keras daripada angka ukurnya.
   * Tanpa koreksi ini narasi (hampir selalu mono) mendarat 3 dB di atas
   * sasaran sementara musik stereo mendarat tepat — persis ketimpangan yang
   * seharusnya DIHAPUS oleh normalisasi.
   *
   * Terukur pada render nyata: nada mono -26,68 LUFS keluar -23,67 LUFS.
   */
  it("sumber mono dikoreksi 3,01 LU, stereo tidak", () => {
    expect(effectiveLufs(-26.68, 1)).toBeCloseTo(-23.67, 2);
    expect(effectiveLufs(-23.67, 2)).toBeCloseTo(-23.67, 6);
    // Tanpa keterangan kanal, tidak ada koreksi: menebak lebih buruk daripada
    // tidak mengoreksi.
    expect(effectiveLufs(-26.68, undefined)).toBe(-26.68);
  });

  it("penguatan mono membawa hasil AKHIR ke sasaran, bukan berkasnya", () => {
    // -26,68 LUFS mono -> terdengar -23,67 -> butuh +7,67 dB untuk jadi -16.
    expect(loudnessGain(-26.68, -16, 1)).toBeCloseTo(dbToGain(7.67), 4);
    // Berkas stereo dengan kenyaringan terdengar yang sama minta penguatan sama.
    expect(loudnessGain(-23.67, -16, 2)).toBeCloseTo(loudnessGain(-26.68, -16, 1), 6);
  });

  it("loudnessGainClamped mengatakan kapan batas itu kena", () => {
    expect(loudnessGainClamped(-60, -16)).toBe(true);
    expect(loudnessGainClamped(-26, -16)).toBe(false);
    expect(loudnessGainClamped(undefined, -16)).toBe(false);
  });
});

describe("audioTrackSchema", () => {
  it("trek baru boleh belum punya berkas — kartunya yang mengatakan itu", () => {
    // Kalau `assetId` wajib berisi, tombol "Tambah trek" di Studio tidak bisa
    // membuat trek sama sekali: berkasnya dipilih SETELAH treknya ada.
    const track = audioTrackSchema.parse({ id: "trek-1" });
    expect(track.assetId).toBe("");
    expect(track.sceneId).toBe(null);
    expect(track.audio.volume).toBeGreaterThan(0);
  });

  it("maksimal 8 trek", () => {
    const tracks = Array.from({ length: 9 }, (_, index) => ({ id: `trek-${index}` }));
    expect(() => plan({ audio: { tracks } })).toThrow();
    expect(() => plan({ audio: { tracks: tracks.slice(0, 8) } })).not.toThrow();
  });

  it("id trek tidak boleh kembar se-plan", () => {
    expect(() => plan({ audio: { tracks: [{ id: "sama" }, { id: "sama" }] } })).toThrow(
      /sama/,
    );
  });

  /**
   * Penjagaan yang sama untuk SEMUA ruang id yang jadi kunci renderState.
   *
   * Ditemukan justru saat menambahkan trek audio: aturan unik-se-plan sudah
   * ada untuk lapisan (ADR-0025), tapi grafis dan cue SFX tidak pernah
   * mendapatkannya walau dikunci dengan cara yang persis sama sejak ADR-0018.
   * Dua grafis ber-id sama berbagi satu berkas, dan menghapus salah satunya
   * mencabut berkas milik yang lain — diam-diam, tanpa galat.
   */
  it("id grafis dan id cue SFX juga harus unik se-plan", () => {
    expect(() =>
      plan({
        scenes: [
          {
            id: "a",
            narration: "Satu.",
            clips: [{ id: "a-k1", type: "solid" }],
            duration: 5,
            graphics: [{ id: "G", ref: "iconify:mdi:home" }],
          },
          {
            id: "b",
            narration: "Dua.",
            clips: [{ id: "b-k1", type: "solid" }],
            duration: 5,
            graphics: [{ id: "G", ref: "iconify:mdi:star" }],
          },
        ],
      }),
    ).toThrow(/grafis "G" dipakai lebih dari sekali/);

    expect(() =>
      plan({
        audio: {
          sfx: [
            { id: "S", assetId: "pustaka:whoosh", sceneId: "a", atSec: 0 },
            { id: "S", assetId: "pustaka:pop", sceneId: "a", atSec: 1 },
          ],
        },
      }),
    ).toThrow(/cue SFX "S" dipakai lebih dari sekali/);
  });

  it("id yang memang berbeda tetap diterima di semua ruang", () => {
    expect(() =>
      plan({
        scenes: [
          {
            id: "a",
            narration: "Satu.",
            clips: [{ id: "a-k1", type: "solid" }],
            duration: 5,
            layers: [{ id: "L1", visual: { type: "stock" } }],
            graphics: [{ id: "G1", ref: "iconify:mdi:home" }],
          },
        ],
        audio: {
          sfx: [{ id: "S1", assetId: "pustaka:whoosh", sceneId: "a", atSec: 0 }],
          tracks: [{ id: "T1" }, { id: "T2" }],
        },
      }),
    ).not.toThrow();
  });

  it("uniqueTrackId menghindari id yang sudah dipakai", () => {
    const dengan = plan({ audio: { tracks: [{ id: "trek-a" }] } });
    expect(uniqueTrackId(dengan, "trek-a")).not.toBe("trek-a");
  });
});

describe("setLoudness", () => {
  const berbagi = (): ScenePlan =>
    parseScenePlan({
      version: 1,
      projectId: "uji-ukur",
      meta: { title: "Uji" },
      scenes: [
        {
          id: "a",
          narration: "Satu.",
          clips: [{ id: "a-k1", type: "stock" }],
          duration: 5,
        },
        {
          id: "b",
          narration: "Dua.",
          clips: [{ id: "b-k1", type: "stock" }],
          duration: 5,
        },
      ],
      renderState: {
        narrationAudio: { a: { file: "audio/a.wav", durationSec: 3 } },
        clipAssets: {
          "a-k1": { file: "media/sama.mp4", kind: "video", source: "pexels" },
          "b-k1": { file: "media/sama.mp4", kind: "video", source: "pexels" },
        },
      },
    });

  /**
   * Dikunci PATH BERKAS, bukan id pemakainya: satu rekaman yang dipakai dua
   * scene diukur sekali dan angkanya berlaku untuk keduanya. Kalau dikunci
   * per pemakai, scene kedua tidak pernah ternormalisasi walau berkasnya sudah
   * diukur.
   */
  it("menulis hasil ukur ke SEMUA entri yang menunjuk berkas yang sama", () => {
    const diukur = setLoudness(berbagi(), "media/sama.mp4", -21.4);
    expect(diukur.renderState.clipAssets["a-k1"]?.lufs).toBe(-21.4);
    expect(diukur.renderState.clipAssets["b-k1"]?.lufs).toBe(-21.4);
  });

  it("berkas narasi ikut terukur", () => {
    const diukur = setLoudness(berbagi(), "audio/a.wav", -19);
    expect(diukur.renderState.narrationAudio.a?.lufs).toBe(-19);
  });

  it("tidak menyentuh berkas lain, dan tidak mengubah plan asalnya", () => {
    const asal = berbagi();
    const diukur = setLoudness(asal, "media/sama.mp4", -21.4);
    expect(diukur.renderState.narrationAudio.a?.lufs).toBeUndefined();
    expect(asal.renderState.clipAssets["a-k1"]?.lufs).toBeUndefined();
  });
});

describe("trek audio sebagai data plan", () => {
  it("bisa dipasang lewat patch dan dibatalkan utuh", () => {
    const awal = plan();
    const maju = applyPatch(
      awal,
      [
        {
          op: "setAudio",
          patch: { tracks: [{ id: "trek-1", assetId: "assets/ambience.wav" }] },
        },
      ],
      { origin: "user" },
    );
    expect(maju.plan.audio.tracks).toHaveLength(1);
    const balik = applyPatch(maju.plan, maju.applied.inverse, { origin: "user" });
    expect(balik.plan.audio.tracks).toEqual(awal.audio.tracks);
  });

  it("aset trek tercatat per id trek, bukan per scene", () => {
    const dengan = setTrackAsset(
      plan({ audio: { tracks: [{ id: "trek-1", assetId: "assets/a.wav" }] } }),
      "trek-1",
      { file: "assets/a.wav", kind: "audio", source: "unggahan", durationSec: 12 },
    );
    expect(dengan.renderState.trackAssets["trek-1"]?.durationSec).toBe(12);
  });

  it("aset trek yang treknya sudah dihapus terdeteksi sebagai yatim", () => {
    const dengan = setTrackAsset(
      plan({ audio: { tracks: [{ id: "trek-1", assetId: "assets/a.wav" }] } }),
      "trek-1",
      { file: "assets/a.wav", kind: "audio", source: "unggahan" },
    );
    const tanpa = applyPatch(dengan, [{ op: "setAudio", patch: { tracks: [] } }], {
      origin: "user",
    }).plan;
    expect(orphanMediaAssetIds(tanpa).tracks).toEqual(["trek-1"]);
  });
});

describe("critiquePlan soal audio", () => {
  const berbunyi = (): ScenePlan =>
    parseScenePlan({
      version: 1,
      projectId: "uji-kritik",
      meta: { title: "Uji" },
      scenes: [
        {
          id: "a",
          narration: "Satu.",
          visual: { type: "stock", audio: { volume: 0.6 } },
          duration: 5,
        },
      ],
      renderState: {
        clipAssets: { "a-k1": { file: "media/a.mp4", kind: "video", source: "pexels" } },
      },
    });

  it("memberi tahu saat ada yang berbunyi tapi belum terukur", () => {
    const notes = critiquePlan(berbunyi());
    expect(notes.map((note) => note.code)).toContain("audio-belum-diukur");
  });

  it("diam setelah berkasnya terukur", () => {
    const diukur = setLoudness(berbunyi(), "media/a.mp4", -20);
    expect(critiquePlan(diukur).map((note) => note.code)).not.toContain(
      "audio-belum-diukur",
    );
  });

  /**
   * Klip BISU tidak boleh dikeluhkan: mengukur berkas yang volumenya nol
   * adalah pekerjaan yang hasilnya tidak pernah dipakai, dan peringatan yang
   * menyuruh melakukannya mengajarkan orang mengabaikan peringatan.
   */
  it("tidak mengeluhkan klip yang memang bisu", () => {
    const bisu = plan({
      scenes: [
        {
          id: "a",
          narration: "Satu.",
          clips: [{ id: "a-k1", type: "stock" }],
          duration: 5,
        },
      ],
      renderState: {
        clipAssets: { "a-k1": { file: "media/a.mp4", kind: "video", source: "pexels" } },
      },
    });
    expect(critiquePlan(bisu).map((note) => note.code)).not.toContain(
      "audio-belum-diukur",
    );
  });
});
