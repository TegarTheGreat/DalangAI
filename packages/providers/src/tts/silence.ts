import { estimateNarrationSeconds, estimateWordTimestamps } from "@dalang/core";
import type { TtsProvider } from "@dalang/pipeline";

/**
 * Offline placeholder TTS: silent WAV with deterministic estimated word
 * timestamps. Exists so the whole pipeline (files, durations, captions,
 * muxing) runs end-to-end with zero network/keys — always marked
 * `placeholderQuality`, so the degradation is visible per scene (PRD §7.2:
 * no silent degradation… even when the audio itself is silence).
 */

const SAMPLE_RATE = 24_000;
const MIN_DURATION_SEC = 0.8;

/** Valid 16-bit mono PCM WAV of silence. */
export const makeSilentWav = (
  durationSec: number,
  sampleRate = SAMPLE_RATE,
): Uint8Array => {
  const numSamples = Math.max(1, Math.round(durationSec * sampleRate));
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);
  return new Uint8Array(buffer);
};

export const createSilenceTts = (): TtsProvider => ({
  id: "silence",
  label: "Silence (placeholder offline)",
  placeholderQuality: true,
  synthesize: (request) => {
    const durationSec = Math.max(
      estimateNarrationSeconds(request.text, request.speed),
      MIN_DURATION_SEC,
    );
    return Promise.resolve({
      audio: makeSilentWav(durationSec),
      format: "wav" as const,
      durationSec,
      wordTimestamps: estimateWordTimestamps(request.text, durationSec),
      timestampsSource: "estimated" as const,
      costUsd: 0,
    });
  },
});
