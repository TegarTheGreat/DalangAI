import { existsSync } from "node:fs";
import type { FetchImpl } from "./http";

/**
 * Menguji satu setelan ke layanan yang sebenarnya (ADR-0032).
 *
 * Alasannya sederhana: kunci yang salah ketik terlihat persis seperti kunci
 * yang benar. Tanpa pengujian, orang baru menemukan kesalahannya di tengah
 * `generate` yang sudah berjalan lima menit, dan pesan galatnya datang dari
 * provider, bukan dari kami.
 *
 * Semua penguji memakai permintaan yang PALING MURAH yang membuktikan kunci
 * diterima: mendaftar model, membaca profil, atau mencari satu hasil. Tidak
 * ada yang menghasilkan token, mensintesis suara, atau mengunggah apa pun.
 */

export type ProbeStatus = "ok" | "gagal" | "tak-diuji";

export interface ProbeResult {
  status: ProbeStatus;
  /** Satu kalimat untuk dibaca orang, bukan kode status mentah. */
  detail: string;
}

const TIMEOUT_MS = 12_000;

const ok = (detail: string): ProbeResult => ({ status: "ok", detail });
const gagal = (detail: string): ProbeResult => ({ status: "gagal", detail });

/**
 * Panggil satu URL dan terjemahkan hasilnya jadi kalimat.
 *
 * 429 dihitung BERHASIL: batas laju tercapai hanya bisa terjadi setelah
 * kuncinya diterima, dan menolaknya akan menyuruh orang mengganti kunci yang
 * sebenarnya sudah benar.
 */
const call = async (
  url: string,
  init: RequestInit,
  fetchImpl: FetchImpl,
  label: string,
): Promise<ProbeResult> => {
  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.ok) return ok(`${label} menerima kunci ini`);
    if (response.status === 429) {
      return ok(`${label} menerima kunci ini, batas laju sedang tercapai`);
    }
    if (response.status === 401 || response.status === 403) {
      return gagal(`${label} menolak kunci ini (${response.status})`);
    }
    return gagal(`${label} menjawab ${response.status}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return gagal(
      message.includes("timed out") || message.includes("aborted")
        ? `${label} tidak menjawab dalam ${TIMEOUT_MS / 1000} detik`
        : `Tidak bisa menghubungi ${label}: ${message}`,
    );
  }
};

const query = (base: string, params: Record<string, string>): string => {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
};

type Prober = (value: string, fetchImpl: FetchImpl) => Promise<ProbeResult>;

/**
 * Penguji per kunci. Yang tidak ada di sini tidak diuji, dan itu dikatakan
 * apa adanya alih-alih dilaporkan hijau.
 */
const PROBES: Record<string, Prober> = {
  ANTHROPIC_API_KEY: (value, fetchImpl) =>
    call(
      "https://api.anthropic.com/v1/models?limit=1",
      { headers: { "x-api-key": value, "anthropic-version": "2023-06-01" } },
      fetchImpl,
      "Anthropic",
    ),
  OPENAI_API_KEY: (value, fetchImpl) =>
    call(
      "https://api.openai.com/v1/models",
      { headers: { authorization: `Bearer ${value}` } },
      fetchImpl,
      "OpenAI",
    ),
  GOOGLE_GENERATIVE_AI_API_KEY: (value, fetchImpl) =>
    call(
      query("https://generativelanguage.googleapis.com/v1beta/models", { key: value }),
      {},
      fetchImpl,
      "Google AI",
    ),
  ELEVENLABS_API_KEY: (value, fetchImpl) =>
    call(
      "https://api.elevenlabs.io/v1/voices",
      { headers: { "xi-api-key": value } },
      fetchImpl,
      "ElevenLabs",
    ),
  PEXELS_API_KEY: (value, fetchImpl) =>
    call(
      query("https://api.pexels.com/v1/search", { query: "uji", per_page: "1" }),
      { headers: { authorization: value } },
      fetchImpl,
      "Pexels",
    ),
  PIXABAY_API_KEY: (value, fetchImpl) =>
    call(
      query("https://pixabay.com/api/", { key: value, q: "uji", per_page: "3" }),
      {},
      fetchImpl,
      "Pixabay",
    ),
  GIPHY_API_KEY: (value, fetchImpl) =>
    call(
      query("https://api.giphy.com/v1/gifs/search", {
        api_key: value,
        q: "uji",
        limit: "1",
      }),
      {},
      fetchImpl,
      "GIPHY",
    ),
  TENOR_API_KEY: (value, fetchImpl) =>
    call(
      query("https://tenor.googleapis.com/v2/search", {
        key: value,
        q: "uji",
        limit: "1",
      }),
      {},
      fetchImpl,
      "Tenor",
    ),
  DEEPGRAM_API_KEY: (value, fetchImpl) =>
    call(
      "https://api.deepgram.com/v1/projects",
      { headers: { authorization: `Token ${value}` } },
      fetchImpl,
      "Deepgram",
    ),
  YOUTUBE_ACCESS_TOKEN: async (value, fetchImpl) => {
    const result = await call(
      query("https://www.googleapis.com/youtube/v3/channels", {
        part: "id",
        mine: "true",
      }),
      { headers: { authorization: `Bearer ${value}` } },
      fetchImpl,
      "YouTube",
    );
    // Token akses YouTube berumur sekitar satu jam. Kegagalan di sini hampir
    // selalu berarti kedaluwarsa, bukan salah ketik, dan itu perlu dikatakan.
    return result.status === "gagal"
      ? gagal(
          `${result.detail}. Token akses YouTube biasanya kedaluwarsa dalam satu jam.`,
        )
      : result;
  },
  DALANG_OPENAI_COMPAT_BASE_URL: async (value, fetchImpl) => {
    const base = value.replace(/\/+$/, "");
    return call(`${base}/models`, {}, fetchImpl, "Gateway");
  },
};

/** Setelan yang berupa path: diuji dengan melihat berkasnya ada atau tidak. */
const PATH_SETTINGS = new Set([
  "WHISPER_CPP_BIN",
  "WHISPER_CPP_MODEL",
  "REMOTION_BROWSER_EXECUTABLE",
  "PUPPETEER_EXECUTABLE_PATH",
]);

export interface ProbeOptions {
  fetchImpl?: FetchImpl;
  /** Untuk tes: pemeriksa keberadaan berkas. */
  exists?: (path: string) => boolean;
}

/**
 * Uji satu setelan. Kunci tanpa penguji dilaporkan `tak-diuji`, bukan `ok`:
 * mengaku sudah memeriksa sesuatu yang tidak diperiksa lebih buruk daripada
 * mengaku tidak tahu.
 */
export const probeSetting = async (
  key: string,
  value: string,
  options: ProbeOptions = {},
): Promise<ProbeResult> => {
  const trimmed = value.trim();
  if (trimmed === "") return { status: "tak-diuji", detail: "belum diisi" };

  if (PATH_SETTINGS.has(key)) {
    const exists = options.exists ?? existsSync;
    return exists(trimmed)
      ? ok("berkasnya ada di mesin ini")
      : gagal(`tidak ada berkas di "${trimmed}"`);
  }

  const prober = PROBES[key];
  if (!prober) {
    return { status: "tak-diuji", detail: "tidak ada cara murah untuk mengujinya" };
  }
  return prober(trimmed, options.fetchImpl ?? fetch);
};

/** Kunci yang punya penguji jaringan atau berkas. Dipakai UI untuk tombol Uji. */
export const isProbeable = (key: string): boolean =>
  PATH_SETTINGS.has(key) || key in PROBES;
