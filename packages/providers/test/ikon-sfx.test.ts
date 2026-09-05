import { describe, expect, it } from "vitest";
import {
  COMMERCIAL_SAFE_SPDX,
  createIconifyIcons,
  createOpenverseSfx,
  judgeIconLicense,
  OPENVERSE_SAFE_LICENSES,
} from "../src/index";

/**
 * ADR-0018. Yang diuji terutama adalah PENJAGA LISENSI: bagian yang mudah
 * terlewat justru bagian yang paling mahal kalau salah.
 */

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const textResponse = (body: string) =>
  new Response(body, { status: 200, headers: { "content-type": "image/svg+xml" } });

// ---------------------------------------------------------------------------
// Iconify
// ---------------------------------------------------------------------------

describe("judgeIconLicense", () => {
  it("lisensi permisif dinilai aman untuk komersial", () => {
    expect(judgeIconLicense({ spdx: "MIT", title: "MIT" })).toEqual({
      commercialSafe: true,
      needsAttribution: false,
    });
    expect(judgeIconLicense({ spdx: "CC0-1.0", title: "CC0" }).commercialSafe).toBe(true);
  });

  it("lisensi berkredit ditandai wajib atribusi tapi tetap aman", () => {
    for (const spdx of ["CC-BY-4.0", "OFL-1.1", "Apache-2.0"]) {
      const judged = judgeIconLicense({ spdx, title: spdx });
      expect(judged.commercialSafe).toBe(true);
      expect(judged.needsAttribution).toBe(true);
    }
  });

  it("NonCommercial DITOLAK — ini jebakan utama Iconify", () => {
    expect(judgeIconLicense({ spdx: "CC-BY-NC-4.0" }).commercialSafe).toBe(false);
    expect(judgeIconLicense({ spdx: "CC-BY-NC-SA-4.0" }).commercialSafe).toBe(false);
    // Terdeteksi juga bila hanya judulnya yang menyebutkan.
    expect(judgeIconLicense({ title: "NonCommercial" }).commercialSafe).toBe(false);
  });

  it("lisensi tak dikenal diperlakukan TIDAK aman (daftar putih, bukan hitam)", () => {
    expect(judgeIconLicense({ spdx: "LisensiEntahApa" }).commercialSafe).toBe(false);
    expect(judgeIconLicense(undefined).commercialSafe).toBe(false);
  });

  it("daftar putih tidak memuat satu pun lisensi NonCommercial", () => {
    expect(COMMERCIAL_SAFE_SPDX.filter((spdx) => /-NC(-|$)/i.test(spdx))).toEqual([]);
  });
});

describe("provider Iconify", () => {
  const searchBody = {
    icons: ["mdi:home", "kucing-nc:ekor", "ph:camera"],
    collections: {
      mdi: {
        name: "Material Design Icons",
        author: { name: "Pictogrammers", url: "https://pictogrammers.com" },
        license: { title: "Apache 2.0", spdx: "Apache-2.0", url: "https://x/lic" },
      },
      "kucing-nc": {
        name: "Set NonCommercial",
        license: { title: "CC BY-NC 4.0", spdx: "CC-BY-NC-4.0" },
      },
      ph: { name: "Phosphor", license: { title: "MIT", spdx: "MIT" } },
    },
  };

  it("membuang set NonCommercial dari hasil secara bawaan", async () => {
    const provider = createIconifyIcons({
      fetchImpl: async () => jsonResponse(searchBody),
    });
    const found = await provider.search("rumah", 10);
    expect(found.map((icon) => icon.iconId)).toEqual(["mdi:home", "ph:camera"]);
  });

  it("membawa lisensi, penulis, dan tanda atribusi per set", async () => {
    const provider = createIconifyIcons({
      fetchImpl: async () => jsonResponse(searchBody),
    });
    const [first] = await provider.search("rumah", 10);
    expect(first).toMatchObject({
      providerId: "iconify",
      iconId: "mdi:home",
      setPrefix: "mdi",
      setName: "Material Design Icons",
      license: "Apache 2.0",
      licenseSpdx: "Apache-2.0",
      author: "Pictogrammers",
      needsAttribution: true,
      commercialSafe: true,
    });
  });

  it("set NonCommercial bisa diminta eksplisit, tapi tetap ditandai tidak aman", async () => {
    const provider = createIconifyIcons({
      includeNonCommercial: true,
      fetchImpl: async () => jsonResponse(searchBody),
    });
    const found = await provider.search("rumah", 10);
    const nc = found.find((icon) => icon.setPrefix === "kucing-nc");
    expect(nc?.commercialSafe).toBe(false);
  });

  it("menghormati batas minimum limit=32 milik Iconify", async () => {
    let seen = "";
    const provider = createIconifyIcons({
      fetchImpl: async (url) => {
        seen = String(url);
        return jsonResponse(searchBody);
      },
    });
    await provider.search("rumah", 5);
    expect(seen).toContain("limit=32");
  });

  it("mengambil SVG dengan warna dan tinggi, dan menolak id yang salah bentuk", async () => {
    let seen = "";
    const provider = createIconifyIcons({
      fetchImpl: async (url) => {
        seen = String(url);
        return textResponse("<svg/>");
      },
    });
    const svg = await provider.fetchSvg("mdi:home", { color: "#e8a33d", height: 96 });
    expect(svg).toBe("<svg/>");
    expect(seen).toContain("/mdi/home.svg?");
    // "#" WAJIB ter-encode, kalau tidak seluruh sisanya jadi fragment URL.
    expect(seen).toContain("color=%23e8a33d");
    expect(seen).toContain("height=96");

    await expect(provider.fetchSvg("tanpatitikdua")).rejects.toThrow("tidak sah");
  });
});

// ---------------------------------------------------------------------------
// Openverse
// ---------------------------------------------------------------------------

describe("provider Openverse (efek suara)", () => {
  const audio = {
    id: "abc-123",
    title: "Whoosh pendek",
    url: "https://cdn.openverse.org/abc-123.mp3",
    license: "cc0",
    license_version: "1.0",
    attribution: '"Whoosh pendek" ditandai CC0 1.0',
    creator: "seseorang",
    foreign_landing_url: "https://freesound.org/s/1",
    filetype: "MP3",
    duration: 1450,
  };

  it("meminta hanya lisensi yang bebas dipakai komersial", async () => {
    let seen = "";
    const provider = createOpenverseSfx({
      fetchImpl: async (url) => {
        seen = String(url);
        return jsonResponse({ results: [audio] });
      },
    });
    await provider.search("whoosh", 5);
    expect(seen).toContain("/audio/?");
    expect(seen).toContain(`license=${encodeURIComponent(OPENVERSE_SAFE_LICENSES)}`);
    expect(OPENVERSE_SAFE_LICENSES).toBe("cc0,pdm");
  });

  it("durasi milidetik diubah ke detik, dan ekstensi dinormalkan", async () => {
    const provider = createOpenverseSfx({
      fetchImpl: async () => jsonResponse({ results: [audio] }),
    });
    const [found] = await provider.search("whoosh", 5);
    expect(found).toMatchObject({
      providerId: "openverse",
      assetId: "openverse:abc-123",
      fileExt: "mp3",
      durationSec: 1.45,
      license: "cc0 1.0",
      attribution: '"Whoosh pendek" ditandai CC0 1.0',
      commercialSafe: true,
    });
  });

  it("sabuk pengaman kedua: hasil NonCommercial tetap dibuang di sisi kita", async () => {
    const provider = createOpenverseSfx({
      fetchImpl: async () =>
        jsonResponse({
          results: [
            { ...audio, id: "nc-1", license: "by-nc" },
            { ...audio, id: "ncsa-1", license: "by-nc-sa" },
            audio,
          ],
        }),
    });
    const found = await provider.search("whoosh", 10);
    expect(found.map((sfx) => sfx.assetId)).toEqual(["openverse:abc-123"]);
  });

  it("hasil tanpa id atau tanpa url dilewati, bukan melempar", async () => {
    const provider = createOpenverseSfx({
      fetchImpl: async () =>
        jsonResponse({ results: [{ title: "tanpa id" }, { id: "x" }, audio] }),
    });
    await expect(provider.search("whoosh", 10)).resolves.toHaveLength(1);
  });

  it("token opsional — tanpa token pun tetap bisa mencari", async () => {
    let headers: unknown;
    const provider = createOpenverseSfx({
      fetchImpl: async (_url, init) => {
        headers = (init as RequestInit).headers;
        return jsonResponse({ results: [audio] });
      },
    });
    await provider.search("whoosh", 5);
    expect(headers).toEqual({});
  });
});
