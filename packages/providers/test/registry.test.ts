import { describe, expect, it } from "vitest";
import { buildAsrChain, buildStockChain, buildTtsChain } from "../src/index";

describe("buildTtsChain", () => {
  it("silence primary works with zero config; free fallbacks appended", () => {
    const chain = buildTtsChain({ provider: "silence", env: {} });
    expect(chain.map((p) => p.id)).toEqual(["silence", "edge"]);
  });

  it("elevenlabs primary requires its key (loud config error)", () => {
    expect(() => buildTtsChain({ provider: "elevenlabs", env: {} })).toThrow(
      /ELEVENLABS_API_KEY/,
    );
    const chain = buildTtsChain({
      provider: "elevenlabs",
      env: { ELEVENLABS_API_KEY: "k" },
    });
    expect(chain.map((p) => p.id)).toEqual(["elevenlabs", "edge", "silence"]);
  });

  it("edge primary silently drops keyless elevenlabs from the fallbacks", () => {
    const chain = buildTtsChain({ provider: "edge", env: {} });
    expect(chain.map((p) => p.id)).toEqual(["edge", "silence"]);
  });

  it("rejects unknown providers with the available list", () => {
    expect(() => buildTtsChain({ provider: "sirene", env: {} })).toThrow(
      /tidak dikenal.*elevenlabs, edge, silence/,
    );
  });
});

describe("buildStockChain", () => {
  it("builds pexels-first chains from available keys", () => {
    expect(buildStockChain({ env: {} })).toEqual([]);
    expect(buildStockChain({ env: { PIXABAY_API_KEY: "b" } }).map((p) => p.id)).toEqual([
      "pixabay",
    ]);
    expect(
      buildStockChain({
        env: { PEXELS_API_KEY: "a", PIXABAY_API_KEY: "b" },
      }).map((p) => p.id),
    ).toEqual(["pexels", "pixabay"]);
  });
});

describe("buildAsrChain", () => {
  it("rantai KOSONG saat tak ada whisper.cpp maupun kunci API — dan itu sah", () => {
    // Bukan galat: mesin polos memang belum punya jalur ASR. Yang melapor
    // adalah stage-nya, dengan pesan yang menyebut persis apa yang kurang.
    expect(buildAsrChain({ env: {} })).toEqual([]);
  });

  it("whisper.cpp di depan API — rekaman mentah tidak dikirim keluar diam-diam", () => {
    const chain = buildAsrChain({
      env: {
        WHISPER_CPP_BIN: "/bin/sh",
        WHISPER_CPP_MODEL: "/bin/sh",
        DEEPGRAM_API_KEY: "k",
        ELEVENLABS_API_KEY: "e",
      },
    });
    expect(chain.map((provider) => provider.id)).toEqual([
      "whisper-cpp",
      "deepgram",
      "elevenlabs-scribe",
    ]);
    expect(chain[0]?.offline).toBe(true);
  });

  it("kunci ElevenLabs yang sudah ada untuk TTS langsung memberi jalur transkripsi", () => {
    const chain = buildAsrChain({ env: { ELEVENLABS_API_KEY: "e" } });
    expect(chain.map((provider) => provider.id)).toEqual(["elevenlabs-scribe"]);
  });

  it("whisper.cpp yang binari-nya ada tapi modelnya tidak, tidak masuk rantai", () => {
    const chain = buildAsrChain({
      env: {
        WHISPER_CPP_BIN: "/bin/sh",
        WHISPER_CPP_MODEL: "/tidak/ada",
        DEEPGRAM_API_KEY: "k",
      },
    });
    expect(chain.map((provider) => provider.id)).toEqual(["deepgram"]);
  });
});
