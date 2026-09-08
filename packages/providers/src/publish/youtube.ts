import { closeSync, openSync, readSync, statSync } from "node:fs";
import type { PublishRequest, PublishResult, PublishTarget } from "@dalang/pipeline";
import { type FetchImpl, httpRequest } from "../http";

/**
 * YouTube Data API v3 — unggahan RESUMABLE (ADR-0030).
 *
 * Dua langkah protokol Google: (1) POST memulai sesi dan mengembalikan URL
 * unggahan di header Location; (2) PUT potongan demi potongan dengan
 * Content-Range — 308 berarti "lanjut" (header Range menyebut byte terakhir
 * yang diterima), 200/201 berarti selesai dengan JSON video. Potongan
 * kelipatan 256 KiB, sesuai syarat Google. Berkas dibaca per potongan, bukan
 * dimuat utuh: video final 1080p bisa ratusan MB.
 *
 * Otentikasi: token akses OAuth 2.0 dengan cakupan youtube.upload, diberikan
 * user (mis. dari OAuth Playground atau alur OAuth milik aplikasinya).
 * Modul ini TIDAK menjalankan alur OAuth dan tidak menyegarkan token — itu
 * batas yang dinyatakan ADR-0030, dan galat 401 dijelaskan apa adanya.
 */

export const YOUTUBE_UPLOAD_BASE = "https://www.googleapis.com/upload/youtube/v3";
/** 8 MiB — kelipatan 256 KiB, cukup besar supaya jumlah PUT tetap sedikit. */
export const YOUTUBE_CHUNK_BYTES = 8 * 1024 * 1024;

export interface YoutubePublisherOptions {
  accessToken: string;
  fetchImpl?: FetchImpl;
  uploadBaseUrl?: string;
  chunkBytes?: number;
}

const bodyOf = (request: PublishRequest) => ({
  snippet: {
    title: request.title,
    description: request.description,
    tags: request.tags,
    ...(request.language
      ? { defaultLanguage: request.language, defaultAudioLanguage: request.language }
      : {}),
  },
  status: { privacyStatus: request.privacy, selfDeclaredMadeForKids: false },
});

const explain = async (response: Response, label: string): Promise<Error> => {
  let body = "";
  try {
    body = (await response.text()).slice(0, 300);
  } catch {
    // tanpa badan — status saja
  }
  if (response.status === 401) {
    return new Error(
      `${label}: YouTube menolak token (401) — token kedaluwarsa atau bukan token OAuth dengan cakupan youtube.upload${body ? `: ${body}` : ""}`,
    );
  }
  if (response.status === 403) {
    return new Error(
      `${label}: YouTube menolak (403) — kuota API habis atau kanal belum diverifikasi${body ? `: ${body}` : ""}`,
    );
  }
  return new Error(`${label}: HTTP ${response.status}${body ? `: ${body}` : ""}`);
};

export const createYoutubePublisher = ({
  accessToken,
  fetchImpl,
  uploadBaseUrl = YOUTUBE_UPLOAD_BASE,
  chunkBytes = YOUTUBE_CHUNK_BYTES,
}: YoutubePublisherOptions): PublishTarget => {
  if (chunkBytes % (256 * 1024) !== 0 || chunkBytes <= 0) {
    throw new Error("chunkBytes harus kelipatan 256 KiB");
  }
  const auth = { Authorization: `Bearer ${accessToken}` };
  const http = { ...(fetchImpl ? { fetchImpl } : {}) };

  return {
    id: "youtube",
    label: "YouTube",
    publish: async (request): Promise<PublishResult> => {
      const size = statSync(request.filePath).size;
      if (size === 0) throw new Error("berkas video kosong");

      // (1) sesi
      const session = await httpRequest(
        `${uploadBaseUrl}/videos?uploadType=resumable&part=snippet,status`,
        {
          method: "POST",
          headers: {
            ...auth,
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Length": String(size),
            "X-Upload-Content-Type": "video/*",
          },
          body: JSON.stringify(bodyOf(request)),
        },
        { ...http, retries: 1 },
      );
      if (!session.ok) throw await explain(session, "YouTube memulai unggahan");
      const location = session.headers.get("location");
      if (!location)
        throw new Error("YouTube tidak memberi URL unggahan (header Location kosong)");

      // (2) potongan
      const fd = openSync(request.filePath, "r");
      try {
        let offset = 0;
        while (offset < size) {
          if (request.signal?.aborted) throw new Error("dibatalkan");
          const length = Math.min(chunkBytes, size - offset);
          const chunk = Buffer.alloc(length);
          readSync(fd, chunk, 0, length, offset);
          const response = await httpRequest(
            location,
            {
              method: "PUT",
              headers: {
                ...auth,
                "Content-Type": "video/*",
                "Content-Range": `bytes ${offset}-${offset + length - 1}/${size}`,
              },
              body: new Uint8Array(chunk),
            },
            { ...http, timeoutMs: 600_000, retries: 2 },
          );
          if (response.status === 308) {
            const range = response.headers.get("range");
            const last = range ? Number(range.split("-")[1]) : Number.NaN;
            offset = Number.isFinite(last) ? last + 1 : offset + length;
            request.onProgress?.(Math.min(0.999, offset / size));
            continue;
          }
          if (response.ok) {
            const video = (await response.json()) as { id?: string };
            if (!video.id) throw new Error("YouTube selesai tanpa id video");
            request.onProgress?.(1);
            return {
              providerId: "youtube",
              videoId: video.id,
              url: `https://youtu.be/${video.id}`,
            };
          }
          throw await explain(response, "YouTube mengunggah potongan");
        }
      } finally {
        closeSync(fd);
      }
      throw new Error("YouTube tidak pernah mengonfirmasi unggahan selesai");
    },
  };
};
