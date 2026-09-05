import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { AsrProvider, AsrResult } from "@dalang/pipeline";
import { z } from "zod";
import { type FetchImpl, fetchJson } from "../http";

/**
 * ElevenLabs Scribe — jalur ASR API kedua (ADR-0021).
 *
 * Ada di rantai karena repo ini SUDAH memakai ELEVENLABS_API_KEY untuk TTS:
 * pemilik yang sudah menyiapkan suara langsung dapat transkripsi tanpa
 * mendaftar layanan baru.
 *
 * Sama seperti provider Deepgram: bentuk responsnya divalidasi Zod dan gagal
 * dengan pesan kalau tidak cocok. Yang khas di sini, `words` memuat tiga jenis
 * entri — `word`, `spacing`, dan `audio_event` (tawa, batuk). Memperlakukan
 * ketiganya sebagai kata akan menghasilkan caption berisi spasi kosong dan
 * "(laughs)" di tengah kalimat, jadi keduanya disaring.
 */

const wordSchema = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
  type: z.enum(["word", "spacing", "audio_event"]).optional(),
  speaker_id: z.string().optional(),
  logprob: z.number().optional(),
});

const scribeSchema = z.object({
  language_code: z.string().optional(),
  text: z.string().optional(),
  words: z.array(wordSchema),
});

export const ELEVENLABS_SCRIBE_MODEL = "scribe_v1";

/**
 * Perkiraan kasar untuk ledger biaya saja; harga sebenarnya tergantung paket.
 * Tidak pernah dipakai untuk keputusan penagihan.
 */
export const SCRIBE_ESTIMATED_USD_PER_MINUTE = 0.006;

export interface ElevenLabsScribeOptions {
  apiKey: string;
  modelId?: string;
  baseUrl?: string;
  fetchImpl?: FetchImpl;
  readFile?: (path: string) => Uint8Array;
}

/**
 * logprob (log-probabilitas, ≤ 0) jadi keyakinan 0-1. Provider lain melaporkan
 * keyakinan langsung; menyamakan satuannya di sini supaya UI dan agent tidak
 * perlu tahu provider mana yang menghasilkannya.
 */
export const logprobToConfidence = (logprob: number | undefined): number | undefined =>
  logprob === undefined ? undefined : Math.min(1, Math.max(0, Math.exp(logprob)));

export const createElevenLabsScribeAsr = ({
  apiKey,
  modelId = ELEVENLABS_SCRIBE_MODEL,
  baseUrl = "https://api.elevenlabs.io",
  fetchImpl,
  readFile = (path) => new Uint8Array(readFileSync(path)),
}: ElevenLabsScribeOptions): AsrProvider => ({
  id: "elevenlabs-scribe",
  label: "ElevenLabs Scribe",
  offline: false,
  transcribe: async (request) => {
    const form = new FormData();
    const bytes = readFile(request.file);
    form.append("file", new Blob([bytes as BlobPart]), basename(request.file));
    form.append("model_id", modelId);
    form.append("timestamps_granularity", "word");
    form.append("diarize", request.diarize ? "true" : "false");
    // Peristiwa non-ucapan tetap diminta supaya bisa DISARING sadar di sini;
    // mematikannya di server berarti kehilangan penanda jeda tawa yang
    // kadang berguna untuk memilih potongan.
    form.append("tag_audio_events", "true");
    if (request.language !== "") form.append("language_code", request.language);

    const json = await fetchJson<unknown>(
      `${baseUrl}/v1/speech-to-text`,
      { method: "POST", headers: { "xi-api-key": apiKey }, body: form },
      "ElevenLabs Scribe",
      { fetchImpl, timeoutMs: 600_000 },
    );

    const parsed = scribeSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(
        `ElevenLabs Scribe mengembalikan bentuk yang tidak dikenali: ${parsed.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("; ")}`,
      );
    }

    const words: AsrResult["words"] = parsed.data.words
      // Entri tanpa `type` diperlakukan sebagai kata: itu bentuk terlama
      // API-nya, dan menganggapnya bukan-kata akan membuang seluruh transkrip.
      .filter((word) => (word.type ?? "word") === "word" && word.text.trim() !== "")
      .map((word) => {
        const confidence = logprobToConfidence(word.logprob);
        return {
          word: word.text.trim(),
          startSec: Number(word.start.toFixed(3)),
          endSec: Number(word.end.toFixed(3)),
          ...(confidence !== undefined ? { confidence } : {}),
          ...(word.speaker_id !== undefined ? { speaker: word.speaker_id } : {}),
        };
      });

    const durationSec = parsed.data.words.at(-1)?.end ?? words.at(-1)?.endSec ?? 0;
    return {
      words,
      // Scribe tidak memberi giliran bicara; segmen dibiarkan kosong dan
      // pemakainya memakai speechSpans() dari celah antar kata.
      segments: [],
      language: parsed.data.language_code ?? request.language,
      durationSec: Number(durationSec.toFixed(3)),
      costUsd: (durationSec / 60) * SCRIBE_ESTIMATED_USD_PER_MINUTE,
    };
  },
});
