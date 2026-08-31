import {
  type ClipAudio,
  MAX_LOUDNESS_GAIN_DB,
  parseScenePlan,
  SILENT_CLIP_AUDIO,
} from "@dalang/core";
import { describe, expect, it } from "vitest";
import {
  buildClipVolume,
  DUCK_FACTOR,
  DUCK_RAMP_FRAMES,
  duckAt,
  duckWindows,
  isSilent,
  narrationVolume,
} from "../src/audio-model";
import { computeFrameLayout, FPS } from "../src/layout";

/**
 * ADR-0026: amplop audio per klip.
 *
 * Ini satu-satunya tempat yang memutuskan seberapa keras sesuatu terdengar
 * pada satu frame. Salah di sini tidak terlihat di gate visual mana pun —
 * frame-nya tetap sama persis — dan baru ketahuan dengan telinga, biasanya
 * setelah videonya diunggah. Jadi aturannya diuji satu per satu.
 */

const audio = (over: Partial<ClipAudio> = {}): ClipAudio => ({
  ...SILENT_CLIP_AUDIO,
  volume: 1,
  ...over,
});

const build = (over: Partial<Parameters<typeof buildClipVolume>[0]> = {}) =>
  buildClipVolume({
    audio: audio(),
    targetLufs: null,
    startFrame: 0,
    frames: 120,
    fps: FPS,
    ducks: [],
    ...over,
  });

describe("buildClipVolume", () => {
  it("tanpa fade, tanpa ducking, tanpa normalisasi: volume dipakai apa adanya", () => {
    const at = build({ audio: audio({ volume: 0.4 }) });
    expect(at(0)).toBeCloseTo(0.4, 6);
    expect(at(60)).toBeCloseTo(0.4, 6);
    expect(at(119)).toBeCloseTo(0.4, 6);
  });

  /**
   * Klip bisu harus BENAR-BENAR nol di setiap frame, bukan "hampir nol".
   * Fade masuk pada klip bisu yang salah hitung menghasilkan letupan pendek
   * di awal — cacat yang paling sering lolos karena cuma satu-dua frame.
   */
  it("volume 0 berarti nol di semua frame, termasuk saat fade menyala", () => {
    const at = build({ audio: audio({ volume: 0, fadeInSec: 1, fadeOutSec: 1 }) });
    for (const frame of [0, 1, 15, 60, 119]) expect(at(frame)).toBe(0);
  });

  it("fade masuk mulai dari nol dan penuh tepat di ujung fade", () => {
    const at = build({ audio: audio({ volume: 1, fadeInSec: 1 }) });
    expect(at(0)).toBeCloseTo(0, 6);
    expect(at(FPS / 2)).toBeCloseTo(0.5, 2); // titik tengah kosinus
    expect(at(FPS)).toBeCloseTo(1, 6);
    expect(at(FPS + 10)).toBeCloseTo(1, 6);
  });

  it("fade keluar berakhir di nol tepat di frame terakhir", () => {
    const at = build({ audio: audio({ volume: 1, fadeOutSec: 1 }), frames: 120 });
    expect(at(60)).toBeCloseTo(1, 6);
    expect(at(120 - FPS)).toBeCloseTo(1, 6);
    expect(at(120)).toBeCloseTo(0, 6);
  });

  /**
   * Fade yang lebih panjang daripada klipnya tidak boleh menghasilkan volume
   * negatif atau melonjak: `cosRamp` menjepit, dan hasil akhirnya dijepit lagi
   * di 0. Remotion menolak volume negatif dengan melempar saat render — jauh
   * setelah preview terlihat baik-baik saja.
   */
  it("fade lebih panjang daripada klipnya tetap menghasilkan 0..1", () => {
    const at = build({
      audio: audio({ volume: 1, fadeInSec: 10, fadeOutSec: 10 }),
      frames: 30,
    });
    for (let frame = 0; frame <= 30; frame++) {
      expect(at(frame)).toBeGreaterThanOrEqual(0);
      expect(at(frame)).toBeLessThanOrEqual(1);
    }
  });

  it("normalisasi membawa klip ke sasaran sebelum volume diterapkan", () => {
    // -26 LUFS menuju -16 LUFS = +10 dB = 3,162x, lalu dikali volume 0,25.
    const at = build({
      audio: audio({ volume: 0.25 }),
      lufs: -26,
      targetLufs: -16,
    });
    expect(at(0)).toBeCloseTo(0.25 * 10 ** (10 / 20), 5);
  });

  it("normalisasi dimatikan berarti volume mentah, walau hasil ukurnya ada", () => {
    const at = build({
      audio: audio({ volume: 0.25, normalize: false }),
      lufs: -26,
      targetLufs: -16,
    });
    expect(at(0)).toBeCloseTo(0.25, 6);
  });

  /**
   * Belum diukur BUKAN alasan untuk menebak. Ini aturan paling penting di
   * seluruh ADR-0026: satu tebakan yang meleset 20 dB terdengar sebagai
   * ledakan di tengah video.
   */
  it("tanpa hasil ukur, tidak ada penguatan sama sekali", () => {
    expect(build({ audio: audio({ volume: 0.5 }), targetLufs: -16 })(0)).toBeCloseTo(
      0.5,
      6,
    );
  });

  it("penguatan dijepit di batas — rekaman sangat pelan tidak dinaikkan sampai desisnya ikut", () => {
    const at = build({ audio: audio({ volume: 1 }), lufs: -60, targetLufs: -16 });
    expect(at(0)).toBeCloseTo(10 ** (MAX_LOUDNESS_GAIN_DB / 20), 5);
  });

  /**
   * Ducking dihitung di waktu GLOBAL. Klip yang mulai di detik 4 harus
   * mengecil karena narasi di detik 4, bukan karena narasi di detik 0.
   * Memakai frame lokal di sini memberi ducking yang menyala di tempat yang
   * salah — persis jenis cacat yang terdengar "aneh" tanpa bisa ditunjuk.
   */
  it("ducking dihitung di waktu global, bukan waktu lokal klip", () => {
    const ducks = [{ from: 120, to: 240 }];
    const mulaiDiDalam = build({ audio: audio({ volume: 1 }), startFrame: 150, ducks });
    const mulaiDiLuar = build({ audio: audio({ volume: 1 }), startFrame: 0, ducks });
    // Frame lokal 0 pada klip yang mulai di frame global 150: di dalam narasi.
    expect(mulaiDiDalam(0)).toBeCloseTo(DUCK_FACTOR, 5);
    // Frame lokal 0 pada klip yang mulai di frame global 0: jauh dari narasi.
    expect(mulaiDiLuar(0)).toBeCloseTo(1, 5);
  });

  it("sakelar ducking mati berarti narasi tidak mempengaruhi klip ini", () => {
    const ducks = [{ from: 0, to: 240 }];
    const at = build({ audio: audio({ volume: 1, ducking: false }), ducks });
    expect(at(60)).toBeCloseTo(1, 6);
  });
});

describe("narrationVolume", () => {
  const plan = (narasi?: { lufs?: number; channels?: number }) =>
    parseScenePlan({
      version: 1,
      projectId: "uji-narasi",
      meta: { title: "Uji", loudnessTarget: -16 },
      scenes: [{ id: "a", narration: "Halo.", visual: { type: "solid" }, duration: 5 }],
      renderState: {
        narrationAudio: {
          a: { file: "audio/a.wav", durationSec: 4, ...narasi },
        },
        resolvedAssets: {},
      },
    });

  /**
   * Narasi adalah sumber yang PALING penting untuk disamakan — semua level
   * lain ditata relatif terhadapnya. Sempat tidak dinormalisasi sama sekali:
   * tahap ukur menuliskan angkanya, tapi tidak ada satu pun yang membacanya.
   */
  it("narasi ikut dinormalisasi ke sasaran proyek", () => {
    const p = plan({ lufs: -26, channels: 2 });
    expect(narrationVolume(p, p.renderState.narrationAudio.a)).toBeCloseTo(
      10 ** (10 / 20),
      5,
    );
  });

  it("narasi mono dikoreksi 3,01 LU — TTS hampir selalu mono", () => {
    const p = plan({ lufs: -26, channels: 1 });
    expect(narrationVolume(p, p.renderState.narrationAudio.a)).toBeCloseTo(
      10 ** ((10 - 3.01) / 20),
      4,
    );
  });

  it("tanpa hasil ukur, narasi dipakai apa adanya", () => {
    const p = plan();
    expect(narrationVolume(p, p.renderState.narrationAudio.a)).toBe(1);
    expect(narrationVolume(p, undefined)).toBe(1);
  });
});

describe("duckAt", () => {
  it("penuh di tengah narasi, pulih di luar jangkauan landai", () => {
    const windows = [{ from: 100, to: 200 }];
    expect(duckAt(150, windows)).toBeCloseTo(DUCK_FACTOR, 5);
    expect(duckAt(100 - DUCK_RAMP_FRAMES - 1, windows)).toBe(1);
    expect(duckAt(200 + DUCK_RAMP_FRAMES + 1, windows)).toBe(1);
  });

  it("landai masuk dan keluar bergerak mulus, tidak melompat", () => {
    const windows = [{ from: 100, to: 200 }];
    let sebelumnya = 1;
    for (let frame = 100 - DUCK_RAMP_FRAMES; frame <= 100; frame++) {
      const nilai = duckAt(frame, windows);
      expect(nilai).toBeLessThanOrEqual(sebelumnya + 1e-9);
      expect(sebelumnya - nilai).toBeLessThan(0.15); // tanpa patahan
      sebelumnya = nilai;
    }
    expect(sebelumnya).toBeCloseTo(DUCK_FACTOR, 5);
  });

  /**
   * Dua narasi berdekatan: yang diambil harus yang PALING dalam, bukan yang
   * terakhir diperiksa. Kalau tidak, musik akan naik sebentar di celah antara
   * dua kalimat — terdengar seperti kesalahan mixing.
   */
  it("dua jendela bertumpang mengambil ducking terdalam", () => {
    const windows = [
      { from: 100, to: 150 },
      { from: 155, to: 200 },
    ];
    for (let frame = 145; frame <= 160; frame++) {
      expect(duckAt(frame, windows)).toBeLessThan(0.6);
    }
  });
});

describe("duckWindows", () => {
  const plan = (over: { narasiTerpasang?: boolean } = {}) =>
    parseScenePlan({
      version: 1,
      projectId: "uji-duck",
      meta: { title: "Uji Duck" },
      scenes: [
        { id: "a", narration: "", visual: { type: "solid" }, duration: 4 },
        { id: "b", narration: "Ada suaranya.", visual: { type: "solid" }, duration: 6 },
        { id: "c", narration: "Naskahnya saja.", visual: { type: "solid" }, duration: 4 },
      ],
      renderState: {
        narrationAudio: over.narasiTerpasang
          ? {
              b: { file: "audio/b.wav", durationSec: 6 },
              c: { file: "audio/c.wav", durationSec: 4 },
            }
          : { b: { file: "audio/b.wav", durationSec: 6 } },
        resolvedAssets: {},
      },
    });

  /**
   * Scene yang naskahnya sudah ditulis tapi suaranya BELUM dibuat tidak boleh
   * menduck apa pun: di video itu terdengar sebagai lubang tanpa sebab —
   * musiknya mengecil, dan tidak ada yang berbicara.
   */
  it("hanya scene yang naskah DAN berkas narasinya ada yang menduck", () => {
    const layout = computeFrameLayout(plan());
    const windows = duckWindows(plan(), layout);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toEqual({
      from: layout.sceneStarts[1],
      to: (layout.sceneStarts[1] ?? 0) + (layout.sceneFrames[1] ?? 0),
    });
  });

  it("begitu berkasnya ada, scene itu ikut menduck", () => {
    const dengan = plan({ narasiTerpasang: true });
    expect(duckWindows(dengan, computeFrameLayout(dengan))).toHaveLength(2);
  });
});

describe("isSilent", () => {
  it("hanya volume nol yang dianggap bisu", () => {
    expect(isSilent(SILENT_CLIP_AUDIO)).toBe(true);
    expect(isSilent(audio({ volume: 0.01 }))).toBe(false);
  });
});
