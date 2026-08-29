import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  estimateLlmCostUsd,
  loadModelRegistry,
  MODELS_SNAPSHOT,
  parseModelsDev,
} from "../src/index";

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

const cacheIn = () => {
  dir = mkdtempSync(join(tmpdir(), "dalang-registry-test-"));
  return join(dir, "models.json");
};

const fakeApiJson = {
  contoh: {
    id: "contoh",
    name: "Contoh",
    models: {
      "model-a": {
        name: "Model A",
        tool_call: true,
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 100_000 },
        cost: { input: 2, output: 8 },
      },
      "model-rusak": "bukan objek",
      "model-b": { tool_call: false, cost: { input: 0.1, output: 0.4 } },
    },
  },
  "provider-rusak": 42,
};

describe("parseModelsDev", () => {
  it("parses the bundled snapshot with Anthropic pricing", () => {
    const models = parseModelsDev(MODELS_SNAPSHOT);
    const opus = models.find((m) => m.key === "anthropic/claude-opus-5");
    expect(opus).toMatchObject({
      toolCall: true,
      imageInput: true,
      costInputPerMTok: 5,
      costOutputPerMTok: 25,
    });
    expect(models.find((m) => m.key === "anthropic/claude-haiku-4-5")).toBeDefined();
  });

  it("skips malformed providers/models without failing (external data)", () => {
    const models = parseModelsDev(fakeApiJson);
    expect(models.map((m) => m.key).sort()).toEqual(["contoh/model-a", "contoh/model-b"]);
    expect(parseModelsDev(null)).toEqual([]);
    expect(parseModelsDev("teks")).toEqual([]);
  });
});

describe("loadModelRegistry (urutan sumber)", () => {
  it("network sukses → source network + cache tertulis", async () => {
    const cachePath = cacheIn();
    const registry = await loadModelRegistry({
      cachePath,
      fetchImpl: (async () =>
        new Response(JSON.stringify(fakeApiJson), { status: 200 })) as typeof fetch,
    });
    expect(registry.source).toBe("network");
    expect(registry.find("contoh/model-a")?.costInputPerMTok).toBe(2);

    // Panggilan kedua dalam TTL memakai cache, tanpa fetch.
    const second = await loadModelRegistry({
      cachePath,
      fetchImpl: (async () => {
        throw new Error("tidak boleh fetch");
      }) as typeof fetch,
    });
    expect(second.source).toBe("cache");
    expect(second.find("contoh/model-a")).toBeDefined();
  });

  it("network gagal tanpa cache → snapshot bundled", async () => {
    const registry = await loadModelRegistry({
      cachePath: cacheIn(),
      fetchImpl: (async () => {
        throw new Error("terblokir");
      }) as typeof fetch,
    });
    expect(registry.source).toBe("snapshot");
    expect(registry.find("anthropic/claude-opus-5")).toBeDefined();
  });

  it("network gagal dengan cache basi → stale-cache", async () => {
    const cachePath = cacheIn();
    writeFileSync(cachePath, JSON.stringify(fakeApiJson));
    const old = new Date(Date.now() - 48 * 3600 * 1000);
    utimesSync(cachePath, old, old);
    const registry = await loadModelRegistry({
      cachePath,
      fetchImpl: (async () => {
        throw new Error("terblokir");
      }) as typeof fetch,
    });
    expect(registry.source).toBe("stale-cache");
  });

  it("offline: true tidak menyentuh jaringan", async () => {
    let fetched = false;
    const registry = await loadModelRegistry({
      cachePath: cacheIn(),
      offline: true,
      fetchImpl: (async () => {
        fetched = true;
        return new Response("{}");
      }) as typeof fetch,
    });
    expect(fetched).toBe(false);
    expect(registry.source).toBe("snapshot");
  });
});

describe("estimateLlmCostUsd", () => {
  it("hitung dari harga registry; null bila tak diketahui", () => {
    const info = parseModelsDev(MODELS_SNAPSHOT).find(
      (m) => m.key === "anthropic/claude-sonnet-5",
    );
    expect(
      estimateLlmCostUsd(info, { inputTokens: 1_000_000, outputTokens: 100_000 }),
    ).toBeCloseTo(2 + 1, 6);
    expect(estimateLlmCostUsd(undefined, { inputTokens: 10 })).toBeNull();
  });
});
