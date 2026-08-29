import { describe, expect, it } from "vitest";
import {
  createPexelsStock,
  createPixabayStock,
  pickPexelsVideoFile,
  pickPixabayVideoVariant,
  pixabayOrientation,
} from "../src/index";

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("pickPexelsVideoFile", () => {
  const file = (width: number, height: number, type = "video/mp4") => ({
    width,
    height,
    file_type: type,
    link: `https://cdn.test/${width}x${height}.mp4`,
  });

  it("picks the smallest rendition that still covers 1080 on the short side", () => {
    const picked = pickPexelsVideoFile([
      file(3840, 2160),
      file(1920, 1080),
      file(1280, 720),
    ]);
    expect(picked?.width).toBe(1920);
  });

  it("falls back to the largest when nothing reaches 1080", () => {
    const picked = pickPexelsVideoFile([file(960, 540), file(1280, 720)]);
    expect(picked?.width).toBe(1280);
  });

  it("ignores non-mp4 renditions and handles empty lists", () => {
    expect(pickPexelsVideoFile([file(1920, 1080, "video/hls")])).toBeNull();
    expect(pickPexelsVideoFile([])).toBeNull();
  });
});

describe("Pexels provider", () => {
  it("searches photos with orientation and maps license/author", async () => {
    let captured = "";
    const provider = createPexelsStock({
      apiKey: "kunci",
      fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
        captured = String(url);
        expect((init!.headers as Record<string, string>).Authorization).toBe("kunci");
        return jsonResponse({
          photos: [
            {
              id: 11,
              width: 1080,
              height: 1920,
              url: "https://pexels.com/photo/11",
              photographer: "Budi",
              src: { original: "o.jpg", large2x: "l2x.jpg" },
            },
          ],
        });
      }) as typeof fetch,
    });

    const candidates = await provider.search({
      query: "candi",
      kind: "image",
      orientation: "portrait",
      perPage: 8,
    });
    expect(captured).toContain("/v1/search?");
    expect(captured).toContain("orientation=portrait");
    expect(candidates[0]).toMatchObject({
      assetId: "pexels:image:11",
      license: "Pexels License",
      author: "Budi",
      downloadUrl: "l2x.jpg",
      fileExt: "jpg",
    });
  });

  it("searches videos and applies the deterministic file pick", async () => {
    const provider = createPexelsStock({
      apiKey: "k",
      fetchImpl: (async (url: RequestInfo | URL) => {
        expect(String(url)).toContain("/videos/search?");
        return jsonResponse({
          videos: [
            {
              id: 7,
              width: 4096,
              height: 2160,
              duration: 12,
              url: "https://pexels.com/video/7",
              user: { name: "Sari" },
              video_files: [
                { width: 4096, height: 2160, file_type: "video/mp4", link: "4k" },
                { width: 1920, height: 1080, file_type: "video/mp4", link: "hd" },
              ],
            },
          ],
        });
      }) as typeof fetch,
    });
    const candidates = await provider.search({
      query: "x",
      kind: "video",
      orientation: "landscape",
      perPage: 8,
    });
    expect(candidates[0]).toMatchObject({
      assetId: "pexels:video:7",
      downloadUrl: "hd",
      durationSec: 12,
      fileExt: "mp4",
    });
  });
});

describe("Pixabay provider", () => {
  it("maps orientation and image results", async () => {
    expect(pixabayOrientation("portrait")).toBe("vertical");
    expect(pixabayOrientation("landscape")).toBe("horizontal");
    expect(pixabayOrientation("square")).toBe("all");

    let captured = "";
    const provider = createPixabayStock({
      apiKey: "kunci",
      fetchImpl: (async (url: RequestInfo | URL) => {
        captured = String(url);
        return jsonResponse({
          hits: [
            {
              id: 5,
              pageURL: "https://pixabay.com/5",
              imageWidth: 1200,
              imageHeight: 1800,
              largeImageURL: "large.jpg",
              user: "Wati",
            },
          ],
        });
      }) as typeof fetch,
    });
    const candidates = await provider.search({
      query: "borobudur",
      kind: "image",
      orientation: "portrait",
      perPage: 5,
    });
    expect(captured).toContain("key=kunci");
    expect(captured).toContain("orientation=vertical");
    expect(candidates[0]).toMatchObject({
      assetId: "pixabay:image:5",
      license: "Pixabay Content License",
      author: "Wati",
    });
  });

  it("picks the best video variant deterministically", () => {
    const variant = pickPixabayVideoVariant({
      large: { url: "l", width: 1920, height: 1080 },
      medium: { url: "m", width: 1280, height: 720 },
      tiny: { url: "t", width: 640, height: 360 },
    });
    expect(variant?.url).toBe("l");
    expect(
      pickPixabayVideoVariant({ tiny: { url: "t", width: 640, height: 360 } })?.url,
    ).toBe("t");
    expect(pickPixabayVideoVariant({})).toBeNull();
  });
});
