import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  chatReadiness,
  formatModelRows,
  formatProviderRows,
  formatTokens,
  formatUsdPerMTok,
  listProviders,
  loadModelRegistry,
  type ModelRegistry,
  searchModels,
} from "../src/index";

const fixture: unknown = JSON.parse(
  readFileSync(new URL("./fixtures/models-dev-mini.json", import.meta.url), "utf8"),
);

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

const registry = async (): Promise<ModelRegistry> => {
  const dir = mkdtempSync(join(tmpdir(), "dalang-catalog-test-"));
  dirs.push(dir);
  return loadModelRegistry({
    cachePath: join(dir, "models.json"),
    fetchImpl: (async () => new Response(JSON.stringify(fixture))) as typeof fetch,
  });
};

describe("searchModels", () => {
  it("memfilter provider, tool-calling, dan input gambar", async () => {
    const reg = await registry();
    const groq = searchModels(reg, {}, { provider: "groq" });
    expect(groq.rows.length).toBeGreaterThan(0);
    expect(groq.rows.every((row) => row.model.provider === "groq")).toBe(true);

    const tools = searchModels(reg, {}, { toolCall: true });
    expect(tools.rows.every((row) => row.model.toolCall)).toBe(true);
    expect(tools.total).toBeLessThanOrEqual(reg.models.length);

    const vision = searchModels(reg, {}, { vision: true });
    expect(vision.rows.every((row) => row.model.imageInput)).toBe(true);
  });

  it("kata kunci: semua kata harus cocok, huruf besar/kecil diabaikan", async () => {
    const reg = await registry();
    const hit = searchModels(reg, {}, { text: "ANTHROPIC OPUS" });
    expect(hit.rows.length).toBeGreaterThan(0);
    expect(hit.rows.every((row) => /anthropic|opus/i.test(row.model.key))).toBe(true);
    expect(searchModels(reg, {}, { text: "tidak-akan-ada-model-ini" }).total).toBe(0);
  });

  it("urutan biaya: termurah dulu, harga tak diketahui paling akhir", async () => {
    const reg = await registry();
    const { rows } = searchModels(reg, {}, { sort: "biaya" });
    const costs = rows.map(
      (row) => row.model.costOutputPerMTok ?? Number.POSITIVE_INFINITY,
    );
    expect([...costs].sort((a, b) => a - b)).toEqual(costs);
  });

  it("urutan konteks: terbesar dulu; limit memotong tetapi total tetap utuh", async () => {
    const reg = await registry();
    const all = searchModels(reg, {}, { sort: "konteks" });
    const contexts = all.rows.map((row) => row.model.contextTokens ?? 0);
    expect([...contexts].sort((a, b) => b - a)).toEqual(contexts);
    const limited = searchModels(reg, {}, { sort: "konteks", limit: 3 });
    expect(limited.rows).toHaveLength(3);
    expect(limited.total).toBe(all.total);
  });

  it("--siap: hanya model dari provider yang konfigurasinya lengkap di env", async () => {
    const reg = await registry();
    expect(searchModels(reg, {}, { provider: "groq", ready: true }).total).toBe(0);
    const ready = searchModels(
      reg,
      { GROQ_API_KEY: "k" },
      { provider: "groq", ready: true },
    );
    expect(ready.total).toBeGreaterThan(0);
    expect(ready.rows.every((row) => row.state === "siap")).toBe(true);
  });
});

describe("listProviders", () => {
  it("urutan: siap, butuh-env, tak didukung; lalu abjad", async () => {
    const reg = await registry();
    const rows = listProviders(reg, { OPENROUTER_API_KEY: "k", CLOUDFLARE_API_KEY: "k" });
    const states = rows.map((row) => row.state);
    const order = ["siap", "butuh-env", "tidak-didukung"];
    expect([...states].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(
      states,
    );
    expect(rows.find((row) => row.provider.id === "openrouter")?.state).toBe("siap");
    expect(rows.find((row) => row.provider.id === "cloudflare-workers-ai")).toMatchObject(
      {
        state: "butuh-env",
        missingEnv: ["CLOUDFLARE_ACCOUNT_ID"],
      },
    );
    expect(rows.find((row) => row.provider.id === "amazon-bedrock")?.state).toBe(
      "tidak-didukung",
    );
  });

  it("selalu menyertakan provider yang dikenal tanpa registry (ollama)", async () => {
    const reg = await registry();
    expect(listProviders(reg, {}).some((row) => row.provider.id === "ollama")).toBe(true);
    expect(listProviders(reg, {}, { text: "ollama" }).map((r) => r.provider.id)).toEqual([
      "ollama",
      "ollama-cloud",
    ]);
  });
});

describe("tampilan", () => {
  it("formatTokens dan formatUsdPerMTok", () => {
    expect(formatTokens(undefined)).toBe("-");
    expect(formatTokens(8_000)).toBe("8K");
    expect(formatTokens(131_072)).toBe("131K");
    expect(formatTokens(1_000_000)).toBe("1.0M");
    expect(formatUsdPerMTok(undefined)).toBe("-");
    expect(formatUsdPerMTok(0)).toBe("gratis");
    expect(formatUsdPerMTok(0.05)).toBe("0.050");
    expect(formatUsdPerMTok(25)).toBe("25.00");
  });

  it("tabel model dan provider: kolom sejajar, tanpa emoji", async () => {
    const reg = await registry();
    const lines = formatModelRows(searchModels(reg, {}, { limit: 5 }).rows);
    expect(lines[0]).toMatch(
      /^MODEL\s+KONTEKS\s+MASUK\s+KELUAR\s+ALAT\s+GAMBAR\s+STATUS$/,
    );
    expect(lines).toHaveLength(6);
    const providerLines = formatProviderRows(listProviders(reg, {}));
    expect(providerLines[0]).toMatch(
      /^PROVIDER\s+NAMA\s+STATUS\s+JALUR\s+MODEL\s+ENV \/ ALASAN$/,
    );
    for (const line of [...lines, ...providerLines]) {
      expect(/\p{Extended_Pictographic}/u.test(line), line).toBe(false);
    }
  });
});

describe("chatReadiness — jawaban yang sama dengan chat sungguhan", () => {
  it("kunci provider registry yang tunggal → siap, menyebut modelnya", async () => {
    const reg = await registry();
    const ready = chatReadiness({ DEEPSEEK_API_KEY: "k" }, reg);
    expect(ready.ready).toBe(true);
    expect(ready.model).toMatch(/^deepseek\//);
  });

  it("tanpa kunci: tidak siap, alasannya menyebut jalur tanpa-API", async () => {
    const reg = await registry();
    const result = chatReadiness({}, reg);
    expect(result.ready).toBe(false);
    expect(result.reason).toContain("ollama");
  });

  it("DALANG_MODEL eksplisit tanpa kuncinya: tidak siap, dengan nama env var yang kurang", async () => {
    const reg = await registry();
    const result = chatReadiness({ DALANG_MODEL: "groq/llama-3.3-70b-versatile" }, reg);
    expect(result.ready).toBe(false);
    expect(result.reason).toContain("GROQ_API_KEY");
  });

  it("ollama eksplisit: siap tanpa kunci apa pun", async () => {
    const reg = await registry();
    expect(chatReadiness({ DALANG_MODEL: "ollama/qwen3:8b" }, reg)).toMatchObject({
      ready: true,
      model: "ollama/qwen3:8b",
    });
  });
});
