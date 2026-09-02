import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  SettingsPayload,
  SettingsSaveResponse,
  SettingTestResponse,
} from "../src/shared/api-types";
import { hostJson, makeHost, postJson, type StudioOverrides } from "./helpers";

/**
 * Panel Pengaturan (ADR-0032): permukaan katalog konfigurasi untuk orang yang
 * tidak memakai terminal.
 *
 * Yang diuji di sini bukan tata letaknya, melainkan tiga janji yang kalau
 * dilanggar berarti panel ini justru berbahaya: isi kunci tidak pernah sampai
 * ke peramban, hanya kunci katalog yang bisa ditulis ke `.env`, dan nilai
 * tidak bisa menyelundupkan baris kedua.
 */

const KUNCI_UJI = [
  "ELEVENLABS_API_KEY",
  "PEXELS_API_KEY",
  "ANTHROPIC_API_KEY",
  "DALANG_LAMBDA_FUNCTION",
  "DEEPGRAM_API_KEY",
] as const;

let asli: Record<string, string | undefined> = {};
let root = "";
let envPath = "";

const bikinHost = (overrides?: StudioOverrides) =>
  makeHost(root, undefined, {
    ...overrides,
    settings: { envPath, ...(overrides?.settings ?? {}) },
  });

const ambil = async (overrides?: StudioOverrides): Promise<SettingsPayload> => {
  const { body } = await hostJson<{ ok: true; settings: SettingsPayload }>(
    bikinHost(overrides),
    "/api/workspace/settings",
  );
  return body.settings;
};

const setelan = (payload: SettingsPayload, key: string) => {
  const found = payload.capabilities
    .flatMap((capability) => capability.settings)
    .find((setting) => setting.key === key);
  if (!found) throw new Error(`Setelan ${key} tidak ada di payload`);
  return found;
};

beforeEach(() => {
  asli = Object.fromEntries(KUNCI_UJI.map((key) => [key, process.env[key]]));
  for (const key of KUNCI_UJI) delete process.env[key];
  root = mkdtempSync(join(tmpdir(), "dalang-setelan-"));
  envPath = join(root, ".env");
});

afterEach(() => {
  for (const [key, value] of Object.entries(asli)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("membaca keadaan setelan", () => {
  it("menyamarkan isi kunci rahasia dan tidak pernah mengirimkannya utuh", async () => {
    process.env.ELEVENLABS_API_KEY = "el-rahasia-yang-panjang-9876";
    const payload = await ambil();
    const eleven = setelan(payload, "ELEVENLABS_API_KEY");
    expect(eleven.filled).toBe(true);
    expect(eleven.shown).toBe("••••9876");
    // Yang paling penting: TIDAK di mana pun dalam jawabannya, bukan cuma di
    // medan yang kebetulan kami periksa.
    expect(JSON.stringify(payload)).not.toContain("el-rahasia-yang-panjang-9876");
  });

  it("nilai yang bukan rahasia tampil apa adanya, karena itu yang perlu dilihat saat salah ketik", async () => {
    process.env.DALANG_LAMBDA_FUNCTION = "dalang-render-salahketik";
    const setelanLambda = setelan(await ambil(), "DALANG_LAMBDA_FUNCTION");
    expect(setelanLambda.shown).toBe("dalang-render-salahketik");
    expect(setelanLambda.kind).not.toBe("rahasia");
  });

  it("membedakan nilai dari .env dan nilai yang di-export di terminal", async () => {
    writeFileSync(envPath, "PEXELS_API_KEY=dari-berkas\n");
    process.env.PEXELS_API_KEY = "dari-berkas";
    process.env.ANTHROPIC_API_KEY = "dari-terminal";
    const payload = await ambil();
    expect(setelan(payload, "PEXELS_API_KEY").source).toBe("berkas");
    // Ini yang bikin orang bingung berjam-jam: nilai terminal MENANG atas
    // .env setelah start ulang, jadi panel harus bisa mengatakannya.
    expect(setelan(payload, "ANTHROPIC_API_KEY").source).toBe("lingkungan");
    expect(setelan(payload, "DEEPGRAM_API_KEY").source).toBe(null);
  });

  it("membawa bahasa awam katalog: apa gunanya, apa yang tetap jalan tanpanya", async () => {
    const payload = await ambil();
    const transkrip = payload.capabilities.find((item) => item.id === "transkrip");
    expect(transkrip?.plain.length).toBeGreaterThan(20);
    expect(transkrip?.withoutIt.length).toBeGreaterThan(20);
    expect(transkrip?.alsoActiveWhen).toContain("whisper.cpp");
    const suara = payload.capabilities.find((item) => item.id === "suara");
    expect(suara?.readyWithoutConfig).toBe(true);
    expect(suara?.active).toBe(true);
  });
});

describe("menyimpan setelan", () => {
  it("menulis ke .env tanpa merusak isi orang, dan langsung berlaku", async () => {
    writeFileSync(envPath, "# punya saya\nPUNYA_ORANG_LAIN=jangan-disentuh\n");
    const { status, body } = await hostJson<SettingsSaveResponse>(
      bikinHost(),
      "/api/workspace/settings",
      postJson({ updates: { PEXELS_API_KEY: "px-baru" } }),
    );
    expect(status).toBe(200);
    expect(body.added).toEqual(["PEXELS_API_KEY"]);
    const isi = readFileSync(envPath, "utf8");
    expect(isi).toContain("# punya saya");
    expect(isi).toContain("PUNYA_ORANG_LAIN=jangan-disentuh");
    expect(isi).toContain("PEXELS_API_KEY=px-baru");
    // Berlaku SEKARANG: rantai stok dibangun ulang tiap dipakai, jadi
    // pencarian berikutnya sudah memakai kunci ini tanpa start ulang.
    expect(process.env.PEXELS_API_KEY).toBe("px-baru");
    expect(body.needsRestart).toEqual([]);
  });

  it("kunci model dilaporkan butuh start ulang, karena modelnya dipilih sekali saat start", async () => {
    const { body } = await hostJson<SettingsSaveResponse>(
      bikinHost(),
      "/api/workspace/settings",
      postJson({ updates: { ANTHROPIC_API_KEY: "sk-ant-baru" } }),
    );
    expect(body.needsRestart).toEqual(["ANTHROPIC_API_KEY"]);
  });

  it("mengosongkan nilai berarti mematikan setelannya, di berkas dan di proses", async () => {
    writeFileSync(envPath, "PEXELS_API_KEY=px-lama\n");
    process.env.PEXELS_API_KEY = "px-lama";
    const { body } = await hostJson<SettingsSaveResponse>(
      bikinHost(),
      "/api/workspace/settings",
      postJson({ updates: { PEXELS_API_KEY: "" } }),
    );
    expect(body.removed).toEqual(["PEXELS_API_KEY"]);
    expect(readFileSync(envPath, "utf8")).toContain("# PEXELS_API_KEY=px-lama");
    expect(process.env.PEXELS_API_KEY).toBeUndefined();
  });

  it("MENOLAK kunci di luar katalog: kotak teks di halaman web tidak boleh jadi cara menitipkan NODE_OPTIONS", async () => {
    writeFileSync(envPath, "PEXELS_API_KEY=px-lama\n");
    const sebelum = process.env.NODE_OPTIONS;
    const { status, body } = await hostJson<{ error: string }>(
      bikinHost(),
      "/api/workspace/settings",
      postJson({
        updates: { PEXELS_API_KEY: "px-baru", NODE_OPTIONS: "--require /tmp/jahat.js" },
      }),
    );
    expect(status).toBe(400);
    expect(body.error).toContain("NODE_OPTIONS");
    // Seluruh permintaan ditolak: yang sah pun tidak ikut tertulis, supaya
    // tidak ada keadaan setengah jadi yang harus ditebak orang.
    expect(readFileSync(envPath, "utf8")).toBe("PEXELS_API_KEY=px-lama\n");
    expect(process.env.NODE_OPTIONS).toBe(sebelum);
    expect(process.env.PEXELS_API_KEY).toBeUndefined();
  });

  it("MENOLAK nilai berisi baris baru, yang bisa menyelundupkan variabel kedua", async () => {
    const { status, body } = await hostJson<{ error: string }>(
      bikinHost(),
      "/api/workspace/settings",
      postJson({
        updates: { PEXELS_API_KEY: "px\nNODE_OPTIONS=--require /tmp/jahat.js" },
      }),
    );
    expect(status).toBe(400);
    expect(body.error).toContain("baris baru");
    expect(process.env.PEXELS_API_KEY).toBeUndefined();
  });
});

describe("menguji kunci dari panel", () => {
  const jawab = (status: number): typeof fetch =>
    (async () => new Response(null, { status })) as unknown as typeof fetch;

  it("mengembalikan hasil uji tanpa pernah menyebut kembali nilai yang dikirim", async () => {
    const { body } = await hostJson<SettingTestResponse>(
      bikinHost({ settings: { fetchImpl: jawab(200) } }),
      "/api/workspace/settings/test",
      postJson({ key: "PEXELS_API_KEY", value: "px-rahasia-4321" }),
    );
    expect(body.status).toBe("ok");
    expect(JSON.stringify(body)).not.toContain("px-rahasia-4321");
  });

  it("kunci yang ditolak layanannya dilaporkan gagal dengan sebabnya", async () => {
    const { body } = await hostJson<SettingTestResponse>(
      bikinHost({ settings: { fetchImpl: jawab(401) } }),
      "/api/workspace/settings/test",
      postJson({ key: "PEXELS_API_KEY", value: "salah" }),
    );
    expect(body.status).toBe("gagal");
    expect(body.detail).toContain("menolak");
  });

  it("tanpa nilai, yang diuji adalah yang sedang terpasang", async () => {
    process.env.PEXELS_API_KEY = "px-terpasang";
    const { body } = await hostJson<SettingTestResponse>(
      bikinHost({ settings: { fetchImpl: jawab(200) } }),
      "/api/workspace/settings/test",
      postJson({ key: "PEXELS_API_KEY" }),
    );
    expect(body.status).toBe("ok");
  });

  it("setelan kosong dikatakan belum ada nilainya, bukan dilaporkan hijau", async () => {
    const { body } = await hostJson<SettingTestResponse>(
      bikinHost(),
      "/api/workspace/settings/test",
      postJson({ key: "PEXELS_API_KEY" }),
    );
    expect(body.status).toBe("tak-diuji");
  });

  it("kunci di luar katalog ditolak, bukan diteruskan ke jaringan", async () => {
    const { status, body } = await hostJson<{ error: string }>(
      bikinHost(),
      "/api/workspace/settings/test",
      postJson({ key: "AWS_SESSION_TOKEN", value: "apa-saja" }),
    );
    expect(status).toBe(400);
    expect(body.error).toContain("AWS_SESSION_TOKEN");
  });
});
