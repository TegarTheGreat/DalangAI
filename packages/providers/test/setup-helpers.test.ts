import { describe, expect, it } from "vitest";
import { isProbeable, parseEnv, probeSetting, upsertEnv } from "../src";

/**
 * Dua penopang wizard konfigurasi (ADR-0032): penulis `.env` yang tidak
 * merusak isi orang, dan penguji kunci yang jujur soal apa yang ia periksa.
 */

const fakeFetch = (
  handler: (url: string, init: RequestInit) => { status: number },
): { calls: Array<{ url: string; init: RequestInit }>; impl: typeof fetch } => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    const { status } = handler(url, init);
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  return { calls, impl };
};

describe("menyunting .env orang lain", () => {
  const existing = [
    "# catatan pribadi milik pemiliknya",
    "PEXELS_API_KEY=lama",
    "",
    "# ELEVENLABS_API_KEY=",
    "PUNYA_ORANG_LAIN=jangan-disentuh",
  ].join("\n");

  it("mengganti di tempatnya, menghidupkan yang dikomentari, menambah yang baru", () => {
    const result = upsertEnv(
      existing,
      { PEXELS_API_KEY: "baru", ELEVENLABS_API_KEY: "el-123", DEEPGRAM_API_KEY: "dg-1" },
      { heading: "Ditambahkan oleh dalang setup" },
    );
    expect(result.replaced.sort()).toEqual(["ELEVENLABS_API_KEY", "PEXELS_API_KEY"]);
    expect(result.added).toEqual(["DEEPGRAM_API_KEY"]);
    const lines = result.text.split("\n");
    // Komentar dan variabel milik orang lain tetap utuh, di tempat semula.
    expect(lines[0]).toBe("# catatan pribadi milik pemiliknya");
    expect(result.text).toContain("PUNYA_ORANG_LAIN=jangan-disentuh");
    // Yang dikomentari dihidupkan DI BARISNYA, bukan ditambah di akhir.
    expect(lines[3]).toBe("ELEVENLABS_API_KEY=el-123");
    expect(result.text).toContain(
      "# Ditambahkan oleh dalang setup\nDEEPGRAM_API_KEY=dg-1",
    );
    expect(result.text.endsWith("\n")).toBe(true);
  });

  it("mengosongkan nilai berarti mengomentari barisnya, bukan menyisakan KEY= kosong", () => {
    const result = upsertEnv(existing, { PEXELS_API_KEY: "" });
    expect(result.removed).toEqual(["PEXELS_API_KEY"]);
    expect(result.text).toContain("# PEXELS_API_KEY=lama");
    expect(result.text).not.toMatch(/^PEXELS_API_KEY=/m);
  });

  it("nilai bertanda baca dikutip supaya tidak terpotong, dan terbaca kembali utuh", () => {
    const result = upsertEnv("", { DALANG_HOME: "/home/ada spasi/#tagar" });
    expect(result.text).toContain('DALANG_HOME="/home/ada spasi/#tagar"');
    expect(parseEnv(result.text).DALANG_HOME).toBe("/home/ada spasi/#tagar");
  });

  it("berkas kosong menghasilkan berkas yang sah, bukan baris nyasar", () => {
    const result = upsertEnv("", { PEXELS_API_KEY: "abc" });
    expect(result.text).toBe("PEXELS_API_KEY=abc\n");
  });
});

describe("menguji kunci ke layanan sungguhan", () => {
  it("memakai skema otentikasi yang benar per layanan", async () => {
    const { calls, impl } = fakeFetch(() => ({ status: 200 }));
    await probeSetting("ANTHROPIC_API_KEY", "sk-ant-1", { fetchImpl: impl });
    await probeSetting("PEXELS_API_KEY", "px-1", { fetchImpl: impl });
    await probeSetting("DEEPGRAM_API_KEY", "dg-1", { fetchImpl: impl });
    await probeSetting("YOUTUBE_ACCESS_TOKEN", "ya29-1", { fetchImpl: impl });
    const header = (index: number, name: string) => {
      const init = (calls[index] as { init: RequestInit }).init;
      return (init.headers as Record<string, string>)[name];
    };
    expect(header(0, "x-api-key")).toBe("sk-ant-1");
    expect(header(1, "authorization")).toBe("px-1");
    expect(header(2, "authorization")).toBe("Token dg-1");
    expect(header(3, "authorization")).toBe("Bearer ya29-1");
    // Semuanya permintaan baca yang murah, bukan yang menghasilkan sesuatu.
    for (const { init } of calls) expect(init.method ?? "GET").toBe("GET");
  });

  it("401 dan 403 berarti kunci ditolak; 429 tetap berhasil", async () => {
    const ditolak = await probeSetting("OPENAI_API_KEY", "salah", {
      fetchImpl: fakeFetch(() => ({ status: 401 })).impl,
    });
    expect(ditolak.status).toBe("gagal");
    expect(ditolak.detail).toContain("menolak");

    // Batas laju hanya bisa terjadi setelah kuncinya diterima.
    const batas = await probeSetting("OPENAI_API_KEY", "benar", {
      fetchImpl: fakeFetch(() => ({ status: 429 })).impl,
    });
    expect(batas.status).toBe("ok");
    expect(batas.detail).toContain("batas laju");
  });

  it("token YouTube yang ditolak menyebut kedaluwarsa, karena itu sebab tersering", async () => {
    const hasil = await probeSetting("YOUTUBE_ACCESS_TOKEN", "kedaluwarsa", {
      fetchImpl: fakeFetch(() => ({ status: 401 })).impl,
    });
    expect(hasil.status).toBe("gagal");
    expect(hasil.detail).toContain("satu jam");
  });

  it("setelan path diuji dengan keberadaan berkasnya", async () => {
    const ada = await probeSetting("WHISPER_CPP_BIN", "/usr/local/bin/whisper-cli", {
      exists: () => true,
    });
    expect(ada.status).toBe("ok");
    const tidak = await probeSetting("WHISPER_CPP_BIN", "/salah/jalan", {
      exists: () => false,
    });
    expect(tidak.status).toBe("gagal");
    expect(tidak.detail).toContain("/salah/jalan");
  });

  it("yang tidak bisa diuji dikatakan apa adanya, tidak dilaporkan hijau", async () => {
    const kosong = await probeSetting("PEXELS_API_KEY", "   ");
    expect(kosong.status).toBe("tak-diuji");
    const takAdaPenguji = await probeSetting("DALANG_HOME", "/rumah");
    expect(takAdaPenguji.status).toBe("tak-diuji");
    expect(isProbeable("DALANG_HOME")).toBe(false);
    expect(isProbeable("PEXELS_API_KEY")).toBe(true);
    expect(isProbeable("WHISPER_CPP_BIN")).toBe(true);
  });

  it("layanan yang tidak menjawab dilaporkan sebagai gangguan jaringan, bukan kunci salah", async () => {
    const impl = (async () => {
      throw new Error("The operation timed out.");
    }) as unknown as typeof fetch;
    const hasil = await probeSetting("PIXABAY_API_KEY", "abc", { fetchImpl: impl });
    expect(hasil.status).toBe("gagal");
    expect(hasil.detail).toContain("detik");
    expect(hasil.detail).not.toContain("menolak");
  });
});
