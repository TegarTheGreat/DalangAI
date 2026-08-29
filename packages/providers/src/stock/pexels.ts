import type { StockCandidate, StockProvider, StockSearchRequest } from "@dalang/pipeline";
import { type FetchImpl, fetchBytes, fetchJson } from "../http";

/**
 * Pexels — primary stock provider (PRD §4.2). License recorded verbatim per
 * asset (PRD §10 / R-10): free for commercial use, attribution not required,
 * unaltered redistribution/sale prohibited.
 */

export const PEXELS_LICENSE = "Pexels License";

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  src: { original: string; large2x: string };
}

interface PexelsVideoFile {
  width: number | null;
  height: number | null;
  file_type: string;
  link: string;
}

interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  duration: number;
  url: string;
  user: { name: string };
  video_files: PexelsVideoFile[];
}

/**
 * Deterministic file pick: among mp4 renditions, the smallest one whose short
 * side is still ≥ minShortSide (enough for 1080p cover-crop); if none
 * qualifies, the largest available.
 */
export const pickPexelsVideoFile = (
  files: PexelsVideoFile[],
  minShortSide = 1080,
): PexelsVideoFile | null => {
  const mp4s = files.filter(
    (file) =>
      file.file_type === "video/mp4" && file.width !== null && file.height !== null,
  );
  if (mp4s.length === 0) return null;
  const area = (file: PexelsVideoFile) => (file.width ?? 0) * (file.height ?? 0);
  const qualifying = mp4s
    .filter((file) => Math.min(file.width ?? 0, file.height ?? 0) >= minShortSide)
    .sort((a, b) => area(a) - area(b));
  if (qualifying.length > 0) return qualifying[0]!;
  return mp4s.sort((a, b) => area(b) - area(a))[0]!;
};

export interface PexelsOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchImpl;
}

export const createPexelsStock = ({
  apiKey,
  baseUrl = "https://api.pexels.com",
  fetchImpl,
}: PexelsOptions): StockProvider => {
  const headers = { Authorization: apiKey };

  const search = async (request: StockSearchRequest): Promise<StockCandidate[]> => {
    const params = new URLSearchParams({
      query: request.query,
      per_page: String(request.perPage),
      orientation: request.orientation,
    });

    if (request.kind === "image") {
      const json = await fetchJson<{ photos: PexelsPhoto[] }>(
        `${baseUrl}/v1/search?${params}`,
        { headers },
        "Pexels foto",
        { fetchImpl },
      );
      return json.photos.map((photo) => ({
        providerId: "pexels",
        assetId: `pexels:image:${photo.id}`,
        kind: "image" as const,
        downloadUrl: photo.src.large2x,
        fileExt: "jpg",
        width: photo.width,
        height: photo.height,
        author: photo.photographer,
        sourceUrl: photo.url,
        license: PEXELS_LICENSE,
      }));
    }

    const json = await fetchJson<{ videos: PexelsVideo[] }>(
      `${baseUrl}/videos/search?${params}`,
      { headers },
      "Pexels video",
      { fetchImpl },
    );
    const candidates: StockCandidate[] = [];
    for (const video of json.videos) {
      const file = pickPexelsVideoFile(video.video_files);
      if (!file) continue;
      candidates.push({
        providerId: "pexels",
        assetId: `pexels:video:${video.id}`,
        kind: "video",
        downloadUrl: file.link,
        fileExt: "mp4",
        width: file.width ?? video.width,
        height: file.height ?? video.height,
        durationSec: video.duration,
        author: video.user.name,
        sourceUrl: video.url,
        license: PEXELS_LICENSE,
      });
    }
    return candidates;
  };

  return {
    id: "pexels",
    label: "Pexels",
    search,
    download: (candidate) =>
      fetchBytes(candidate.downloadUrl, {}, "Unduhan Pexels", { fetchImpl }),
  };
};
