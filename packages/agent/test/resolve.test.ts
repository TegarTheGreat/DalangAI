import { generateText } from "ai";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORCHESTRATOR_MODEL,
  DEFAULT_VOLUME_MODEL,
  loadModelRegistry,
  resolveModel,
} from "../src/index";

describe("resolveModel", () => {
  it("menolak format tanpa provider", () => {
    expect(() => resolveModel("claude-opus-5", { env: {} })).toThrow(
      /provider\/model-id/,
    );
  });

  it("provider tak dikenal menyebut daftar yang tersedia", () => {
    expect(() => resolveModel("meta/llama", { env: {} })).toThrow(
      /anthropic, openai, google, openai-compatible, mock/,
    );
  });

  it("anthropic tanpa key gagal dengan nama env var", () => {
    expect(() => resolveModel("anthropic/claude-opus-5", { env: {} })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });

  it("anthropic dengan key ter-resolve + membawa info registry", async () => {
    const registry = await loadModelRegistry({
      offline: true,
      cachePath: "/nonexistent/dalang-cache/models.json",
    });
    const resolved = resolveModel(DEFAULT_ORCHESTRATOR_MODEL, {
      registry,
      env: { ANTHROPIC_API_KEY: "sk-uji" },
    });
    expect(resolved.info?.toolCall).toBe(true);
    expect(resolved.info?.costOutputPerMTok).toBe(25);
    const volume = resolveModel(DEFAULT_VOLUME_MODEL, {
      registry,
      env: { ANTHROPIC_API_KEY: "sk-uji" },
    });
    expect(volume.info?.costInputPerMTok).toBe(1);
  });

  it("mock/echo berjalan tanpa jaringan (smoke path CLI)", async () => {
    const { model } = resolveModel("mock/echo", { env: {} });
    const result = await generateText({
      model,
      messages: [{ role: "user", content: "halo dalang" }],
    });
    expect(result.text).toContain("[mock/echo]");
    expect(result.text).toContain("halo dalang");
  });
});
