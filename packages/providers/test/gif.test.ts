import { describe, expect, it } from "vitest";
import {
  buildGifChain,
  buildStockChain,
  createGiphyStock,
  createTenorStock,
  GIPHY_LICENSE,
  pickGiphyRendition,
  pickTenorRendition,
  TENOR_LICENSE,
} from "../src/index";

/**
 * ADR-0018. Bentuk fixture di bawah mengikuti kontrak RESMI:
 *  - GIPHY: paket tipe terbitan GIPHY `@giphy/js-types` (IGif + IImages), dan
 *    dimensinya sengaja ditulis sebagai STRING seperti JSON aslinya.
 *  - Tenor: media_formats { url, dims:[w,h], duration, size } sesuai v2.
 */

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const request = {
  query: "kucing",
  kind: "video" as const,
  orientation: "landscape" as const,
  perPage: 2,
};

// ---------------------------------------------------------------------------
// GIPHY
// ---------------------------------------------------------------------------

const giphyImages = {
  original: {
    url: "https://media.giphy.com/abc/giphy.gif",
    width: "480",
    height: "270",
    mp4: "https://media.giphy.com/abc/giphy.mp4",
    webp: "https://media.giphy.com/abc/giphy.webp",
  },
  original_mp4: {
    width: "480",
    height: "270",
    mp4: "https://media.giphy.com/abc/alt.mp4",
  },
  preview_gif: {
    url: "https://media.giphy.com/abc/preview.gif",
    width: "90",
    height: "50",
  },
  fixed_width: {
    url: "https://media.giphy.com/abc/200w.gif",
    width: "200",
    height: "112",
    mp4: "https://media.giphy.com/abc/200w.mp4",
    webp: "https://media.giphy.com/abc/200w.webp",
  },
};

describe("pickGiphyRendition", () => {
  it("memilih MP4 untuk GIF biasa (jauh lebih kecil, jalur render sudah ada)", () => {
    const picked = pickGiphyRendition(giphyImages, { wantsTransparency: false });
    expect(picked).toEqual({
      url: "https://media.giphy.com/abc/giphy.mp4",
      fileExt: "mp4",
      width: 480,
      height: 270,
    });
  });

  it("stiker TIDAK boleh MP4 — MP4 tidak punya kanal alfa", () => {
    const picked = pickGiphyRendition(giphyImages, { wantsTransparency: true });
    expect(picked?.fileExt).toBe("webp");
    expect(picked?.url).toContain(".webp");
  });

  it("mundur ke original_mp4 lalu fixed_width bila original tanpa mp4", () => {
    const noMp4 = {
      ...giphyImages,
      original: { ...giphyImages.original, mp4: undefined },
    };
    expect(pickGiphyRendition(noMp4, { wantsTransparency: false })?.url).toContain(
      "alt.mp4",
    );
  });

  it("mengembalikan null bila tidak ada rendition yang bisa dipakai", () => {
    expect(pickGiphyRendition({}, { wantsTransparency: false })).toBeNull();
    expect(pickGiphyRendition({}, { wantsTransparency: true })).toBeNull();
  });
});

describe("provider GIPHY", () => {
  const gif = {
    id: "xyz123",
    type: "gif",
    title: "kucing lompat",
    url: "https://giphy.com/gifs/xyz123",
    username: "studioanu",
    user: { display_name: "Studio Anu" },
    images: giphyImages,
  };

  it("memanggil jalur resmi gifs/search dengan api_key, q, limit, rating", async () => {
    let seen = "";
    const provider = createGiphyStock({
      apiKey: "K",
      fetchImpl: async (url) => {
        seen = String(url);
        return jsonResponse({ data: [gif] });
      },
    });
    await provider.search(request);
    expect(seen).toContain("/v1/gifs/search?");
    expect(seen).toContain("api_key=K");
    expect(seen).toContain("q=kucing");
    expect(seen).toContain("limit=2");
    // Peringkat konten bawaan harus aman untuk semua umur.
    expect(seen).toContain("rating=g");
  });

  it("memetakan hasil jadi kandidat video ber-atribusi dan berlisensi apa adanya", async () => {
    const provider = createGiphyStock({
      apiKey: "K",
      fetchImpl: async () => jsonResponse({ data: [gif] }),
    });
    const [candidate] = await provider.search(request);
    expect(candidate).toMatchObject({
      providerId: "giphy",
      assetId: "giphy:xyz123",
      kind: "video",
      fileExt: "mp4",
      width: 480,
      height: 270,
      author: "Studio Anu",
      sourceUrl: "https://giphy.com/gifs/xyz123",
      license: GIPHY_LICENSE,
      thumbnailUrl: "https://media.giphy.com/abc/preview.gif",
    });
  });

  it("lisensi menyatakan terus terang bahwa hak pakai harus diperiksa", () => {
    expect(GIPHY_LICENSE).toContain("PERIKSA HAK PAKAI");
    expect(GIPHY_LICENSE).toContain("atribusi");
  });

  it("mode stiker memakai jalur stickers/search dan id provider terpisah", async () => {
    let seen = "";
    const provider = createGiphyStock({
      apiKey: "K",
      kind: "stickers",
      fetchImpl: async (url) => {
        seen = String(url);
        return jsonResponse({ data: [gif] });
      },
    });
    expect(provider.id).toBe("giphy-stiker");
    const [candidate] = await provider.search(request);
    expect(seen).toContain("/v1/stickers/search?");
    expect(candidate?.kind).toBe("image");
  });

  it("melewati entri tanpa rendition, bukan melempar", async () => {
    const provider = createGiphyStock({
      apiKey: "K",
      fetchImpl: async () => jsonResponse({ data: [{ id: "kosong", images: {} }, gif] }),
    });
    const found = await provider.search(request);
    expect(found).toHaveLength(1);
    expect(found[0]?.assetId).toBe("giphy:xyz123");
  });

  it("respons tanpa data sama sekali menghasilkan daftar kosong", async () => {
    const provider = createGiphyStock({
      apiKey: "K",
      fetchImpl: async () => jsonResponse({}),
    });
    await expect(provider.search(request)).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tenor
// ---------------------------------------------------------------------------

const tenorFormats = {
  mp4: {
    url: "https://media.tenor.com/abc/video.mp4",
    dims: [498, 280],
    duration: 2.4,
    size: 51_200,
  },
  gif: {
    url: "https://media.tenor.com/abc/anim.gif",
    dims: [498, 280],
    duration: 2.4,
    size: 512_000,
  },
  tinygif: {
    url: "https://media.tenor.com/abc/tiny.gif",
    dims: [220, 124],
    duration: 2.4,
    size: 51_200,
  },
};

describe("pickTenorRendition", () => {
  it("memilih MP4 untuk GIF biasa dan membawa durasinya", () => {
    expect(pickTenorRendition(tenorFormats, { wantsTransparency: false })).toEqual({
      url: "https://media.tenor.com/abc/video.mp4",
      fileExt: "mp4",
      width: 498,
      height: 280,
      durationSec: 2.4,
    });
  });

  it("stiker memakai GIF supaya alfa tidak hilang", () => {
    expect(pickTenorRendition(tenorFormats, { wantsTransparency: true })?.fileExt).toBe(
      "gif",
    );
  });

  it("menolak format tanpa dimensi yang sah", () => {
    expect(
      pickTenorRendition(
        { mp4: { url: "https://x/y.mp4", dims: [0, 0] } },
        { wantsTransparency: false },
      ),
    ).toBeNull();
    expect(pickTenorRendition({}, { wantsTransparency: false })).toBeNull();
  });
});

describe("provider Tenor", () => {
  const result = {
    id: "9876",
    content_description: "kucing lompat",
    itemurl: "https://tenor.com/view/kucing-9876",
    media_formats: tenorFormats,
  };

  it("memanggil v2/search dengan key, client_key, contentfilter ketat, media_filter", async () => {
    let seen = "";
    const provider = createTenorStock({
      apiKey: "K",
      fetchImpl: async (url) => {
        seen = String(url);
        return jsonResponse({ results: [result] });
      },
    });
    await provider.search(request);
    expect(seen).toContain("/v2/search?");
    expect(seen).toContain("key=K");
    expect(seen).toContain("client_key=dalang");
    expect(seen).toContain("contentfilter=high");
    expect(seen).toContain("media_filter=mp4");
  });

  it("memetakan hasil jadi kandidat berlisensi apa adanya", async () => {
    const provider = createTenorStock({
      apiKey: "K",
      fetchImpl: async () => jsonResponse({ results: [result] }),
    });
    const [candidate] = await provider.search(request);
    expect(candidate).toMatchObject({
      providerId: "tenor",
      assetId: "tenor:9876",
      kind: "video",
      fileExt: "mp4",
      durationSec: 2.4,
      sourceUrl: "https://tenor.com/view/kucing-9876",
      license: TENOR_LICENSE,
    });
  });

  it("mode stiker menyalakan searchfilter=sticker", async () => {
    let seen = "";
    const provider = createTenorStock({
      apiKey: "K",
      kind: "stickers",
      fetchImpl: async (url) => {
        seen = String(url);
        return jsonResponse({ results: [result] });
      },
    });
    await provider.search(request);
    expect(seen).toContain("searchfilter=sticker");
    expect(provider.id).toBe("tenor-stiker");
  });

  it("melewati hasil tanpa id atau tanpa format", async () => {
    const provider = createTenorStock({
      apiKey: "K",
      fetchImpl: async () =>
        jsonResponse({ results: [{ media_formats: tenorFormats }, { id: "x" }, result] }),
    });
    const found = await provider.search(request);
    expect(found).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Rantai
// ---------------------------------------------------------------------------

describe("urutan rantai menjaga lisensi (ADR-0018)", () => {
  it("aset berlisensi jelas selalu di DEPAN GIF unggahan pihak ketiga", () => {
    const chain = buildStockChain({
      env: {
        PEXELS_API_KEY: "p",
        PIXABAY_API_KEY: "q",
        GIPHY_API_KEY: "g",
        TENOR_API_KEY: "t",
      },
    });
    expect(chain.map((provider) => provider.id)).toEqual([
      "pexels",
      "pixabay",
      "giphy",
      "tenor",
    ]);
  });

  it("tanpa kunci, rantai GIF kosong — bukan error, cuma tidak tersedia", () => {
    expect(buildGifChain({ env: {} })).toEqual([]);
  });

  it("rantai GIF terpisah dan bisa diminta versi stiker", () => {
    const gifs = buildGifChain({ env: { GIPHY_API_KEY: "g", TENOR_API_KEY: "t" } });
    expect(gifs.map((provider) => provider.id)).toEqual(["giphy", "tenor"]);
    const stickers = buildGifChain({
      env: { GIPHY_API_KEY: "g", TENOR_API_KEY: "t" },
      stickers: true,
    });
    expect(stickers.map((provider) => provider.id)).toEqual([
      "giphy-stiker",
      "tenor-stiker",
    ]);
  });
});
