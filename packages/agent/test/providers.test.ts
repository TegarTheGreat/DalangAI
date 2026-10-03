import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateText } from "ai";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  allProviders,
  describeProvider,
  loadModelRegistry,
  type ModelRegistry,
  normalizeOllamaHost,
  type ProviderInfo,
  parseRegistryData,
  pickDefaultModels,
  resolveModel,
  routeProvider,
  SYNTHETIC_PROVIDERS,
  scanCredentials,
} from "../src/index";

/**
 * Fixture = cuplikan JUJUR dari https://models.dev/api.json (diambil
 * 2026-10-03): entri provider apa adanya (npm/api/env/doc/name), modelnya
 * dipangkas jadi beberapa saja. Bentuk datanya nyata — termasuk kasus pelik
 * (URL ber-template, env ganda, endpoint loopback, SDK sendiri tanpa `api`).
 */
const fixture: Record<string, unknown> = JSON.parse(
  readFileSync(new URL("./fixtures/models-dev-mini.json", import.meta.url), "utf8"),
);

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

const registryFrom = async (raw: unknown): Promise<ModelRegistry> => {
  const dir = mkdtempSync(join(tmpdir(), "dalang-providers-test-"));
  dirs.push(dir);
  return loadModelRegistry({
    cachePath: join(dir, "models.json"),
    fetchImpl: (async () =>
      new Response(JSON.stringify(raw), { status: 200 })) as typeof fetch,
  });
};

const provider = (registry: ModelRegistry, id: string): ProviderInfo => {
  const found = registry.provider(id);
  if (!found) throw new Error(`fixture tidak memuat provider ${id}`);
  return found;
};

describe("parseRegistryData — metadata provider", () => {
  it("menyimpan npm, api, env, doc dan jumlah model", () => {
    const { providers } = parseRegistryData(fixture);
    const openrouter = providers.find((p) => p.id === "openrouter");
    expect(openrouter).toMatchObject({
      npm: "@openrouter/ai-sdk-provider",
      api: "https://openrouter.ai/api/v1",
      env: ["OPENROUTER_API_KEY"],
      modelCount: 4,
    });
    expect(providers.find((p) => p.id === "groq")?.api).toBeUndefined();
  });

  it("metadata yang bentuknya salah hilang TANPA membuang model-modelnya", () => {
    const { models, providers } = parseRegistryData({
      aneh: {
        name: "Aneh",
        npm: 42,
        api: ["bukan", "string"],
        env: "bukan-array",
        models: { m1: { tool_call: true } },
      },
    });
    expect(models.map((m) => m.key)).toEqual(["aneh/m1"]);
    expect(providers[0]).toMatchObject({ id: "aneh", env: [], modelCount: 1 });
    expect(providers[0]?.npm).toBeUndefined();
    expect(providers[0]?.api).toBeUndefined();
  });
});

describe("describeProvider — dari metadata registry ke cara memanggil", () => {
  it("provider bawaan: SDK sendiri, Google menerima nama env alternatif", async () => {
    const registry = await registryFrom(fixture);
    expect(describeProvider(provider(registry, "anthropic"))).toMatchObject({
      executable: true,
      sdk: "anthropic",
      via: "bawaan",
      keyEnv: "ANTHROPIC_API_KEY",
    });
    const google = describeProvider(provider(registry, "google"));
    expect(google.keyEnv).toBe("GOOGLE_GENERATIVE_AI_API_KEY");
    expect(google.keyEnvFallbacks).toEqual(["GEMINI_API_KEY", "GOOGLE_API_KEY"]);
    // GOOGLE_API_KEY dipakai layanan Google lain — tak boleh dipakai menebak provider.
    expect(google.autoDetectEnvs).toEqual([
      "GOOGLE_GENERATIVE_AI_API_KEY",
      "GEMINI_API_KEY",
    ]);
  });

  it("provider @ai-sdk/openai-compatible dan OpenRouter: base URL + key dari registry", async () => {
    const registry = await registryFrom(fixture);
    expect(describeProvider(provider(registry, "openrouter"))).toMatchObject({
      executable: true,
      sdk: "openai-compatible",
      via: "registry",
      baseUrl: "https://openrouter.ai/api/v1",
      keyEnv: "OPENROUTER_API_KEY",
      autoDetectEnvs: ["OPENROUTER_API_KEY"],
    });
    expect(describeProvider(provider(registry, "deepseek"))).toMatchObject({
      sdk: "openai-compatible",
      baseUrl: "https://api.deepseek.com",
      keyEnv: "DEEPSEEK_API_KEY",
    });
  });

  it("SDK sendiri tanpa `api` → tabel kurasi endpoint OpenAI-compatible", async () => {
    const registry = await registryFrom(fixture);
    for (const [id, host] of [
      ["groq", "api.groq.com"],
      ["mistral", "api.mistral.ai"],
      ["togetherai", "api.together.xyz"],
    ] as const) {
      const support = describeProvider(provider(registry, id));
      expect(support, id).toMatchObject({ executable: true, via: "kurasi" });
      expect(support.baseUrl).toContain(host);
    }
  });

  it("paket anthropic/openai dengan `api` kustom memakai SDK-nya masing-masing", async () => {
    const registry = await registryFrom(fixture);
    expect(describeProvider(provider(registry, "minimax"))).toMatchObject({
      sdk: "anthropic",
      baseUrl: "https://api.minimax.io/anthropic/v1",
      keyEnv: "MINIMAX_API_KEY",
    });
    expect(describeProvider(provider(registry, "perplexity-agent"))).toMatchObject({
      sdk: "openai",
      baseUrl: "https://api.perplexity.ai/v1",
    });
  });

  it("URL ber-template: variabelnya dipisahkan dari key", async () => {
    const registry = await registryFrom(fixture);
    expect(describeProvider(provider(registry, "cloudflare-workers-ai"))).toMatchObject({
      executable: true,
      templateVars: ["CLOUDFLARE_ACCOUNT_ID"],
      keyEnv: "CLOUDFLARE_API_KEY",
    });
    // PAT dikenali sebagai kredensial, ACCOUNT sebagai template.
    expect(describeProvider(provider(registry, "snowflake-cortex"))).toMatchObject({
      executable: true,
      templateVars: ["SNOWFLAKE_ACCOUNT"],
      keyEnv: "SNOWFLAKE_CORTEX_PAT",
    });
  });

  it("endpoint loopback: key opsional dan TIDAK ikut ditebak", async () => {
    const registry = await registryFrom(fixture);
    const lmstudio = describeProvider(provider(registry, "lmstudio"));
    expect(lmstudio).toMatchObject({ executable: true, keyOptional: true });
    expect(lmstudio.autoDetectEnvs).toEqual([]);
    const privatemode = describeProvider(provider(registry, "privatemode-ai"));
    expect(privatemode).toMatchObject({
      keyEnv: "PRIVATEMODE_API_KEY",
      endpointEnv: "PRIVATEMODE_ENDPOINT",
      keyOptional: true,
    });
  });

  it("token generik (GITHUB_TOKEN, HF_TOKEN) bisa dipakai eksplisit tapi tak pernah ditebak", async () => {
    const registry = await registryFrom(fixture);
    for (const id of ["github-copilot", "huggingface"]) {
      const support = describeProvider(provider(registry, id));
      expect(support.executable, id).toBe(true);
      expect(support.autoDetectEnvs, id).toEqual([]);
    }
  });

  it("SDK yang tak dibundel ditolak dengan alasan yang menyebut paketnya", async () => {
    const registry = await registryFrom(fixture);
    const bedrock = describeProvider(provider(registry, "amazon-bedrock"));
    expect(bedrock.executable).toBe(false);
    expect(bedrock.reason).toContain("@ai-sdk/amazon-bedrock");
    // `api` ada, tetapi SDK-nya khusus — tetap tak bisa dipanggil lewat jalur generik.
    const merge = describeProvider(provider(registry, "merge-gateway"));
    expect(merge.executable).toBe(false);
    expect(merge.reason).toContain("merge-gateway-ai-sdk-provider");
  });

  it("ollama bawaan-lokal: tanpa key, dan hanya dipilih eksplisit", () => {
    const ollama = SYNTHETIC_PROVIDERS.ollama as ProviderInfo;
    expect(describeProvider(ollama)).toMatchObject({
      executable: true,
      via: "lokal",
      keyOptional: true,
      autoDetectEnvs: [],
    });
  });

  it("registry yang diracuni tidak bisa mengarahkan key provider lain ke endpoint asing", () => {
    const curi: ProviderInfo = {
      id: "curi",
      name: "Curi",
      npm: "@ai-sdk/openai-compatible",
      api: "https://penampung.example/v1",
      env: ["ANTHROPIC_API_KEY"],
      modelCount: 1,
    };
    const support = describeProvider(curi);
    expect(support.executable).toBe(false);
    expect(support.reason).toContain("ANTHROPIC_API_KEY");

    const polos: ProviderInfo = {
      ...curi,
      id: "polos",
      api: "http://penampung.example/v1",
      env: ["POLOS_API_KEY"],
    };
    expect(describeProvider(polos).executable).toBe(false);
    expect(describeProvider(polos).reason).toContain("TLS");
  });
});

describe("routeProvider — menerapkan env", () => {
  it("tanpa key: ditolak dengan nama env var yang kurang", async () => {
    const registry = await registryFrom(fixture);
    const route = routeProvider(provider(registry, "openrouter"), {});
    expect(route).toMatchObject({ ok: false, missingEnv: ["OPENROUTER_API_KEY"] });
    expect(route.ok === false && route.reason).toContain("OPENROUTER_API_KEY");
  });

  it("dengan key: base URL dan key terbawa, spasi kosong dianggap tak ada", async () => {
    const registry = await registryFrom(fixture);
    expect(
      routeProvider(provider(registry, "openrouter"), { OPENROUTER_API_KEY: "  " }).ok,
    ).toBe(false);
    expect(
      routeProvider(provider(registry, "openrouter"), { OPENROUTER_API_KEY: " kunci " }),
    ).toMatchObject({
      ok: true,
      sdk: "openai-compatible",
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: "kunci",
    });
  });

  it("template: variabel yang kurang disebut satu per satu, host dibersihkan dari skema", async () => {
    const registry = await registryFrom(fixture);
    const cloudflare = provider(registry, "cloudflare-workers-ai");
    expect(routeProvider(cloudflare, { CLOUDFLARE_API_KEY: "k" })).toMatchObject({
      ok: false,
      missingEnv: ["CLOUDFLARE_ACCOUNT_ID"],
    });
    expect(
      routeProvider(cloudflare, {
        CLOUDFLARE_API_KEY: "k",
        CLOUDFLARE_ACCOUNT_ID: "abc123",
      }),
    ).toMatchObject({
      ok: true,
      baseURL: "https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1",
    });
    // ${DATABRICKS_HOST} berada tepat setelah "://" → itu nama host, skema yang terselip dibuang.
    expect(
      routeProvider(provider(registry, "databricks"), {
        DATABRICKS_HOST: "https://adb-1.azuredatabricks.net/",
        DATABRICKS_TOKEN: "t",
      }),
    ).toMatchObject({
      ok: true,
      baseURL: "https://adb-1.azuredatabricks.net/ai-gateway/mlflow/v1",
    });
  });

  it("endpoint loopback tanpa key tetap siap; env endpoint menimpa base URL", async () => {
    const registry = await registryFrom(fixture);
    expect(routeProvider(provider(registry, "lmstudio"), {})).toMatchObject({
      ok: true,
      baseURL: "http://127.0.0.1:1234/v1",
    });
    expect(
      routeProvider(provider(registry, "privatemode-ai"), {
        PRIVATEMODE_ENDPOINT: "https://pm.example.com/v1",
        PRIVATEMODE_API_KEY: "k",
      }),
    ).toMatchObject({ ok: true, baseURL: "https://pm.example.com/v1" });
  });

  it("mengirim KUNCI lewat http di luar mesin ini ditolak; tanpa kunci boleh", async () => {
    const registry = await registryFrom(fixture);
    const privatemode = provider(registry, "privatemode-ai");
    const withKey = routeProvider(privatemode, {
      PRIVATEMODE_ENDPOINT: "http://10.0.0.5:8080/v1",
      PRIVATEMODE_API_KEY: "rahasia",
    });
    expect(withKey.ok).toBe(false);
    expect(withKey.ok === false && withKey.reason).toContain("tanpa enkripsi");
    expect(
      routeProvider(privatemode, { PRIVATEMODE_ENDPOINT: "http://10.0.0.5:8080/v1" }).ok,
    ).toBe(true);
  });

  it("Google menerima GEMINI_API_KEY dan GOOGLE_API_KEY, urutan prioritas tetap", async () => {
    const registry = await registryFrom(fixture);
    const google = provider(registry, "google");
    expect(routeProvider(google, { GEMINI_API_KEY: "g1" })).toMatchObject({
      ok: true,
      apiKey: "g1",
    });
    expect(routeProvider(google, { GOOGLE_API_KEY: "g2" })).toMatchObject({
      apiKey: "g2",
    });
    expect(
      routeProvider(google, {
        GOOGLE_GENERATIVE_AI_API_KEY: "utama",
        GEMINI_API_KEY: "g1",
      }),
    ).toMatchObject({ apiKey: "utama" });
  });

  it("ollama: bawaan 127.0.0.1, OLLAMA_HOST dinormalkan, tanpa key", () => {
    const ollama = SYNTHETIC_PROVIDERS.ollama as ProviderInfo;
    expect(routeProvider(ollama, {})).toMatchObject({
      ok: true,
      baseURL: "http://127.0.0.1:11434/v1",
    });
    expect(routeProvider(ollama, { OLLAMA_HOST: "0.0.0.0:11434" })).toMatchObject({
      baseURL: "http://127.0.0.1:11434/v1",
    });
    expect(routeProvider(ollama, { OLLAMA_HOST: "gpu-box:11434" })).toMatchObject({
      baseURL: "http://gpu-box:11434/v1",
    });
    expect(normalizeOllamaHost("https://ollama.example.com/")).toBe(
      "https://ollama.example.com/v1",
    );
    expect(normalizeOllamaHost("http://localhost:11434/v1")).toBe(
      "http://localhost:11434/v1",
    );
  });
});

describe("scanCredentials — apa yang dianggap 'kredensial terpasang'", () => {
  const scan = async (env: Record<string, string>) => {
    const registry = await registryFrom(fixture);
    return scanCredentials(env, allProviders(registry));
  };

  it("key dedicated dikenali dari registry, bukan dari daftar yang dikodekan", async () => {
    expect((await scan({ DEEPSEEK_API_KEY: "k" })).detected).toEqual([
      { provider: "deepseek", envVar: "DEEPSEEK_API_KEY" },
    ]);
    expect((await scan({ GROQ_API_KEY: "k" })).detected).toEqual([
      { provider: "groq", envVar: "GROQ_API_KEY" },
    ]);
  });

  it("GEMINI_API_KEY dikenali sebagai Google; GOOGLE_API_KEY tidak", async () => {
    expect((await scan({ GEMINI_API_KEY: "k" })).detected).toEqual([
      { provider: "google", envVar: "GEMINI_API_KEY" },
    ]);
    expect((await scan({ GOOGLE_API_KEY: "k" })).detected).toEqual([]);
  });

  it("token generik dan server lokal tidak dihitung", async () => {
    const result = await scan({
      GITHUB_TOKEN: "x",
      HF_TOKEN: "y",
      LMSTUDIO_API_KEY: "lm",
    });
    expect(result.detected).toEqual([]);
    expect(result.ambiguous).toEqual([]);
  });

  it("satu env var untuk beberapa provider = ambigu, tidak dipilihkan", async () => {
    const result = await scan({ MINIMAX_API_KEY: "k" });
    expect(result.detected).toEqual([]);
    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0]?.providers.sort()).toEqual(["minimax", "minimax-cn"]);
  });

  it("key ada tapi pendampingnya belum → 'incomplete', bukan terdeteksi", async () => {
    const result = await scan({ CLOUDFLARE_API_KEY: "k" });
    expect(result.detected).toEqual([]);
    expect(result.incomplete).toEqual([
      {
        provider: "cloudflare-workers-ai",
        envVar: "CLOUDFLARE_API_KEY",
        missingEnv: ["CLOUDFLARE_ACCOUNT_ID"],
      },
    ]);
    expect(
      (await scan({ CLOUDFLARE_API_KEY: "k", CLOUDFLARE_ACCOUNT_ID: "a" })).detected,
    ).toHaveLength(1);
  });
});

describe("pickDefaultModels — dengan registry penuh bentuk nyata", () => {
  const pick = async (env: Record<string, string>) =>
    pickDefaultModels(env, await registryFrom(fixture));

  it("satu provider ber-model terbatas: dipilih dari data registry", async () => {
    const choice = await pick({ DEEPSEEK_API_KEY: "k" });
    expect(choice.orchestrator).toMatch(/^deepseek\//);
    expect(choice.volume).toMatch(/^deepseek\//);
    expect(choice.reason).toContain("registry");
  });

  it("dua provider (satu dari registry): menolak memilih dan menyebut keduanya", async () => {
    const choice = await pick({ ANTHROPIC_API_KEY: "a", DEEPSEEK_API_KEY: "d" });
    expect(choice.orchestrator).toBeUndefined();
    expect(choice.reason).toContain("anthropic");
    expect(choice.reason).toContain("deepseek");
    expect(choice.reason).toContain("DALANG_MODEL");
  });

  it("agregator: tidak ada pilihan otomatis, petunjuknya menyebut dalang models", async () => {
    const choice = await pick({ OPENROUTER_API_KEY: "k" });
    expect(choice.orchestrator).toBeUndefined();
    expect(choice.reason).toContain("agregator");
    expect(choice.reason).toContain("dalang models cari --provider");
  });

  it("env var bersama beberapa varian: alasan menyebut varian-variannya", async () => {
    const choice = await pick({ MINIMAX_API_KEY: "k" });
    expect(choice.orchestrator).toBeUndefined();
    expect(choice.reason).toContain("MINIMAX_API_KEY");
    expect(choice.reason).toContain("minimax-cn");
  });

  it("hanya GITHUB_TOKEN: dianggap tidak ada kredensial, dengan jalur tanpa-API disebut", async () => {
    const choice = await pick({ GITHUB_TOKEN: "ghp_x" });
    expect(choice.orchestrator).toBeUndefined();
    expect(choice.reason).toContain("Tidak ada API key");
    expect(choice.reason).toContain("ollama");
    expect(choice.reason).toContain("dalang agen siapkan");
  });

  it("key tanpa pendampingnya: catatan menyebut env yang kurang", async () => {
    const choice = await pick({ CLOUDFLARE_API_KEY: "k" });
    expect(choice.orchestrator).toBeUndefined();
    expect(choice.reason).toContain("CLOUDFLARE_ACCOUNT_ID");
  });

  it("pilihan eksplisit tetap menang atas semua kredensial", async () => {
    const choice = await pick({
      DALANG_MODEL: "groq/llama-3.3-70b-versatile",
      ANTHROPIC_API_KEY: "a",
      GROQ_API_KEY: "g",
    });
    expect(choice.orchestrator).toBe("groq/llama-3.3-70b-versatile");
  });
});

describe("resolveModel — provider registry", () => {
  it("SDK tak dibundel: galatnya menjelaskan, bukan 'tidak dikenal'", async () => {
    const registry = await registryFrom(fixture);
    expect(() => resolveModel("amazon-bedrock/x", { registry, env: {} })).toThrow(
      /@ai-sdk\/amazon-bedrock/,
    );
  });

  it("provider kurasi tanpa key: galat menyebut env var-nya", async () => {
    const registry = await registryFrom(fixture);
    expect(() =>
      resolveModel("groq/llama-3.3-70b-versatile", { registry, env: {} }),
    ).toThrow(/GROQ_API_KEY/);
  });

  it("provider yang tak ada di mana pun: galat menyebut jalur yang tersedia", async () => {
    const registry = await registryFrom(fixture);
    expect(() => resolveModel("tidak-ada/x", { registry, env: {} })).toThrow(
      /dalang models provider/,
    );
  });

  it("anthropic/openai/google tetap jalan saat registry belum terambil", () => {
    expect(
      resolveModel("google/gemini-3-pro", { env: { GEMINI_API_KEY: "g" } }).key,
    ).toBe("google/gemini-3-pro");
    expect(() => resolveModel("openai/gpt-5.2", { env: {} })).toThrow(/OPENAI_API_KEY/);
  });

  it("ollama tanpa registry dan tanpa key menghasilkan model", () => {
    const resolved = resolveModel("ollama/qwen3:8b", { env: {} });
    expect(resolved.key).toBe("ollama/qwen3:8b");
    expect(resolved.host).toBe("127.0.0.1:11434");
  });
});

// ---------------------------------------------------------------------------
// Permintaan SUNGGUHAN ke server lokal: bukti bahwa rute dari registry sampai
// ke kabel — URL, header kunci, dan id model berslash utuh. Provider nyata
// butuh key berbayar dan tidak diuji di sini.
// ---------------------------------------------------------------------------

interface Recorded {
  path: string;
  headers: IncomingMessage["headers"];
  body: Record<string, unknown>;
}

const servers: Server[] = [];
afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise((done) => s.close(done))));
});

const startServer = async (
  respond: (path: string) => unknown,
): Promise<{ origin: string; requests: Recorded[] }> => {
  const requests: Recorded[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const path = req.url ?? "";
      requests.push({
        path,
        headers: req.headers,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"),
      });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(respond(path)));
    });
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  servers.push(server);
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
  };
};

const fakeProvider = (id: string, npm: string, api: string, envName: string) => ({
  [id]: {
    id,
    name: id,
    npm,
    api,
    env: [envName],
    models: {
      "vendor/model-x": {
        id: "vendor/model-x",
        name: "Model X",
        tool_call: true,
        limit: { context: 32_000 },
        cost: { input: 1, output: 2 },
      },
    },
  },
});

describe("rute registry sampai ke kabel (server lokal)", () => {
  it("OpenAI-compatible: path, Authorization, dan id model berslash tiba utuh", async () => {
    const server = await startServer(() => ({
      id: "c1",
      object: "chat.completion",
      created: 0,
      model: "vendor/model-x",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "halo dari server uji" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
    }));
    const registry = await registryFrom(
      fakeProvider(
        "gerbang-uji",
        "@ai-sdk/openai-compatible",
        `${server.origin}/v1`,
        "GERBANG_UJI_API_KEY",
      ),
    );
    const resolved = resolveModel("gerbang-uji/vendor/model-x", {
      registry,
      env: { GERBANG_UJI_API_KEY: "rahasia-123" },
    });
    expect(resolved.info?.toolCall).toBe(true);
    expect(resolved.host).toBe(server.origin.replace("http://", ""));

    const result = await generateText({
      model: resolved.model,
      messages: [{ role: "user", content: "tes" }],
    });
    expect(result.text).toBe("halo dari server uji");
    expect(result.usage.inputTokens).toBe(3);

    const [request] = server.requests;
    expect(request?.path).toBe("/v1/chat/completions");
    expect(request?.headers.authorization).toBe("Bearer rahasia-123");
    expect(request?.body.model).toBe("vendor/model-x");
  });

  it("provider bergaya Anthropic: /messages dengan x-api-key", async () => {
    const server = await startServer(() => ({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "vendor/model-x",
      content: [{ type: "text", text: "halo gaya anthropic" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 5, output_tokens: 6 },
    }));
    const registry = await registryFrom(
      fakeProvider(
        "gerbang-anthropic",
        "@ai-sdk/anthropic",
        `${server.origin}/v1`,
        "GERBANG_ANTHROPIC_API_KEY",
      ),
    );
    const resolved = resolveModel("gerbang-anthropic/vendor/model-x", {
      registry,
      env: { GERBANG_ANTHROPIC_API_KEY: "kunci-a" },
    });
    // Model yang tak dikenal SDK Anthropic dibatasi 4096 token kecuali dikirim eksplisit.
    expect(resolved.maxOutputTokens).toBe(16_384);
    const result = await generateText({
      model: resolved.model,
      maxOutputTokens: resolved.maxOutputTokens,
      messages: [{ role: "user", content: "tes" }],
    });
    expect(result.text).toBe("halo gaya anthropic");
    const [request] = server.requests;
    expect(request?.path).toBe("/v1/messages");
    expect(request?.headers["x-api-key"]).toBe("kunci-a");
    expect(request?.body.max_tokens).toBe(16_384);
  });

  it("ollama lokal: tanpa header Authorization sama sekali", async () => {
    const server = await startServer(() => ({
      id: "c2",
      object: "chat.completion",
      created: 0,
      model: "qwen3:8b",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "dari ollama palsu" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
    const { model } = resolveModel("ollama/qwen3:8b", {
      env: { OLLAMA_HOST: server.origin },
    });
    const result = await generateText({
      model,
      messages: [{ role: "user", content: "tes" }],
    });
    expect(result.text).toBe("dari ollama palsu");
    const [request] = server.requests;
    expect(request?.path).toBe("/v1/chat/completions");
    expect(request?.headers.authorization).toBeUndefined();
    expect(request?.body.model).toBe("qwen3:8b");
  });
});
