import type { StockCandidate, StockProvider, StockSearchRequest } from "@dalang/pipeline";
import { type FetchImpl, fetchBytes, fetchJson } from "../http";

/**
 * Tenor (Google) — pustaka GIF & stiker lewat API RESMI v2 (ADR-0018).
 *
 * Endpoint diverifikasi langsung ke host: `https://tenor.googleapis.com/v2/`
 * menjawab 400 "API key not valid" untuk /search, /featured, dan /categories —
 * artinya jalurnya ada dan kunci diperiksa lebih dulu.
 *
 * Peringatan hak cipta SAMA dengan GIPHY: isi Tenor adalah unggahan pihak
 * ketiga yang kerap memuat potongan film/serial/musik. API resmi memberi jalur
 * pencarian yang sah, BUKAN hak untuk membakar isinya ke video ekspor. Lisensi
 * ditulis apa adanya dan ditandai perlu ditinjau manusia.
 */

export const TENOR_LICENSE =
  "Tenor API — konten unggahan pihak ketiga, hak cipta milik pengunggah; wajib atribusi Tenor; PERIKSA HAK PAKAI sebelum publikasi";

/** Saring konten: "high" = paling ketat (aman untuk semua umur). */
export const TENOR_DEFAULT_CONTENT_FILTER = "high";

interface TenorMedia {
  url?: string;
  /** [lebar, tinggi] */
  dims?: number[];
  duration?: number;
  size?: number;
}

interface TenorResult {
  id?: string;
  title?: string;
  content_description?: string;
  itemurl?: string;
  url?: string;
  media_formats?: Record<string, TenorMedia | undefined>;
}

export interface TenorRendition {
  url: string;
  fileExt: string;
  width: number;
  height: number;
  durationSec?: number;
}

/**
 * Pilih format terbaik, deterministik. MP4 lebih disukai (kecil, dan jalur
 * render kita sudah menanganinya); stiker butuh alfa sehingga harus GIF.
 */
export const pickTenorRendition = (
  formats: Record<string, TenorMedia | undefined>,
  { wantsTransparency }: { wantsTransparency: boolean },
): TenorRendition | null => {
  const build = (
    media: TenorMedia | undefined,
    fileExt: string,
  ): TenorRendition | null => {
    if (!media?.url) return null;
    const [width = 0, height = 0] = media.dims ?? [];
    if (width <= 0 || height <= 0) return null;
    return {
      url: media.url,
      fileExt,
      width,
      height,
      ...(typeof media.duration === "number" && media.duration > 0
        ? { durationSec: media.duration }
        : {}),
    };
  };

  if (wantsTransparency) {
    return build(formats.gif, "gif") ?? build(formats.tinygif, "gif");
  }
  return (
    build(formats.mp4, "mp4") ??
    build(formats.tinymp4, "mp4") ??
    build(formats.gif, "gif") ??
    build(formats.tinygif, "gif")
  );
};

export interface TenorOptions {
  apiKey: string;
  kind?: "gifs" | "stickers";
  /** Wajib menurut Tenor untuk memisahkan kuota antar integrasi. */
  clientKey?: string;
  contentFilter?: string;
  locale?: string;
  baseUrl?: string;
  fetchImpl?: FetchImpl;
}

export const createTenorStock = ({
  apiKey,
  kind = "gifs",
  clientKey = "dalang",
  contentFilter = TENOR_DEFAULT_CONTENT_FILTER,
  locale = "id_ID",
  baseUrl = "https://tenor.googleapis.com/v2",
  fetchImpl,
}: TenorOptions): StockProvider => {
  const wantsTransparency = kind === "stickers";
  const providerId = wantsTransparency ? "tenor-stiker" : "tenor";

  const search = async (request: StockSearchRequest): Promise<StockCandidate[]> => {
    const params = new URLSearchParams({
      key: apiKey,
      client_key: clientKey,
      q: request.query,
      limit: String(request.perPage),
      contentfilter: contentFilter,
      locale,
      // Minta hanya format yang dipakai supaya respons tetap ramping.
      media_filter: wantsTransparency ? "gif,tinygif" : "mp4,tinymp4,gif,tinygif",
    });
    if (wantsTransparency) params.set("searchfilter", "sticker");

    const json = await fetchJson<{ results?: TenorResult[] }>(
      `${baseUrl}/search?${params}`,
      {},
      `Tenor ${kind}`,
      { fetchImpl },
    );

    const candidates: StockCandidate[] = [];
    for (const result of json.results ?? []) {
      if (!result.id) continue;
      const rendition = pickTenorRendition(result.media_formats ?? {}, {
        wantsTransparency,
      });
      if (!rendition) continue;
      candidates.push({
        providerId,
        assetId: `${providerId}:${result.id}`,
        kind: rendition.fileExt === "mp4" ? "video" : "image",
        downloadUrl: rendition.url,
        fileExt: rendition.fileExt,
        width: rendition.width,
        height: rendition.height,
        ...(rendition.durationSec === undefined
          ? {}
          : { durationSec: rendition.durationSec }),
        ...(result.itemurl ? { sourceUrl: result.itemurl } : {}),
        license: TENOR_LICENSE,
        ...(result.media_formats?.tinygif?.url
          ? { thumbnailUrl: result.media_formats.tinygif.url }
          : {}),
      });
    }
    return candidates;
  };

  return {
    id: providerId,
    label: wantsTransparency ? "Tenor Stiker" : "Tenor",
    search,
    download: (candidate) =>
      fetchBytes(candidate.downloadUrl, {}, "Unduhan Tenor", { fetchImpl }),
  };
};
