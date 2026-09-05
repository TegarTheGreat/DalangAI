import { generateText } from "ai";
import { describe, expect, it } from "vitest";
import { loadModelRegistry, pickDefaultModels, resolveModel } from "../src/index";

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

  it("model ter-resolve membawa info registry (kapabilitas & harga)", async () => {
    const registry = await loadModelRegistry({
      offline: true,
      cachePath: "/nonexistent/dalang-cache/models.json",
    });
    const resolved = resolveModel("anthropic/claude-opus-5", {
      registry,
      env: { ANTHROPIC_API_KEY: "sk-uji" },
    });
    expect(resolved.info?.toolCall).toBe(true);
    expect(resolved.info?.costOutputPerMTok).toBe(25);
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

describe("pickDefaultModels — netral vendor (environment yang menentukan)", () => {
  const registryOf = async () =>
    loadModelRegistry({
      offline: true,
      cachePath: "/nonexistent/dalang-cache/models.json",
    });

  it("DALANG_MODEL eksplisit selalu menang, provider apa pun", async () => {
    const choice = pickDefaultModels(
      {
        DALANG_MODEL: "openai-compatible/qwen-3",
        DALANG_MODEL_VOLUME: "openai-compatible/qwen-3-mini",
        ANTHROPIC_API_KEY: "sk-uji",
      },
      await registryOf(),
    );
    expect(choice.orchestrator).toBe("openai-compatible/qwen-3");
    expect(choice.volume).toBe("openai-compatible/qwen-3-mini");
  });

  it("tanpa kredensial: tidak memilih, alasan menyebut semua opsi env", () => {
    const choice = pickDefaultModels({});
    expect(choice.orchestrator).toBeUndefined();
    expect(choice.reason).toContain("ANTHROPIC_API_KEY");
    expect(choice.reason).toContain("OPENAI_API_KEY");
    expect(choice.reason).toContain("GOOGLE_GENERATIVE_AI_API_KEY");
    expect(choice.reason).toContain("DALANG_MODEL");
  });

  it("lebih dari satu kredensial: MENOLAK memilih (tidak memihak vendor)", () => {
    const choice = pickDefaultModels({
      ANTHROPIC_API_KEY: "a",
      OPENAI_API_KEY: "b",
    });
    expect(choice.orchestrator).toBeUndefined();
    expect(choice.reason).toContain("anthropic");
    expect(choice.reason).toContain("openai");
    expect(choice.reason).toContain("DALANG_MODEL");
  });

  it("satu kredensial + registry memuat provider itu → pilihan berbasis data", async () => {
    const registry = await registryOf(); // snapshot berisi model anthropic
    const choice = pickDefaultModels({ ANTHROPIC_API_KEY: "sk-uji" }, registry);
    expect(choice.orchestrator).toMatch(/^anthropic\//);
    expect(choice.volume).toMatch(/^anthropic\//);
    // orkestrator = tool-call berkonteks terbesar; volume = termurah
    const orchestrator = registry.find(choice.orchestrator ?? "");
    const volume = registry.find(choice.volume ?? "");
    expect(orchestrator?.toolCall).toBe(true);
    expect(volume?.toolCall).toBe(true);
    expect(volume?.costOutputPerMTok ?? 0).toBeLessThanOrEqual(
      orchestrator?.costOutputPerMTok ?? 0,
    );
    expect(choice.reason).toContain("registry");
  });

  it("satu kredensial google tanpa data registry → titik mulai kurasi, bukan anthropic", () => {
    const choice = pickDefaultModels({ GOOGLE_GENERATIVE_AI_API_KEY: "g" });
    expect(choice.orchestrator).toMatch(/^google\//);
    expect(choice.volume).toMatch(/^google\//);
  });

  it("openai-compatible tidak pernah ditebak — minta DALANG_MODEL eksplisit", () => {
    const choice = pickDefaultModels({
      DALANG_OPENAI_COMPAT_BASE_URL: "http://localhost:1234/v1",
    });
    expect(choice.orchestrator).toBeUndefined();
    expect(choice.reason).toContain("openai-compatible/");
  });
});
