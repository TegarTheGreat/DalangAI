import type {
  StockCandidate,
  StockOrientation,
  StockProvider,
  StockSearchRequest,
} from "@dalang/pipeline";
import { type FetchImpl, fetchBytes, fetchJson } from "../http";

/**
 * Pixabay — fallback stock provider (PRD §4.2). License recorded verbatim
 * (R-10): free for commercial use, no attribution required, redistribution
 * or standalone sale of unaltered content prohibited.
 */

export const PIXABAY_LICENSE = "Pixabay Content License";

interface PixabayImageHit {
  id: number;
  pageURL: string;
  imageWidth: number;
  imageHeight: number;
  largeImageURL: string;
  user: string;
}

interface PixabayVideoVariant {
  url: string;
  width: number;
  height: number;
}

interface PixabayVideoHit {
  id: number;
  pageURL: string;
  duration: number;
  user: string;
  videos: Record<string, PixabayVideoVariant>;
}

/** horizontal | vertical | all — Pixabay has no "square". */
export const pixabayOrientation = (
  orientation: StockOrientation,
): "horizontal" | "vertical" | "all" =>
  orientation === "landscape"
    ? "horizontal"
    : orientation === "portrait"
      ? "vertical"
      : "all";

/** Same deterministic rule as Pexels: smallest variant with short side ≥ min. */
export const pickPixabayVideoVariant = (
  variants: Record<string, PixabayVideoVariant>,
  minShortSide = 1080,
): PixabayVideoVariant | null => {
  const list = Object.values(variants).filter(
    (variant) => variant.url && variant.width > 0 && variant.height > 0,
  );
  if (list.length === 0) return null;
  const area = (v: PixabayVideoVariant) => v.width * v.height;
  const qualifying = list
    .filter((v) => Math.min(v.width, v.height) >= minShortSide)
    .sort((a, b) => area(a) - area(b));
  if (qualifying.length > 0) return qualifying[0]!;
  return list.sort((a, b) => area(b) - area(a))[0]!;
};

export interface PixabayOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchImpl;
}

export const createPixabayStock = ({
  apiKey,
  baseUrl = "https://pixabay.com",
  fetchImpl,
}: PixabayOptions): StockProvider => {
  const search = async (request: StockSearchRequest): Promise<StockCandidate[]> => {
    if (request.kind === "image") {
      const params = new URLSearchParams({
        key: apiKey,
        q: request.query,
        image_type: "photo",
        orientation: pixabayOrientation(request.orientation),
        per_page: String(request.perPage),
        safesearch: "true",
      });
      const json = await fetchJson<{ hits: PixabayImageHit[] }>(
        `${baseUrl}/api/?${params}`,
        {},
        "Pixabay foto",
        { fetchImpl },
      );
      return json.hits.map((hit) => ({
        providerId: "pixabay",
        assetId: `pixabay:image:${hit.id}`,
        kind: "image" as const,
        downloadUrl: hit.largeImageURL,
        fileExt: "jpg",
        width: hit.imageWidth,
        height: hit.imageHeight,
        author: hit.user,
        sourceUrl: hit.pageURL,
        license: PIXABAY_LICENSE,
      }));
    }

    const params = new URLSearchParams({
      key: apiKey,
      q: request.query,
      per_page: String(request.perPage),
      safesearch: "true",
    });
    const json = await fetchJson<{ hits: PixabayVideoHit[] }>(
      `${baseUrl}/api/videos/?${params}`,
      {},
      "Pixabay video",
      { fetchImpl },
    );
    const candidates: StockCandidate[] = [];
    for (const hit of json.hits) {
      const variant = pickPixabayVideoVariant(hit.videos);
      if (!variant) continue;
      candidates.push({
        providerId: "pixabay",
        assetId: `pixabay:video:${hit.id}`,
        kind: "video",
        downloadUrl: variant.url,
        fileExt: "mp4",
        width: variant.width,
        height: variant.height,
        durationSec: hit.duration,
        author: hit.user,
        sourceUrl: hit.pageURL,
        license: PIXABAY_LICENSE,
      });
    }
    return candidates;
  };

  return {
    id: "pixabay",
    label: "Pixabay",
    search,
    download: (candidate) =>
      fetchBytes(candidate.downloadUrl, {}, "Unduhan Pixabay", { fetchImpl }),
  };
};
