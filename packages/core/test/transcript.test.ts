import { describe, expect, it } from "vitest";
import {
  FILLER_WORDS,
  findFillerSpans,
  findPhraseSpans,
  parseScenePlan,
  setClipAsset,
  setTranscript,
  speechSpans,
  type Transcript,
  textInSpan,
  transcriptForClip,
  transcriptForScene,
  transcriptToWordTimestamps,
  wordsInSpan,
} from "../src/index";

const words = (
  spec: [word: string, startSec: number, endSec: number][],
): Transcript["words"] =>
  spec.map(([word, startSec, endSec]) => ({ word, startSec, endSec }));

const transcript = (spec: Parameters<typeof words>[0], durationSec = 60): Transcript => ({
  source: "uji",
  language: "id",
  durationSec,
  words: words(spec),
  segments: [],
});

describe("wordsInSpan", () => {
  const t = transcript([
    ["Borobudur", 1, 2],
    ["dibangun", 2, 3],
    ["abad", 3, 3.5],
    ["kesembilan", 3.5, 4.5],
  ]);

  it("mengambil kata yang tumpang tindih dengan rentang, bukan hanya yang termuat penuh", () => {
    // "dibangun" (2-3) hanya menyentuh rentang 2.5-3.2 sebagian; ia tetap ikut,
    // karena kata yang terpotong separuh tetap terdengar di potongan itu.
    expect(wordsInSpan(t, 2.5, 3.2).map((w) => w.word)).toEqual(["dibangun", "abad"]);
  });

  it("mengembalikan kosong untuk rentang di luar rekaman", () => {
    expect(wordsInSpan(t, 10, 20)).toEqual([]);
  });

  it("tidak mengambil kata yang berakhir tepat di batas awal", () => {
    expect(wordsInSpan(t, 2, 3).map((w) => w.word)).toEqual(["dibangun"]);
  });
});

describe("textInSpan", () => {
  it("merangkai kata jadi teks dan merapatkan tanda baca", () => {
    const t = transcript([
      ["Halo", 0, 0.5],
      [",", 0.5, 0.5],
      ["dunia", 0.6, 1.1],
    ]);
    expect(textInSpan(t, 0, 2)).toBe("Halo, dunia");
  });
});

describe("transcriptToWordTimestamps", () => {
  const t = transcript([
    ["satu", 10, 10.4],
    ["dua", 10.5, 11],
    ["tiga", 11.2, 11.9],
  ]);

  it("menggeser waktu rekaman jadi waktu scene", () => {
    expect(transcriptToWordTimestamps(t, 10, 12)).toEqual([
      { word: "satu", startSec: 0, endSec: 0.4 },
      { word: "dua", startSec: 0.5, endSec: 1 },
      { word: "tiga", startSec: 1.2, endSec: 1.9 },
    ]);
  });

  it("memotong kata yang melewati batas akhir alih-alih membuangnya", () => {
    // Potongan berhenti di 11.5, di tengah "tiga". Kata itu tetap tampil,
    // berakhir tepat di ujung potongan.
    const out = transcriptToWordTimestamps(t, 10, 11.5);
    expect(out.at(-1)).toEqual({ word: "tiga", startSec: 1.2, endSec: 1.5 });
  });

  it("membagi waktu dengan visual.speed — caption tidak tertinggal dari suara", () => {
    // Rekaman diputar 2x: kata di detik 11.2 rekaman terdengar di detik 0.6
    // scene, bukan 1.2. Tanpa pembagian ini caption makin lama makin melenceng.
    expect(transcriptToWordTimestamps(t, 10, 12, { speed: 2 })).toEqual([
      { word: "satu", startSec: 0, endSec: 0.2 },
      { word: "dua", startSec: 0.25, endSec: 0.5 },
      { word: "tiga", startSec: 0.6, endSec: 0.95 },
    ]);
  });

  it("speed nol atau negatif diperlakukan sebagai 1, bukan membagi nol", () => {
    expect(transcriptToWordTimestamps(t, 10, 12, { speed: 0 })).toEqual(
      transcriptToWordTimestamps(t, 10, 12),
    );
  });

  it("tidak pernah menghasilkan waktu negatif walau potongan mulai setelah kata", () => {
    const out = transcriptToWordTimestamps(t, 10.6, 12);
    expect(out.every((w) => w.startSec >= 0 && w.endSec >= 0)).toBe(true);
  });
});

describe("findFillerSpans", () => {
  it("menangkap bunyi ragu satu kata", () => {
    const t = transcript([
      ["Jadi", 0, 0.4],
      ["emm", 0.5, 0.9],
      ["begini", 1, 1.5],
    ]);
    expect(findFillerSpans(t)).toEqual([{ startSec: 0.5, endSec: 0.9, text: "emm" }]);
  });

  it("menangkap pengisi dua kata sebagai satu rentang", () => {
    const t = transcript([
      ["Ini", 0, 0.3],
      ["apa", 0.4, 0.7],
      ["ya", 0.7, 0.9],
      ["namanya", 1, 1.6],
    ]);
    expect(findFillerSpans(t)).toEqual([{ startSec: 0.4, endSec: 0.9, text: "apa ya" }]);
  });

  it("menangkap kata yang langsung terulang", () => {
    const t = transcript([
      ["saya", 0, 0.3],
      ["saya", 0.35, 0.65],
      ["mau", 0.7, 1],
    ]);
    expect(findFillerSpans(t)).toEqual([{ startSec: 0.35, endSec: 0.65, text: "saya" }]);
  });

  it("TIDAK membuang kata bermakna yang sering disangka pengisi", () => {
    // Ini yang membedakan daftar konservatif dari daftar rakus: ketiganya
    // membawa arti di kalimat ini, dan menghapusnya merusak kalimatnya.
    const t = transcript([
      ["kayak", 0, 0.3],
      ["gini", 0.4, 0.7],
      ["terus", 0.8, 1.1],
      ["dipanaskan", 1.2, 2],
      ["jadi", 2.1, 2.4],
      ["matang", 2.5, 3],
    ]);
    expect(findFillerSpans(t)).toEqual([]);
    for (const word of ["kayak", "terus", "jadi"]) {
      expect(FILLER_WORDS as readonly string[]).not.toContain(word);
    }
  });

  it("mengabaikan tanda baca dan huruf besar saat mencocokkan", () => {
    const t = transcript([
      ["Ehm,", 0, 0.4],
      ["oke", 0.5, 0.9],
    ]);
    expect(findFillerSpans(t)).toHaveLength(1);
  });
});

describe("findPhraseSpans", () => {
  const t = transcript([
    ["harga", 0, 0.4],
    ["emas", 0.5, 0.9],
    ["naik", 1, 1.3],
    ["lalu", 2, 2.3],
    ["harga", 3, 3.4],
    ["emas", 3.5, 3.9],
    ["turun", 4, 4.4],
  ]);

  it("menemukan semua kemunculan frasa beruntun", () => {
    const spans = findPhraseSpans(t, "harga emas");
    expect(spans).toHaveLength(2);
    expect(spans[0]).toMatchObject({ startSec: 0, endSec: 0.9 });
    expect(spans[1]).toMatchObject({ startSec: 3, endSec: 3.9 });
  });

  it("tidak cocok kalau kata-katanya tidak beruntun", () => {
    // "emas" lalu "lalu" dipisahkan "naik" — pencocokan beruntun menolaknya,
    // sementara "emas naik" dan "emas turun" (keduanya beruntun) cocok.
    expect(findPhraseSpans(t, "emas lalu")).toEqual([]);
    expect(findPhraseSpans(t, "emas naik")).toHaveLength(1);
    expect(findPhraseSpans(t, "emas turun")).toHaveLength(1);
  });

  it("padSec melebarkan rentang tapi tidak keluar dari rekaman", () => {
    const spans = findPhraseSpans(t, "harga emas", { padSec: 5 });
    expect(spans[0]?.startSec).toBe(0);
    expect(spans[0]?.endSec).toBe(5.9);
    const pendek = transcript([["halo", 0, 1]], 1.5);
    expect(findPhraseSpans(pendek, "halo", { padSec: 9 })[0]?.endSec).toBe(1.5);
  });

  it("frasa kosong tidak mencocokkan apa pun", () => {
    expect(findPhraseSpans(t, "   ")).toEqual([]);
  });
});

describe("speechSpans", () => {
  it("memecah di celah antar kata yang melebihi ambang", () => {
    const t = transcript([
      ["kalimat", 0, 0.5],
      ["pertama", 0.6, 1.2],
      ["kalimat", 3, 3.5],
      ["kedua", 3.6, 4.1],
    ]);
    const spans = speechSpans(t);
    expect(spans).toHaveLength(2);
    expect(spans[0]).toEqual({ startSec: 0, endSec: 1.2, text: "kalimat pertama" });
    expect(spans[1]).toEqual({ startSec: 3, endSec: 4.1, text: "kalimat kedua" });
  });

  it("tidak memecah pada jeda napas di tengah kalimat", () => {
    const t = transcript([
      ["napas", 0, 0.5],
      ["pendek", 1.05, 1.6],
    ]);
    expect(speechSpans(t)).toHaveLength(1);
  });

  it("ambang celah bisa disetel pemanggil", () => {
    const t = transcript([
      ["a", 0, 0.2],
      ["b", 0.6, 0.8],
    ]);
    expect(speechSpans(t, { gapSec: 0.3 })).toHaveLength(2);
    expect(speechSpans(t, { gapSec: 1 })).toHaveLength(1);
  });

  it("transkrip kosong menghasilkan nol rentang", () => {
    expect(speechSpans(transcript([]))).toEqual([]);
  });
});

/**
 * Transkrip dicari lewat BERKAS, dan berkas melekat pada KLIP (ADR-0033).
 *
 * Scene berklip banyak boleh memakai dua rekaman berbeda; pencarian yang cuma
 * mengenal potongan pertama akan menjawab transkrip yang SALAH untuk potongan
 * kedua — dan jawaban yang salah jauh lebih mahal daripada tidak ada jawaban,
 * karena isinya terbaca masuk akal.
 */
describe("transcriptForClip / transcriptForScene", () => {
  const duaRekaman = () => {
    let plan = parseScenePlan({
      version: 2,
      projectId: "uji-transkrip",
      meta: { title: "Uji" },
      audio: {},
      scenes: [
        {
          id: "sc-001",
          narration: "Dua potongan.",
          clips: [
            { id: "sc-001-k1", type: "stock", durationSec: 3 },
            { id: "sc-001-k2", type: "stock", durationSec: 3 },
          ],
        },
      ],
    });
    plan = setClipAsset(plan, "sc-001-k1", {
      file: "media/a.mp4",
      kind: "video",
      source: "local",
    });
    plan = setClipAsset(plan, "sc-001-k2", {
      file: "media/b.mp4",
      kind: "video",
      source: "local",
    });
    plan = setTranscript(plan, "media/a.mp4", transcript([["pertama", 0, 1]]));
    plan = setTranscript(plan, "media/b.mp4", transcript([["kedua", 0, 1]]));
    return plan;
  };

  it("menjawab transkrip berkas milik klip yang diminta", () => {
    const plan = duaRekaman();
    expect(transcriptForClip(plan, "sc-001-k1")?.words[0]?.word).toBe("pertama");
    expect(transcriptForClip(plan, "sc-001-k2")?.words[0]?.word).toBe("kedua");
  });

  it("lewat scene tetap menjawab potongan PERTAMA, apa adanya", () => {
    expect(transcriptForScene(duaRekaman(), "sc-001")?.words[0]?.word).toBe("pertama");
  });

  it("klip tanpa berkas menjawab undefined, bukan transkrip tetangganya", () => {
    const plan = duaRekaman();
    expect(transcriptForClip(plan, "klip-yang-tidak-ada")).toBeUndefined();
  });
});
