import type { WordTimestamp } from "@dalang/core";
import type { TtsProvider } from "@dalang/pipeline";
import { type FetchImpl, fetchJson } from "../http";

/**
 * ElevenLabs — primary TTS per PRD §4.2 (best Indonesian quality).
 * Uses the `with-timestamps` endpoint: character-level alignment is grouped
 * into word timestamps here (native, audio-relative — the core contract),
 * so no forced alignment is needed (R-3).
 */

export const ELEVENLABS_DEFAULT_MODEL = "eleven_multilingual_v2";

/**
 * Rough per-character cost for observability only (~Creator tier); actual
 * pricing depends on subscription. Recorded in the stage ledger, surfaced in
 * summaries — never used for billing decisions.
 */
export const ELEVENLABS_ESTIMATED_USD_PER_CHAR = 0.00011;

export interface ElevenLabsAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

interface ElevenLabsResponse {
  audio_base64: string;
  alignment: ElevenLabsAlignment | null;
  normalized_alignment?: ElevenLabsAlignment | null;
}

/** Group character-level alignment into word timestamps (whitespace splits). */
export const charAlignmentToWords = (alignment: ElevenLabsAlignment): WordTimestamp[] => {
  const words: WordTimestamp[] = [];
  let chars: string[] = [];
  let startSec: number | null = null;
  let endSec = 0;

  const flush = () => {
    if (chars.length === 0 || startSec === null) return;
    words.push({
      word: chars.join(""),
      startSec: Number(startSec.toFixed(3)),
      endSec: Number(endSec.toFixed(3)),
    });
    chars = [];
    startSec = null;
  };

  alignment.characters.forEach((char, index) => {
    if (/\s/.test(char)) {
      flush();
      return;
    }
    startSec ??= alignment.character_start_times_seconds[index] ?? 0;
    endSec = alignment.character_end_times_seconds[index] ?? endSec;
    chars.push(char);
  });
  flush();
  return words;
};

export interface ElevenLabsOptions {
  apiKey: string;
  modelId?: string;
  baseUrl?: string;
  fetchImpl?: FetchImpl;
}

export const createElevenLabsTts = ({
  apiKey,
  modelId = ELEVENLABS_DEFAULT_MODEL,
  baseUrl = "https://api.elevenlabs.io",
  fetchImpl,
}: ElevenLabsOptions): TtsProvider => ({
  id: "elevenlabs",
  label: "ElevenLabs",
  placeholderQuality: false,
  synthesize: async (request) => {
    const url =
      `${baseUrl}/v1/text-to-speech/${encodeURIComponent(request.voiceId)}` +
      `/with-timestamps?output_format=mp3_44100_128`;
    const body: Record<string, unknown> = {
      text: request.text,
      model_id: modelId,
    };
    if (request.speed !== 1) {
      body.voice_settings = { speed: request.speed };
    }

    const json = await fetchJson<ElevenLabsResponse>(
      url,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      "ElevenLabs",
      { fetchImpl, timeoutMs: 90_000 },
    );

    const alignment = json.alignment ?? json.normalized_alignment;
    if (!alignment) {
      throw new Error("ElevenLabs tidak mengembalikan alignment timestamps");
    }
    const wordTimestamps = charAlignmentToWords(alignment);
    const durationSec =
      alignment.character_end_times_seconds.at(-1) ?? wordTimestamps.at(-1)?.endSec ?? 0;
    if (durationSec <= 0) {
      throw new Error("ElevenLabs mengembalikan audio berdurasi nol");
    }

    return {
      audio: new Uint8Array(Buffer.from(json.audio_base64, "base64")),
      format: "mp3",
      durationSec,
      wordTimestamps,
      timestampsSource: "native",
      costUsd: request.text.length * ELEVENLABS_ESTIMATED_USD_PER_CHAR,
    };
  },
});
