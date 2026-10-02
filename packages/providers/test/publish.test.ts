import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPublishTargets, createYoutubePublisher } from "../src/index";

/**
 * Unggahan resumable YouTube (ADR-0030) diuji terhadap protokolnya, dengan
 * fetch palsu: sesi → Location, potongan dengan Content-Range, 308 + Range
 * di tengah, JSON video di akhir. Tidak ada jaringan; galat 401 dijelaskan.
 */
let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});
const videoFile = (bytes: number): string => {
  dir = mkdtempSync(join(tmpdir(), "dalang-yt-"));
  const file = join(dir, "final.mp4");
  writeFileSync(file, Buffer.alloc(bytes, 7));
  return file;
};
const CHUNK = 256 * 1024;

describe("createYoutubePublisher", () => {
  it("memulai sesi, mengunggah per potongan dengan Content-Range, melanjutkan dari Range 308, dan mengembalikan tautan", async () => {
    const file = videoFile(CHUNK * 2 + 1000);
    const calls: Array<{
      url: string;
      method: string;
      headers: Record<string, string>;
      bodyBytes: number;
    }> = [];
    let received = 0;
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const body = init?.body as Uint8Array | string | undefined;
      const bodyBytes = typeof body === "string" ? body.length : (body?.byteLength ?? 0);
      calls.push({ url: String(url), method: init?.method ?? "GET", headers, bodyBytes });
      if (init?.method === "POST") {
        expect(JSON.parse(body as string)).toMatchObject({
          snippet: { title: "Judul", tags: ["dalang"], defaultLanguage: "id" },
          status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false },
        });
        expect(headers["X-Upload-Content-Length"]).toBe(String(CHUNK * 2 + 1000));
        return new Response(null, {
          status: 200,
          headers: { location: "https://upload.test/sesi-1" },
        });
      }
      received += bodyBytes;
      if (received < CHUNK * 2 + 1000) {
        return new Response(null, {
          status: 308,
          headers: { range: `bytes=0-${received - 1}` },
        });
      }
      return new Response(JSON.stringify({ id: "abc123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const target = createYoutubePublisher({
      accessToken: "tok",
      fetchImpl,
      chunkBytes: CHUNK,
    });
    const seen: number[] = [];
    const result = await target.publish({
      filePath: file,
      title: "Judul",
      description: "Desk",
      tags: ["dalang"],
      privacy: "unlisted",
      language: "id",
      onProgress: (f) => seen.push(f),
    });
    expect(result).toEqual({
      providerId: "youtube",
      videoId: "abc123",
      url: "https://youtu.be/abc123",
    });
    expect(calls[0]?.url).toContain("uploadType=resumable");
    expect(calls[0]?.headers.Authorization).toBe("Bearer tok");
    const puts = calls.filter((call) => call.method === "PUT");
    expect(puts.map((call) => call.headers["Content-Range"])).toEqual([
      `bytes 0-${CHUNK - 1}/${CHUNK * 2 + 1000}`,
      `bytes ${CHUNK}-${CHUNK * 2 - 1}/${CHUNK * 2 + 1000}`,
      `bytes ${CHUNK * 2}-${CHUNK * 2 + 999}/${CHUNK * 2 + 1000}`,
    ]);
    expect(puts.every((call) => call.url === "https://upload.test/sesi-1")).toBe(true);
    expect(seen.at(-1)).toBe(1);
    expect(seen.every((f, i) => i === 0 || f >= (seen[i - 1] ?? 0))).toBe(true);
  });

  it("menjelaskan 401 sebagai token yang ditolak, dan sesi tanpa Location sebagai galat", async () => {
    const file = videoFile(1024);
    const rejected = createYoutubePublisher({
      accessToken: "basi",
      chunkBytes: CHUNK,
      fetchImpl: (async () =>
        new Response("invalid_token", { status: 401 })) as typeof fetch,
    });
    await expect(
      rejected.publish({
        filePath: file,
        title: "J",
        description: "",
        tags: [],
        privacy: "private",
      }),
    ).rejects.toThrow(/401/);
    const noLocation = createYoutubePublisher({
      accessToken: "tok",
      chunkBytes: CHUNK,
      fetchImpl: (async () => new Response(null, { status: 200 })) as typeof fetch,
    });
    await expect(
      noLocation.publish({
        filePath: file,
        title: "J",
        description: "",
        tags: [],
        privacy: "private",
      }),
    ).rejects.toThrow(/Location/);
    expect(() =>
      createYoutubePublisher({ accessToken: "tok", chunkBytes: 1000 }),
    ).toThrow(/256 KiB/);
  });

  it("subtitle ikut naik SESUDAH videonya jadi, lewat captions.insert", async () => {
    // `captions.insert` menuntut videoId, yang baru ada setelah unggahan
    // videonya selesai — jadi urutannya bukan pilihan.
    const file = videoFile(1000);
    const srt = join(dir, "video.id.srt");
    writeFileSync(srt, "1\n00:00:00,000 --> 00:00:02,000\nHalo dunia\n");
    const urls: string[] = [];
    let captionBody = "";
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const target = String(url);
      urls.push(target);
      if (target.includes("/captions")) {
        captionBody = String(init?.body ?? "");
        return new Response("{}", { status: 200 });
      }
      if (init?.method === "POST") {
        return new Response("", { status: 200, headers: { location: "https://up/1" } });
      }
      return new Response(JSON.stringify({ id: "vid-9" }), { status: 200 });
    }) as typeof fetch;

    const target = createYoutubePublisher({ accessToken: "t", fetchImpl });
    const result = await target.publish({
      filePath: file,
      title: "Judul",
      description: "",
      tags: [],
      privacy: "private",
      subtitle: { path: srt, language: "id", label: "Bahasa Indonesia" },
    });

    expect(result.videoId).toBe("vid-9");
    expect(result.subtitleUploaded).toBe(true);
    // Subtitle DISUSULKAN, bukan didahulukan.
    expect(urls[urls.length - 1]).toContain("/captions");
    // Multipart-nya membawa videoId di snippet dan isi berkasnya utuh.
    expect(captionBody).toContain('"videoId":"vid-9"');
    expect(captionBody).toContain('"language":"id"');
    expect(captionBody).toContain("Halo dunia");
  });

  it("subtitle yang gagal TIDAK menggagalkan unggahan videonya", async () => {
    // Videonya sudah tayang saat langkah ini jalan. Melempar galat akan
    // membuat orang mengunggah ulang video yang sama.
    const file = videoFile(1000);
    const srt = join(dir, "video.id.srt");
    writeFileSync(srt, "1\n00:00:00,000 --> 00:00:02,000\nHalo\n");
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const target = String(url);
      if (target.includes("/captions")) return new Response("nope", { status: 403 });
      if (init?.method === "POST") {
        return new Response("", { status: 200, headers: { location: "https://up/1" } });
      }
      return new Response(JSON.stringify({ id: "vid-9" }), { status: 200 });
    }) as typeof fetch;

    const result = await createYoutubePublisher({
      accessToken: "t",
      fetchImpl,
    }).publish({
      filePath: file,
      title: "Judul",
      description: "",
      tags: [],
      privacy: "private",
      subtitle: { path: srt, language: "id" },
    });

    expect(result.url).toBe("https://youtu.be/vid-9");
    expect(result.subtitleUploaded).toBe(false);
    expect(result.subtitleError).toContain("403");
  });

  it("berkas subtitle yang hilang dilaporkan, bukan diam-diam dilewati", async () => {
    const file = videoFile(1000);
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes("/captions")) return new Response("{}", { status: 200 });
      if (init?.method === "POST") {
        return new Response("", { status: 200, headers: { location: "https://up/1" } });
      }
      return new Response(JSON.stringify({ id: "vid-9" }), { status: 200 });
    }) as typeof fetch;

    const result = await createYoutubePublisher({
      accessToken: "t",
      fetchImpl,
    }).publish({
      filePath: file,
      title: "Judul",
      description: "",
      tags: [],
      privacy: "private",
      subtitle: { path: join(dir, "tidak-ada.srt"), language: "id" },
    });
    expect(result.subtitleUploaded).toBe(false);
    expect(result.subtitleError).toContain("tidak terbaca");
  });

  it("registry: tanpa token tidak ada tujuan; dengan token ada YouTube", () => {
    expect(buildPublishTargets({ env: {} })).toEqual([]);
    expect(
      buildPublishTargets({ env: { YOUTUBE_ACCESS_TOKEN: "tok" } }).map((t) => t.id),
    ).toEqual(["youtube"]);
  });
});
