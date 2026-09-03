import { parseScenePlan, type ScenePlanInput } from "@dalang/core";
import { describe, expect, it } from "vitest";
import { decodeWav, integratedLoudness, measureWavLoudness } from "../src/loudness";
import { audibleFiles } from "../src/loudness-stage";
import { tinyWav } from "./helpers";

/**
 * ADR-0026: pengukur EBU R128 / ITU-R BS.1770-4.
 *
 * Diuji dengan sinyal yang DIBANGKITKAN di sini, jadi jawabannya diketahui
 * lebih dulu — bukan dibandingkan dengan keluaran implementasi lain, yang cuma
 * membuktikan dua program setuju dan bukan bahwa keduanya benar.
 *
 * Nilai acuannya dari EBU Tech 3341: sinus 1 kHz pada -23 dBFS harus terbaca
 * -23,0 LUFS dengan toleransi 0,1 LU.
 */

/** Sinus murni; amplitudonya dipilih supaya RMS-nya tepat `dbfs`. */
const sine = (dbfs: number, sampleRate = 48000, seconds = 20, freq = 1000) => {
  const amplitude = 10 ** (dbfs / 20) * Math.SQRT2;
  const count = sampleRate * seconds;
  const channel = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    channel[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return { sampleRate, channels: [channel] };
};

describe("integratedLoudness", () => {
  it("sinus 1 kHz -23 dBFS terbaca -23 LUFS (EBU Tech 3341, toleransi 0,1 LU)", () => {
    expect(integratedLoudness(sine(-23)).lufs).toBeCloseTo(-23, 1);
  });

  it("skalanya linear: turun 10 dB = turun 10 LU", () => {
    const keras = integratedLoudness(sine(-20)).lufs as number;
    const pelan = integratedLoudness(sine(-30)).lufs as number;
    expect(keras - pelan).toBeCloseTo(10, 1);
  });

  /**
   * Dua kanal identik menjumlahkan DAYA, bukan amplitudo: +3 LU. Kalau
   * implementasinya keliru merata-ratakan antar kanal, angkanya akan sama
   * dengan mono — dan seluruh materi stereo jadi dinormalisasi 3 dB terlalu
   * keras.
   */
  it("stereo identik = +3 LU dibanding mono", () => {
    const mono = sine(-23);
    const kiri = mono.channels[0] as Float32Array;
    const stereo = integratedLoudness({ sampleRate: 48000, channels: [kiri, kiri] });
    expect(
      (stereo.lufs as number) - (integratedLoudness(mono).lufs as number),
    ).toBeCloseTo(3, 1);
  });

  /**
   * BS.1770 hanya menuliskan koefisien untuk 48 kHz. Kalau koefisien itu
   * dipakai apa adanya pada laju lain, titik potong penapisnya bergeser dan
   * hasilnya meleset — cukup untuk membuat dua berkas yang sama nyaring
   * dinormalisasi ke tempat berbeda.
   */
  it("hasilnya sama di laju cuplik berbeda", () => {
    for (const rate of [44100, 32000, 22050]) {
      expect(integratedLoudness(sine(-23, rate)).lufs).toBeCloseTo(-23, 0);
    }
  });

  it("sunyi menghasilkan null, bukan angka", () => {
    const senyap = { sampleRate: 48000, channels: [new Float32Array(48000 * 5)] };
    expect(integratedLoudness(senyap).lufs).toBeNull();
  });

  /**
   * R128 tidak terdefinisi untuk materi lebih pendek dari satu blok 400 ms;
   * memaksakan angka di situ memberi hasil yang bergantung pada di mana
   * potongannya kebetulan jatuh.
   */
  it("materi lebih pendek dari satu blok 400 ms menghasilkan null", () => {
    expect(integratedLoudness(sine(-23, 48000, 0.2)).lufs).toBeNull();
  });

  /**
   * Gerbang MUTLAK -70 LUFS. Materi yang seluruhnya di bawahnya — room tone,
   * desis pita, mikrofon yang lupa dinyalakan — tidak punya kenyaringan yang
   * bermakna. Kalau gerbang ini dilonggarkan, berkas seperti itu terukur
   * -80 LUFS, lalu normalisasi berusaha menaikkannya 64 dB dan yang naik cuma
   * desisnya.
   */
  it("materi di bawah gerbang mutlak -70 LUFS menghasilkan null", () => {
    expect(integratedLoudness(sine(-80)).lufs).toBeNull();
    // Tepat di atas gerbang masih terukur — gerbangnya membuang yang pelan,
    // bukan semua yang tidak keras.
    expect(integratedLoudness(sine(-60)).lufs).toBeCloseTo(-60, 0);
  });

  it("puncak dilaporkan apa adanya, termasuk yang di atas skala penuh", () => {
    const panas = sine(-3);
    (panas.channels[0] as Float32Array)[100] = 1.4;
    expect(integratedLoudness(panas).peak).toBeCloseTo(1.4, 2);
  });

  /**
   * Gerbang relatif -10 LU membuang bagian yang jauh lebih pelan daripada
   * rata-rata. Tanpa gerbang itu, rekaman yang separuhnya nyaris hening akan
   * terukur jauh lebih pelan daripada yang sebenarnya terdengar — lalu
   * dinaikkan berlebihan oleh normalisasi.
   *
   * Bagian pelannya -45 dBFS, BUKAN hening digital: hening sudah dibuang
   * gerbang MUTLAK -70, jadi memakainya di sini menguji gerbang yang salah.
   * Terbukti begitu: versi pertama tes ini tetap lulus meski gerbang
   * relatifnya dihapus. Dengan -45 dBFS, tanpa gerbang relatif hasilnya
   * -23 LUFS, dengan gerbang relatif -20 LUFS.
   */
  it("bagian sangat pelan tidak menyeret hasil ukur ke bawah", () => {
    const rate = 48000;
    const keras = sine(-20, rate, 10).channels[0] as Float32Array;
    const pelan = sine(-45, rate, 10).channels[0] as Float32Array;
    const gabung = new Float32Array(rate * 20);
    gabung.set(keras, 0);
    gabung.set(pelan, rate * 10);
    expect(integratedLoudness({ sampleRate: rate, channels: [gabung] }).lufs).toBeCloseTo(
      -20,
      0,
    );
  });
});

describe("decodeWav", () => {
  it("membaca WAV PCM 16-bit dan menemukan chunk-nya", () => {
    const audio = decodeWav(tinyWav(1, 8000));
    expect(audio.sampleRate).toBe(8000);
    expect(audio.channels).toHaveLength(1);
    expect(audio.channels[0]?.length).toBe(8000);
  });

  /**
   * WAV yang sah boleh menaruh chunk lain (LIST/bext/fact) SEBELUM `data`.
   * Pembaca yang melompat ke byte 44 akan membaca metadata itu sebagai suara.
   * Berkas dari perekam lapangan dan dari banyak encoder memang berbentuk
   * begitu, jadi ini bukan kasus teoretis.
   */
  it("menemukan data walau ada chunk lain sebelum data", () => {
    const polos = tinyWav(1, 8000);
    // Sisipkan chunk LIST 12 byte tepat setelah header RIFF/WAVE (offset 12).
    const list = new Uint8Array(20);
    list.set([0x4c, 0x49, 0x53, 0x54], 0); // "LIST"
    new DataView(list.buffer).setUint32(4, 12, true);
    const disisipi = new Uint8Array(polos.length + list.length);
    disisipi.set(polos.subarray(0, 12), 0);
    disisipi.set(list, 12);
    disisipi.set(polos.subarray(12), 12 + list.length);

    const audio = decodeWav(disisipi);
    expect(audio.sampleRate).toBe(8000);
    expect(audio.channels[0]?.length).toBe(8000);
    // Isinya sama persis dengan berkas tanpa sisipan — bukan sekadar terbaca.
    expect(Array.from(audio.channels[0]!.subarray(0, 16))).toEqual(
      Array.from(decodeWav(polos).channels[0]!.subarray(0, 16)),
    );
  });

  it("menolak berkas yang bukan WAV, bukan mengembalikan sunyi", () => {
    expect(() => decodeWav(new Uint8Array([1, 2, 3, 4]))).toThrow(/WAV/);
  });

  it("berkas WAV nyata bisa langsung diukur", () => {
    const measured = measureWavLoudness(tinyWav(2, 8000));
    expect(measured.lufs).not.toBeNull();
    expect(measured.durationSec).toBeCloseTo(2, 2);
  });
});

/**
 * Keputusan "apa yang terdengar" adalah tempat paling mudah untuk melewatkan
 * satu sumber diam-diam — dan sumber yang terlewat berarti satu klip yang
 * tidak ikut dinormalisasi, yang cuma ketahuan dengan telinga.
 */
describe("audibleFiles", () => {
  const plan = (over: Partial<ScenePlanInput> = {}) =>
    parseScenePlan({
      version: 2,
      projectId: "uji-0026",
      meta: { title: "Uji Audio" },
      scenes: [
        {
          id: "a",
          narration: "Satu.",
          clips: [{ id: "a-k1", type: "stock", audio: { volume: 0.4 } }],
          duration: 5,
          layers: [{ id: "lap-1", visual: { type: "stock", audio: { volume: 0.3 } } }],
        },
      ],
      renderState: {
        narrationAudio: { a: { file: "audio/a.wav", durationSec: 3 } },
        clipAssets: { "a-k1": { file: "media/a.mp4", kind: "video", source: "pexels" } },
        layerAssets: {
          "lap-1": { file: "media/broll.mp4", kind: "video", source: "pexels" },
        },
      },
      ...over,
    } as ScenePlanInput);

  it("narasi, suara aset, dan suara lapisan semuanya ikut", () => {
    const files = audibleFiles(plan()).map((job) => job.file);
    expect(files).toContain("audio/a.wav");
    expect(files).toContain("media/a.mp4");
    expect(files).toContain("media/broll.mp4");
  });

  it("klip bisu TIDAK diukur — pekerjaan yang hasilnya tidak pernah dipakai", () => {
    const bisu = plan();
    bisu.scenes[0]!.clips[0]!.audio.volume = 0;
    bisu.scenes[0]!.layers[0]!.visual.audio.volume = 0;
    const files = audibleFiles(bisu).map((job) => job.file);
    expect(files).toEqual(["audio/a.wav"]);
  });

  it("satu berkas yang dipakai dua tempat hanya muncul sekali", () => {
    const sama = plan();
    sama.renderState.layerAssets["lap-1"] = {
      ...sama.renderState.clipAssets["a-k1"]!,
    };
    expect(audibleFiles(sama).filter((job) => job.file === "media/a.mp4")).toHaveLength(
      1,
    );
  });

  it("musik pustaka tidak ikut diukur — angkanya sudah dibawa pustakanya", () => {
    const dengan = plan();
    dengan.audio.music = {
      assetId: "pustaka:tenang",
      volume: 0.15,
      ducking: true,
      fadeInSec: 1,
      fadeOutSec: 2,
      normalize: true,
    };
    expect(audibleFiles(dengan).map((job) => job.file)).not.toContain("pustaka:tenang");
  });
});
