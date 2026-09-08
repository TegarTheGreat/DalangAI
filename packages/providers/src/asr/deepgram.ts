import { readFileSync } from "node:fs";
import { extname } from "node:path";
import type { AsrProvider, AsrResult } from "@dalang/pipeline";
import { z } from "zod";
import { type FetchImpl, fetchJson } from "../http";

/**
 * Deepgram — jalur ASR API (ADR-0021).
 *
 * BENTUK RESPONS DIVALIDASI, BUKAN DIPERCAYA. Dokumen vendor tidak bisa
 * dijangkau dari lingkungan kerja repo ini, jadi bentuk di bawah disusun dari
 * rujukan publik dan divalidasi Zod di jalur panas. Kalau Deepgram mengembalikan
 * sesuatu yang lain, provider ini GAGAL DENGAN PESAN — bukan diam-diam
 * menghasilkan transkrip kosong yang lolos ke plan dan baru ketahuan saat
 * caption tidak muncul (PRD §10: tidak ada kegagalan senyap).
 */

const wordSchema = z.object({
  word: z.string(),
  start: z.number(),
  end: z.number(),
  confidence: z.number().optional(),
  /** Ada saat smart_format aktif: kata yang sudah berpunktuasi dan berkapital. */
  punctuated_word: z.string().optional(),
  /** Ada saat diarize aktif: indeks pembicara. */
  speaker: z.number().optional(),
});

const deepgramSchema = z.object({
  metadata: z.object({ duration: z.number().optional() }).optional(),
  results: z.object({
    channels: z
      .array(
        z.object({
          alternatives: z
            .array(
              z.object({ transcript: z.string().optional(), words: z.array(wordSchema) }),
            )
            .min(1),
        }),
      )
      .min(1),
    utterances: z
      .array(
        z.object({
          start: z.number(),
          end: z.number(),
          transcript: z.string(),
          speaker: z.number().optional(),
        }),
      )
      .optional(),
  }),
});

const MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

/**
 * Perkiraan kasar untuk ledger biaya saja (kelas harga pay-as-you-go);
 * harga sebenarnya bergantung paket. Tidak pernah dipakai untuk keputusan
 * penagihan — sama seperti angka di provider TTS.
 */
export const DEEPGRAM_ESTIMATED_USD_PER_MINUTE = 0.0043;

export interface DeepgramOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: FetchImpl;
  /** Disuntikkan tes supaya berkas tidak perlu benar-benar ada. */
  readFile?: (path: string) => Uint8Array;
}

/** Label pembicara dijadikan huruf ("A", "B") — yang muncul di UI dan prompt. */
export const speakerLabel = (index: number | undefined): string | undefined =>
  index === undefined ? undefined : String.fromCharCode(65 + (index % 26));

export const createDeepgramAsr = ({
  apiKey,
  model = "nova-3",
  baseUrl = "https://api.deepgram.com",
  fetchImpl,
  readFile = (path) => new Uint8Array(readFileSync(path)),
}: DeepgramOptions): AsrProvider => ({
  id: "deepgram",
  label: `Deepgram (${model})`,
  offline: false,
  transcribe: async (request) => {
    const params = new URLSearchParams({
      model,
      smart_format: "true",
      punctuate: "true",
      utterances: "true",
    });
    if (request.language !== "") params.set("language", request.language);
    if (request.diarize) params.set("diarize", "true");

    const bytes = readFile(request.file);
    const json = await fetchJson<unknown>(
      `${baseUrl}/v1/listen?${params.toString()}`,
      {
        method: "POST",
        headers: {
          authorization: `Token ${apiKey}`,
          "content-type":
            MIME[extname(request.file).toLowerCase()] ?? "application/octet-stream",
        },
        body: bytes as unknown as BodyInit,
      },
      "Deepgram",
      // Rekaman panjang butuh waktu; batas 30 detik bawaan terlalu pendek.
      { fetchImpl, timeoutMs: 600_000 },
    );

    const parsed = deepgramSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(
        `Deepgram mengembalikan bentuk yang tidak dikenali: ${parsed.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("; ")}`,
      );
    }

    const alternative = parsed.data.results.channels[0]?.alternatives[0];
    if (!alternative)
      throw new Error("Deepgram tidak mengembalikan alternatif transkrip");

    const words: AsrResult["words"] = alternative.words.map((word) => ({
      word: word.punctuated_word ?? word.word,
      startSec: Number(word.start.toFixed(3)),
      endSec: Number(word.end.toFixed(3)),
      ...(word.confidence !== undefined ? { confidence: word.confidence } : {}),
      ...(speakerLabel(word.speaker) !== undefined
        ? { speaker: speakerLabel(word.speaker) as string }
        : {}),
    }));

    const segments: AsrResult["segments"] = (parsed.data.results.utterances ?? []).map(
      (utterance) => ({
        startSec: Number(utterance.start.toFixed(3)),
        endSec: Number(utterance.end.toFixed(3)),
        text: utterance.transcript,
        ...(speakerLabel(utterance.speaker) !== undefined
          ? { speaker: speakerLabel(utterance.speaker) as string }
          : {}),
      }),
    );

    const durationSec = parsed.data.metadata?.duration ?? words.at(-1)?.endSec ?? 0;
    return {
      words,
      segments,
      language: request.language,
      durationSec,
      costUsd: (durationSec / 60) * DEEPGRAM_ESTIMATED_USD_PER_MINUTE,
    };
  },
});
