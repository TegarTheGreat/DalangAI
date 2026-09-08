import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDeepgramAsr,
  createElevenLabsScribeAsr,
  createWhisperCppAsr,
  findWhisperCpp,
  logprobToConfidence,
  speakerLabel,
  tokensToWords,
} from "../src/index";

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

// ---------------------------------------------------------------------------
// whisper.cpp — jalur offline
// ---------------------------------------------------------------------------

describe("tokensToWords", () => {
  const at = (from: number, to: number) => ({ from, to });

  it("menyambung token sub-kata jadi satu kata", () => {
    // Ini alasan fungsi ini ada: whisper memberi waktu per TOKEN, dan
    // "Borobudur" keluar terpecah. Menyerahkannya apa adanya membuat caption
    // tercacah dan pencarian frasa gagal.
    const words = tokensToWords([
      { text: " Boro", offsets: at(1000, 1400) },
      { text: "budur", offsets: at(1400, 1900) },
      { text: " megah", offsets: at(2000, 2400) },
    ]);
    expect(words.map((w) => w.word)).toEqual(["Borobudur", "megah"]);
    expect(words[0]).toMatchObject({ startSec: 1, endSec: 1.9 });
  });

  it("membuang token khusus whisper", () => {
    const words = tokensToWords([
      { text: "[_BEG_]", offsets: at(0, 0) },
      { text: " halo", offsets: at(100, 400) },
      { text: "[_TT_110]", offsets: at(400, 400) },
    ]);
    expect(words.map((w) => w.word)).toEqual(["halo"]);
  });

  it("membawa keyakinan dan label pembicara kalau ada", () => {
    const words = tokensToWords([{ text: " ya", offsets: at(0, 300), p: 0.9 }], "A");
    expect(words[0]).toMatchObject({ confidence: 0.9, speaker: "A" });
  });

  it("token pertama dianggap awal kata walau tanpa spasi di depan", () => {
    expect(tokensToWords([{ text: "Halo", offsets: at(0, 300) }])[0]?.word).toBe("Halo");
  });
});

describe("findWhisperCpp", () => {
  it("mengembalikan null kalau binari yang diminta tidak ada — bukan melempar", () => {
    // Tidak terpasang adalah KONDISI NORMAL: rantainya cukup melanjutkan.
    expect(
      findWhisperCpp({ WHISPER_CPP_BIN: "/tidak/ada/whisper", WHISPER_CPP_MODEL: "/x" }),
    ).toBeNull();
  });

  it("mengembalikan null kalau binari ada tapi modelnya tidak", () => {
    expect(
      findWhisperCpp({ WHISPER_CPP_BIN: "/bin/sh", WHISPER_CPP_MODEL: "/tidak/ada.bin" }),
    ).toBeNull();
  });

  it("menerima pasangan binari+model yang keduanya ada", () => {
    expect(
      findWhisperCpp({ WHISPER_CPP_BIN: "/bin/sh", WHISPER_CPP_MODEL: "/bin/sh" }),
    ).toEqual({ binPath: "/bin/sh", modelPath: "/bin/sh" });
  });
});

describe("createWhisperCppAsr", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "dalang-whisper-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("membaca keluaran JSON dan menyusun kata + segmen", async () => {
    const media = join(dir, "wawancara.wav");
    writeFileSync(media, "");
    const provider = createWhisperCppAsr({
      binPath: "/bin/true",
      modelPath: "/model/ggml-base.bin",
      runner: async () => {
        writeFileSync(
          `${media}.dalang-asr.json`,
          JSON.stringify({
            result: { language: "id" },
            transcription: [
              {
                offsets: { from: 0, to: 2000 },
                text: " Harga emas naik.",
                tokens: [
                  { text: " Harga", offsets: { from: 0, to: 500 } },
                  { text: " emas", offsets: { from: 500, to: 1200 } },
                  { text: " naik", offsets: { from: 1200, to: 2000 } },
                ],
              },
            ],
          }),
        );
      },
    });

    const result = await provider.transcribe({
      file: media,
      language: "id",
      diarize: false,
    });
    expect(result.words.map((w) => w.word)).toEqual(["Harga", "emas", "naik"]);
    expect(result.segments).toEqual([
      { startSec: 0, endSec: 2, text: "Harga emas naik." },
    ]);
    expect(result.language).toBe("id");
    expect(result.durationSec).toBe(2);
    expect(result.costUsd).toBe(0);
    expect(provider.offline).toBe(true);
  });

  it("gagal dengan pesan kalau binari tidak menulis JSON", async () => {
    const media = join(dir, "sepi.wav");
    writeFileSync(media, "");
    const provider = createWhisperCppAsr({
      binPath: "/bin/true",
      modelPath: "/m.bin",
      runner: async () => undefined,
    });
    await expect(
      provider.transcribe({ file: media, language: "id", diarize: false }),
    ).rejects.toThrow(/tidak menulis/);
  });
});

// ---------------------------------------------------------------------------
// Deepgram
// ---------------------------------------------------------------------------

describe("speakerLabel", () => {
  it("mengubah indeks jadi huruf dan membiarkan undefined apa adanya", () => {
    expect(speakerLabel(0)).toBe("A");
    expect(speakerLabel(1)).toBe("B");
    expect(speakerLabel(undefined)).toBeUndefined();
  });
});

describe("createDeepgramAsr", () => {
  const body = {
    metadata: { duration: 12.5 },
    results: {
      channels: [
        {
          alternatives: [
            {
              transcript: "Halo semua.",
              words: [
                {
                  word: "halo",
                  punctuated_word: "Halo",
                  start: 0.1,
                  end: 0.5,
                  confidence: 0.99,
                  speaker: 0,
                },
                {
                  word: "semua",
                  punctuated_word: "semua.",
                  start: 0.6,
                  end: 1.2,
                  speaker: 1,
                },
              ],
            },
          ],
        },
      ],
      utterances: [{ start: 0.1, end: 1.2, transcript: "Halo semua.", speaker: 0 }],
    },
  };

  const provider = (fetchImpl: typeof fetch) =>
    createDeepgramAsr({ apiKey: "k", fetchImpl, readFile: () => new Uint8Array([1, 2]) });

  it("memakai kata berpunktuasi dan memetakan pembicara jadi huruf", async () => {
    const result = await provider(async () => jsonResponse(body)).transcribe({
      file: "/x/a.mp3",
      language: "id",
      diarize: true,
    });
    expect(result.words).toEqual([
      { word: "Halo", startSec: 0.1, endSec: 0.5, confidence: 0.99, speaker: "A" },
      { word: "semua.", startSec: 0.6, endSec: 1.2, speaker: "B" },
    ]);
    expect(result.segments[0]).toMatchObject({ text: "Halo semua.", speaker: "A" });
    expect(result.durationSec).toBe(12.5);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it("mengirim diarize hanya saat diminta, dan bahasa saat ada", async () => {
    const urls: string[] = [];
    const catcher: typeof fetch = async (url) => {
      urls.push(String(url));
      return jsonResponse(body);
    };
    await provider(catcher).transcribe({
      file: "/x/a.mp3",
      language: "id",
      diarize: false,
    });
    await provider(catcher).transcribe({ file: "/x/a.mp3", language: "", diarize: true });
    expect(urls[0]).toContain("language=id");
    expect(urls[0]).not.toContain("diarize");
    expect(urls[1]).toContain("diarize=true");
    expect(urls[1]).not.toContain("language=");
  });

  it("GAGAL DENGAN PESAN kalau bentuk responsnya tidak dikenali", async () => {
    // Kontrak vendor tidak bisa diverifikasi dari lingkungan repo ini, jadi
    // ini justru perilaku yang paling penting: bentuk yang meleset harus
    // berhenti di sini, bukan lolos jadi transkrip kosong di dalam plan.
    const rusak = provider(async () => jsonResponse({ results: { channels: [] } }));
    await expect(
      rusak.transcribe({ file: "/x/a.mp3", language: "id", diarize: false }),
    ).rejects.toThrow(/bentuk yang tidak dikenali/);
  });
});

// ---------------------------------------------------------------------------
// ElevenLabs Scribe
// ---------------------------------------------------------------------------

describe("logprobToConfidence", () => {
  it("mengubah log-probabilitas jadi 0-1 dan menjaga batasnya", () => {
    expect(logprobToConfidence(0)).toBe(1);
    expect(logprobToConfidence(-1)).toBeCloseTo(0.3679, 3);
    expect(logprobToConfidence(undefined)).toBeUndefined();
  });
});

describe("createElevenLabsScribeAsr", () => {
  const provider = (fetchImpl: typeof fetch) =>
    createElevenLabsScribeAsr({
      apiKey: "k",
      fetchImpl,
      readFile: () => new Uint8Array([1]),
    });

  it("menyaring entri spasi dan peristiwa audio", async () => {
    // Tanpa penyaringan ini, caption akan berisi kata kosong dan "(laughs)".
    const result = await provider(async () =>
      jsonResponse({
        language_code: "id",
        words: [
          { text: "Halo", start: 0, end: 0.4, type: "word", speaker_id: "speaker_0" },
          { text: " ", start: 0.4, end: 0.45, type: "spacing" },
          { text: "(laughs)", start: 0.5, end: 1, type: "audio_event" },
          { text: "dunia", start: 1.1, end: 1.6, type: "word", logprob: -0.2 },
        ],
      }),
    ).transcribe({ file: "/x/a.mp3", language: "id", diarize: true });

    expect(result.words.map((w) => w.word)).toEqual(["Halo", "dunia"]);
    expect(result.words[0]?.speaker).toBe("speaker_0");
    expect(result.words[1]?.confidence).toBeCloseTo(0.8187, 3);
    expect(result.language).toBe("id");
    // Durasi memakai entri TERAKHIR apa pun jenisnya — peristiwa audio pun
    // menandai bahwa rekamannya masih berjalan sampai situ.
    expect(result.durationSec).toBe(1.6);
  });

  it("memperlakukan entri tanpa type sebagai kata", async () => {
    // Bentuk lama API-nya tidak memberi `type`; menganggapnya bukan-kata akan
    // membuang seluruh transkrip tanpa satu pun galat.
    const result = await provider(async () =>
      jsonResponse({ words: [{ text: "satu", start: 0, end: 0.5 }] }),
    ).transcribe({ file: "/x/a.mp3", language: "id", diarize: false });
    expect(result.words.map((w) => w.word)).toEqual(["satu"]);
  });

  it("GAGAL DENGAN PESAN kalau bentuk responsnya tidak dikenali", async () => {
    const rusak = provider(async () => jsonResponse({ transcript: "halo" }));
    await expect(
      rusak.transcribe({ file: "/x/a.mp3", language: "id", diarize: false }),
    ).rejects.toThrow(/bentuk yang tidak dikenali/);
  });
});
