import type { StockCandidate, StockProvider, StockSearchRequest } from "@dalang/pipeline";
import { type FetchImpl, fetchBytes, fetchJson } from "../http";

/**
 * GIPHY — pustaka GIF & stiker lewat API RESMI (ADR-0018).
 *
 * Bentuk respons di bawah bukan hasil ingatan: ia disalin dari paket tipe
 * terbitan GIPHY sendiri (`@giphy/js-types`) dan pembentukan URL-nya dari SDK
 * resmi `@giphy/js-fetch-api` (base `https://api.giphy.com/v1/`, jalur
 * `gifs/search` dan `stickers/search`).
 *
 * DUA HAL YANG HARUS JUJUR DISEBUT:
 *
 * 1. GIF di GIPHY adalah unggahan pihak ketiga dan SANGAT SERING memuat
 *    potongan film, serial, atau musik berhak cipta. Punya API resmi berarti
 *    kita boleh MENCARI dan MENAMPILKAN lewat jalur mereka — itu tidak sama
 *    dengan mengantongi hak untuk membakarnya ke video ekspor. Karena itu
 *    lisensinya TIDAK pernah ditulis "bebas pakai"; ia ditandai perlu ditinjau
 *    manusia, dan `critiquePlan` menegur bila aset semacam ini terpakai.
 * 2. GIPHY mensyaratkan atribusi ("Powered By GIPHY") di permukaan yang
 *    memakai hasilnya. `sourceUrl` + `author` selalu disimpan agar atribusi
 *    bisa ditampilkan dan diaudit (PRD §10 / R-10).
 */

/** Ditulis apa adanya ke plan supaya audit lisensi tidak pernah menebak. */
export const GIPHY_LICENSE =
  "GIPHY API — konten unggahan pihak ketiga, hak cipta milik pengunggah; wajib atribusi GIPHY; PERIKSA HAK PAKAI sebelum publikasi";

/** Peringkat konten bawaan: aman untuk semua umur. */
export const GIPHY_DEFAULT_RATING = "g";

interface GiphyImage {
  url?: string;
  width?: string | number;
  height?: string | number;
  mp4?: string;
  webp?: string;
}

interface GiphyGif {
  id: string | number;
  type?: string;
  title?: string;
  alt_text?: string;
  url?: string;
  username?: string;
  source?: string;
  is_sticker?: boolean;
  user?: { display_name?: string; username?: string };
  images: Record<string, GiphyImage | undefined>;
}

/** Dimensi GIPHY datang sebagai STRING di JSON walau tipenya bilangan. */
const toNumber = (value: string | number | undefined): number => {
  const parsed = typeof value === "number" ? value : Number(value ?? Number.NaN);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export interface GiphyRendition {
  url: string;
  fileExt: string;
  width: number;
  height: number;
}

/**
 * Pilih rendition terbaik, deterministik.
 *
 * MP4 lebih disukai untuk GIF biasa: jauh lebih kecil dan jalur render kita
 * sudah menanganinya sebagai video. Tapi MP4 TIDAK punya kanal alfa, sehingga
 * stiker (yang gunanya justru latar tembus pandang) harus tetap WebP/GIF.
 */
export const pickGiphyRendition = (
  images: Record<string, GiphyImage | undefined>,
  { wantsTransparency }: { wantsTransparency: boolean },
): GiphyRendition | null => {
  const original = images.original;
  const dims = (image: GiphyImage | undefined) => ({
    width: toNumber(image?.width),
    height: toNumber(image?.height),
  });

  if (wantsTransparency) {
    const webp = original?.webp ?? images.fixed_width?.webp;
    if (webp)
      return { url: webp, fileExt: "webp", ...dims(original ?? images.fixed_width) };
    const gif = original?.url ?? images.fixed_width?.url;
    if (gif) return { url: gif, fileExt: "gif", ...dims(original ?? images.fixed_width) };
    return null;
  }

  const mp4 = original?.mp4 ?? images.original_mp4?.mp4 ?? images.fixed_width?.mp4;
  if (mp4) {
    const source = original?.mp4 ? original : (images.original_mp4 ?? images.fixed_width);
    return { url: mp4, fileExt: "mp4", ...dims(source) };
  }
  const gif = original?.url;
  if (gif) return { url: gif, fileExt: "gif", ...dims(original) };
  return null;
};

export interface GiphyOptions {
  apiKey: string;
  /** "gifs" (bawaan) atau "stickers" — stiker berlatar tembus pandang. */
  kind?: "gifs" | "stickers";
  rating?: string;
  lang?: string;
  baseUrl?: string;
  fetchImpl?: FetchImpl;
}

export const createGiphyStock = ({
  apiKey,
  kind = "gifs",
  rating = GIPHY_DEFAULT_RATING,
  lang = "id",
  baseUrl = "https://api.giphy.com/v1",
  fetchImpl,
}: GiphyOptions): StockProvider => {
  const wantsTransparency = kind === "stickers";
  const providerId = wantsTransparency ? "giphy-stiker" : "giphy";

  const search = async (request: StockSearchRequest): Promise<StockCandidate[]> => {
    const params = new URLSearchParams({
      api_key: apiKey,
      q: request.query,
      limit: String(request.perPage),
      offset: "0",
      rating,
      lang,
    });
    const json = await fetchJson<{ data?: GiphyGif[] }>(
      `${baseUrl}/${kind}/search?${params}`,
      {},
      `GIPHY ${kind}`,
      { fetchImpl },
    );

    const candidates: StockCandidate[] = [];
    for (const gif of json.data ?? []) {
      const rendition = pickGiphyRendition(gif.images ?? {}, { wantsTransparency });
      if (!rendition) continue;
      const author =
        gif.user?.display_name || gif.user?.username || gif.username || gif.source;
      candidates.push({
        providerId,
        assetId: `${providerId}:${gif.id}`,
        // MP4 masuk jalur video; WebP/GIF diperlakukan sebagai gambar (untuk
        // stiker, frame pertama sudah cukup sebagai tempelan statis).
        kind: rendition.fileExt === "mp4" ? "video" : "image",
        downloadUrl: rendition.url,
        fileExt: rendition.fileExt,
        width: rendition.width,
        height: rendition.height,
        ...(author ? { author } : {}),
        ...(gif.url ? { sourceUrl: gif.url } : {}),
        license: GIPHY_LICENSE,
        ...(gif.images.preview_gif?.url
          ? { thumbnailUrl: gif.images.preview_gif.url }
          : {}),
      });
    }
    return candidates;
  };

  return {
    id: providerId,
    label: wantsTransparency ? "GIPHY Stiker" : "GIPHY",
    search,
    download: (candidate) =>
      fetchBytes(candidate.downloadUrl, {}, "Unduhan GIPHY", { fetchImpl }),
  };
};
