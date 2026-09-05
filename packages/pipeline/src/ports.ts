import type { TranscriptSegment, TranscriptWord, WordTimestamp } from "@dalang/core";

/**
 * Provider ports (hexagonal boundary, ADR-0001): the pipeline declares what it
 * needs; @dalang/providers implements; the CLI (later: agent runtime) wires
 * them together. Stages receive providers by injection — the pipeline package
 * never imports a concrete provider.
 */

// ---------------------------------------------------------------------------
// TTS
// ---------------------------------------------------------------------------

export interface TtsRequest {
  text: string;
  voiceId: string;
  /** 1 = natural speed. */
  speed: number;
  /** BCP-47-ish language hint, e.g. "id". */
  language: string;
}

export interface TtsResult {
  audio: Uint8Array;
  format: "mp3" | "wav";
  durationSec: number;
  /** Audio-relative (0-based) — the core contract. */
  wordTimestamps: WordTimestamp[];
  /** "native" from the provider, or "estimated" (deterministic fallback). */
  timestampsSource: "native" | "estimated";
  /** Rough cost estimate for observability; 0 for free/local providers. */
  costUsd: number;
}

export interface TtsProvider {
  id: string;
  label: string;
  /**
   * True when output is placeholder-grade (e.g. the offline silence
   * provider): the scene is always marked `fallbackQuality`, even when this
   * provider was requested as primary.
   */
  placeholderQuality: boolean;
  synthesize(request: TtsRequest): Promise<TtsResult>;
}

// ---------------------------------------------------------------------------
// ASR — transkripsi rekaman (ADR-0021)
// ---------------------------------------------------------------------------

export interface AsrRequest {
  /** Path ABSOLUT ke berkas media; provider lokal membacanya langsung. */
  file: string;
  /** Petunjuk bahasa BCP-47-ish, mis. "id". String kosong = deteksi otomatis. */
  language: string;
  /** Minta label pembicara kalau providernya mampu; yang tidak mampu abaikan. */
  diarize: boolean;
}

export interface AsrResult {
  words: TranscriptWord[];
  /** Giliran bicara berpunktuasi; boleh kosong kalau provider tidak memberi. */
  segments: TranscriptSegment[];
  /** Bahasa yang TERDETEKSI provider — belum tentu sama dengan yang diminta. */
  language: string;
  durationSec: number;
  /** Perkiraan kasar untuk ledger biaya; 0 untuk provider lokal. */
  costUsd: number;
}

/**
 * Port ASR. Bentuknya sengaja sesempit port TTS: satu kata kerja, satu hasil.
 *
 * Tidak ada `available()` di sini — ketersediaan diputuskan saat RANTAI
 * dibangun (binari ada? kunci API ada?), bukan saat transkripsi berjalan,
 * supaya pemakainya tahu ada-tidaknya jalur ASR sebelum pekerjaan panjang
 * dimulai, bukan sesudahnya.
 */
export interface AsrProvider {
  id: string;
  label: string;
  /** True untuk provider yang berjalan di mesin sendiri, tanpa jaringan. */
  offline: boolean;
  transcribe(request: AsrRequest): Promise<AsrResult>;
}

// ---------------------------------------------------------------------------
// Stock assets
// ---------------------------------------------------------------------------

export type StockKind = "video" | "image";
export type StockOrientation = "portrait" | "landscape" | "square";

export interface StockSearchRequest {
  query: string;
  kind: StockKind;
  orientation: StockOrientation;
  perPage: number;
}

export interface StockCandidate {
  providerId: string;
  /** Stable id, e.g. "pexels:video:857195". */
  assetId: string;
  kind: StockKind;
  downloadUrl: string;
  /** Lowercase file extension without dot, e.g. "mp4", "jpg". */
  fileExt: string;
  width: number;
  height: number;
  durationSec?: number;
  author?: string;
  sourceUrl?: string;
  /** Verbatim license label, stored for audit (PRD §10 / R-10). */
  license: string;
  thumbnailUrl?: string;
}

export interface StockProvider {
  id: string;
  label: string;
  search(request: StockSearchRequest): Promise<StockCandidate[]>;
  /** Fetch the asset bytes for a candidate this provider returned. */
  download(candidate: StockCandidate): Promise<Uint8Array>;
}

// ---------------------------------------------------------------------------
// Ikon & efek suara (ADR-0018)
// ---------------------------------------------------------------------------

/**
 * Satu ikon dari pustaka terbuka. Lisensi dibawa PER SET, bukan per ikon, dan
 * `commercialSafe` sudah dihitung provider supaya pemanggil tidak perlu tahu
 * seluk-beluk SPDX untuk mengambil keputusan yang aman.
 */
export interface IconCandidate {
  providerId: string;
  /** Identitas penuh, mis. "mdi:home". */
  iconId: string;
  setPrefix: string;
  setName: string;
  /** Nama lisensi apa adanya, mis. "Apache 2.0". */
  license: string;
  licenseSpdx?: string;
  licenseUrl?: string;
  author?: string;
  authorUrl?: string;
  /** Wajib menampilkan kredit (CC-BY, OFL, Apache-2.0). */
  needsAttribution: boolean;
  /** Aman untuk video komersial — set NonCommercial bernilai false. */
  commercialSafe: boolean;
}

export interface IconProvider {
  id: string;
  label: string;
  search(query: string, limit: number): Promise<IconCandidate[]>;
  /** Ambil SVG mentah untuk ikon; `color` mewarnai `currentColor`. */
  fetchSvg(
    iconId: string,
    options?: { color?: string; height?: number },
  ): Promise<string>;
}

/** Satu efek suara berlisensi terbuka. */
export interface SfxCandidate {
  providerId: string;
  assetId: string;
  title: string;
  /** URL berkas audio yang bisa diunduh langsung. */
  downloadUrl: string;
  fileExt: string;
  durationSec?: number;
  /** Lisensi apa adanya, mis. "cc0". */
  license: string;
  /** String kredit siap tempel bila providernya menyediakan. */
  attribution?: string;
  author?: string;
  sourceUrl?: string;
  commercialSafe: boolean;
}

export interface SfxProvider {
  id: string;
  label: string;
  search(query: string, limit: number): Promise<SfxCandidate[]>;
  download(candidate: SfxCandidate): Promise<Uint8Array>;
}

/**
 * Pengubah media apa pun jadi WAV PCM (ADR-0026).
 *
 * PORT, bukan panggilan langsung, dengan alasan yang sama seperti `RenderTarget`
 * di ADR-0019: satu-satunya perkakas yang bisa membongkar mp4/mp3 di tumpukan
 * ini hidup di paket renderer (Remotion), dan pipeline TIDAK boleh bergantung
 * pada renderer — arah dependensinya justru sebaliknya. Pemanggil (CLI,
 * Studio) yang menyuntikkan implementasinya.
 *
 * Kalau portnya tidak diberikan, tahap pengukuran melewati berkas yang bukan
 * WAV dan MENGATAKANNYA, bukan menebak angkanya.
 */
/**
 * Hasil satu upaya ekstraksi PCM.
 *
 * "Tidak bisa didekode" adalah NILAI, bukan lemparan. Kodek yang tidak
 * didukung bukan kerusakan — ia keadaan normal yang harus bisa dilaporkan apa
 * adanya ke pengguna ("klip ini tidak diukur, jadi tidak dinormalisasi"),
 * bukan galat yang membuat tahapnya terlihat rusak.
 */
export type AudioProbeResult = { ok: true } | { ok: false; reason: string };

export interface AudioProbe {
  id: string;
  /**
   * Menulis WAV PCM dari sebuah berkas media.
   *
   * Mengembalikan `{ ok: false, reason }` kalau sumbernya tidak bisa didekode
   * di lingkungan ini — mis. AAC pada Chromium tanpa kodek proprietary.
   */
  toWav(sourcePath: string, wavPath: string): Promise<AudioProbeResult>;
  /** Melepas sumber daya (browser) setelah semua pengukuran selesai. */
  close?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Transkoder media — proxy & rekaman panjang (ADR-0028, roadmap §9.5)
// ---------------------------------------------------------------------------

/** Fakta sebuah berkas media hasil ffprobe; null di bidang yang tidak ada. */
export interface MediaProbeInfo {
  durationSec: number;
  width: number;
  height: number;
  fps: number | null;
  /** Kodek video, huruf kecil, mis. "h264" | "hevc" | "prores"; null = tanpa video. */
  codec: string | null;
  hasAudio: boolean;
  audioCodec: string | null;
  channels: number | null;
  sampleRate: number | null;
  /** Laju bit keseluruhan, bit/detik; null bila kontainer tidak menyebutnya. */
  bitrate: number | null;
  sizeBytes: number;
}

export interface ProxyRequest {
  sourcePath: string;
  outputPath: string;
  width: number;
  height: number;
  /** Tidak diisi = laju bingkai sumber dipertahankan. */
  fps?: number;
  /**
   * Durasi sumber, detik — hanya untuk menghitung KEMAJUAN (ffmpeg melaporkan
   * waktu keluaran, bukan persen). Tidak diisi = kemajuan tidak dilaporkan.
   */
  durationSec?: number;
}

/** Kait opsional pembuatan proxy (ADR-0028 §10): kemajuan 0..1 dan pembatalan. */
export interface ProxyHooks {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export type ProxyResult =
  | { ok: true; width: number; height: number; durationSec: number; fps: number | null }
  | { ok: false; reason: string };

export type FrameResult = { ok: true } | { ok: false; reason: string };

/**
 * Port transkoder: satu-satunya pintu pipeline ke ffmpeg.
 *
 * PORT, dengan alasan yang sama seperti `AudioProbe` di atas: biner ffmpeg yang
 * ada di tumpukan ini milik paket renderer (dibundel Remotion), dan pipeline
 * tidak boleh bergantung pada renderer. Pemanggil (CLI, Studio) menyuntikkan
 * implementasinya; tes memberi yang palsu.
 *
 * Semua kegagalan yang WAJAR — kodek yang tidak dikenal, berkas tanpa jalur
 * video — dikembalikan sebagai nilai `{ ok: false, reason }`, bukan lemparan,
 * supaya tahap pipeline bisa melaporkannya apa adanya dan melanjutkan berkas
 * berikutnya.
 */
export interface MediaTranscoder {
  id: string;
  /** Baca fakta berkas; null bila bukan media yang bisa dibaca. */
  probe(sourcePath: string): Promise<MediaProbeInfo | null>;
  /**
   * Tulis proxy H.264/AAC ke `outputPath` dengan dimensi yang diminta.
   * Kait kemajuan/pembatalan boleh diabaikan implementasi yang tidak
   * mendukungnya; pembatalan yang dihormati mengembalikan `reason: "dibatalkan"`.
   */
  makeProxy(request: ProxyRequest, hooks?: ProxyHooks): Promise<ProxyResult>;
  /** Tulis satu bingkai (JPEG/PNG menurut ekstensi `outputPath`) pada detik ke-`atSec`. */
  extractFrame(
    sourcePath: string,
    atSec: number,
    outputPath: string,
    options?: { height?: number },
  ): Promise<FrameResult>;
  /** Dekode audio jadi WAV PCM 16-bit — semua kanal, laju cuplik sumber. */
  toWav(sourcePath: string, wavPath: string): Promise<AudioProbeResult>;
  /**
   * Dekode audio jadi PCM MONO 16-bit pada laju cuplik rendah, untuk
   * bentuk gelombang rekaman panjang. null = tidak ada jalur audio.
   */
  decodeMonoPcm(sourcePath: string, sampleRate: number): Promise<Int16Array | null>;
}

// ---------------------------------------------------------------------------
// Publikasi langsung (ADR-0030)
// ---------------------------------------------------------------------------

export interface PublishRequest {
  /** Path absolut berkas video hasil render. */
  filePath: string;
  title: string;
  description: string;
  tags: string[];
  privacy: "private" | "unlisted" | "public";
  language?: string;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface PublishResult {
  providerId: string;
  /** Id video di platform tujuan. */
  videoId: string;
  /** Tautan yang bisa dibuka orang. */
  url: string;
}

/**
 * Port tujuan publikasi. PORT dengan alasan yang sama seperti provider lain:
 * unggahan ke platform adalah efek eksternal yang tidak bisa diulang, jadi
 * tes harus bisa memberi tujuan palsu, dan platform baru masuk lewat pintu
 * yang sama tanpa menyentuh pipeline, CLI, atau Studio.
 */
export interface PublishTarget {
  id: string;
  label: string;
  publish(request: PublishRequest): Promise<PublishResult>;
}
