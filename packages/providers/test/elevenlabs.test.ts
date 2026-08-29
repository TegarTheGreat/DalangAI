import { describe, expect, it } from "vitest";
import {
  charAlignmentToWords,
  createElevenLabsTts,
  ELEVENLABS_ESTIMATED_USD_PER_CHAR,
} from "../src/index";

describe("charAlignmentToWords", () => {
  it("groups characters into words across whitespace", () => {
    const words = charAlignmentToWords({
      characters: ["H", "a", "i", " ", "d", "u", "n", "i", "a"],
      character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
      character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.95],
    });
    expect(words).toEqual([
      { word: "Hai", startSec: 0, endSec: 0.3 },
      { word: "dunia", startSec: 0.4, endSec: 0.95 },
    ]);
  });

  it("keeps punctuation attached and survives multiple spaces/newlines", () => {
    const chars = "Halo,  dunia!\nBaru".split("");
    const starts = chars.map((_, i) => i * 0.1);
    const ends = chars.map((_, i) => i * 0.1 + 0.1);
    const words = charAlignmentToWords({
      characters: chars,
      character_start_times_seconds: starts,
      character_end_times_seconds: ends,
    });
    expect(words.map((w) => w.word)).toEqual(["Halo,", "dunia!", "Baru"]);
    for (let i = 1; i < words.length; i++) {
      expect(words[i]!.startSec).toBeGreaterThan(words[i - 1]!.endSec - 1e-9);
    }
  });
});

describe("createElevenLabsTts", () => {
  const alignment = {
    characters: ["H", "a", "i", " ", "y", "a"],
    character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
    character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.62],
  };

  const fakeFetch = (captured: { url?: string; init?: RequestInit }) =>
    (async (url: RequestInfo | URL, init?: RequestInit) => {
      captured.url = String(url);
      captured.init = init;
      return new Response(
        JSON.stringify({
          audio_base64: Buffer.from([7, 7, 7]).toString("base64"),
          alignment,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

  it("calls with-timestamps with the right shape and maps the result", async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    const provider = createElevenLabsTts({
      apiKey: "kunci-uji",
      fetchImpl: fakeFetch(captured),
    });
    const result = await provider.synthesize({
      text: "Hai ya",
      voiceId: "suara/aneh id",
      speed: 1,
      language: "id",
    });

    expect(captured.url).toContain(
      "/v1/text-to-speech/suara%2Faneh%20id/with-timestamps",
    );
    expect(captured.url).toContain("output_format=mp3_44100_128");
    expect((captured.init!.headers as Record<string, string>)["xi-api-key"]).toBe(
      "kunci-uji",
    );
    const body = JSON.parse(String(captured.init?.body));
    expect(body).toEqual({ text: "Hai ya", model_id: "eleven_multilingual_v2" });

    expect(result.format).toBe("mp3");
    expect(result.audio).toEqual(new Uint8Array([7, 7, 7]));
    expect(result.durationSec).toBe(0.62);
    expect(result.timestampsSource).toBe("native");
    expect(result.wordTimestamps.map((w) => w.word)).toEqual(["Hai", "ya"]);
    expect(result.costUsd).toBeCloseTo(6 * ELEVENLABS_ESTIMATED_USD_PER_CHAR, 10);
  });

  it("sends voice_settings.speed only when speed ≠ 1", async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    const provider = createElevenLabsTts({
      apiKey: "k",
      fetchImpl: fakeFetch(captured),
    });
    await provider.synthesize({
      text: "Hai ya",
      voiceId: "v",
      speed: 1.1,
      language: "id",
    });
    expect(JSON.parse(String(captured.init?.body)).voice_settings).toEqual({
      speed: 1.1,
    });
  });

  it("surfaces API errors with status and body", async () => {
    const provider = createElevenLabsTts({
      apiKey: "k",
      fetchImpl: (async () =>
        new Response('{"detail":"kuota habis"}', { status: 401 })) as typeof fetch,
    });
    await expect(
      provider.synthesize({ text: "x", voiceId: "v", speed: 1, language: "id" }),
    ).rejects.toThrow(/ElevenLabs HTTP 401.*kuota habis/s);
  });
});
