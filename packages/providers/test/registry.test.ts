import { describe, expect, it } from "vitest";
import { buildStockChain, buildTtsChain } from "../src/index";

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
