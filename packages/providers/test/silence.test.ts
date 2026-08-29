import { describe, expect, it } from "vitest";
import { createSilenceTts, makeSilentWav } from "../src/index";

const readAscii = (bytes: Uint8Array, offset: number, length: number) =>
  new TextDecoder().decode(bytes.slice(offset, offset + length));

const readU32 = (bytes: Uint8Array, offset: number) =>
  new DataView(bytes.buffer, bytes.byteOffset).getUint32(offset, true);

describe("makeSilentWav", () => {
  it("produces a valid 16-bit mono PCM RIFF/WAVE file", () => {
    const wav = makeSilentWav(2, 24_000);
    expect(readAscii(wav, 0, 4)).toBe("RIFF");
    expect(readAscii(wav, 8, 4)).toBe("WAVE");
    expect(readAscii(wav, 12, 4)).toBe("fmt ");
    expect(readAscii(wav, 36, 4)).toBe("data");
    expect(readU32(wav, 40)).toBe(2 * 24_000 * 2); // data size
    expect(wav.byteLength).toBe(44 + 2 * 24_000 * 2);
    expect(readU32(wav, 4)).toBe(wav.byteLength - 8);
  });
});

describe("silence provider", () => {
  it("estimates duration and words deterministically (audio-relative)", async () => {
    const provider = createSilenceTts();
    const result = await provider.synthesize({
      text: "Borobudur dibangun pada abad kesembilan",
      voiceId: "apa saja",
      speed: 1,
      language: "id",
    });
    expect(provider.placeholderQuality).toBe(true);
    expect(result.format).toBe("wav");
    expect(result.durationSec).toBeCloseTo(5 / 2.4, 3);
    expect(result.wordTimestamps).toHaveLength(5);
    expect(result.wordTimestamps[0]?.startSec).toBe(0);
    expect(result.wordTimestamps.at(-1)?.endSec).toBeCloseTo(result.durationSec, 3);
    expect(result.costUsd).toBe(0);

    const again = await provider.synthesize({
      text: "Borobudur dibangun pada abad kesembilan",
      voiceId: "x",
      speed: 1,
      language: "id",
    });
    expect(again.audio).toEqual(result.audio);
  });

  it("respects the minimum duration for tiny narrations", async () => {
    const result = await createSilenceTts().synthesize({
      text: "Ya.",
      voiceId: "v",
      speed: 1,
      language: "id",
    });
    expect(result.durationSec).toBeGreaterThanOrEqual(0.8);
  });
});
