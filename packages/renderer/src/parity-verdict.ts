/**
 * Putusan gerbang paritas aset — dipisah dari skripnya supaya bisa diuji tanpa
 * merender apa pun.
 *
 * Kenapa ada dua percobaan. Gerbang ini membandingkan dua render byte per byte,
 * dan pada 30 Agustus 2026 ia GAGAL sekali pada commit yang isinya hanya
 * dokumen — 14 run hijau sebelumnya, dan commit yang sama lulus saat diulang.
 * Render itu sendiri terbukti deterministik (frame yang sama dirender tiga kali
 * menghasilkan hash identik), jadi selisihnya lahir dari kondisi runner, bukan
 * dari kode.
 *
 * Menurunkan gerbangnya ke perbandingan bertoleransi akan melemahkan justru
 * yang ingin dijaga. Yang membedakan derau dari cacat sungguhan bukan besar
 * selisihnya, melainkan KETERULANGANNYA: pemanggil `staticFile()` yang terlewat
 * membuat aset hilang di SETIAP render, sedangkan derau rasterisasi tidak
 * bertahan pada percobaan kedua. Jadi gerbang ini merender ulang frame yang
 * bermasalah sekali lagi, dan hanya menyatakan gagal kalau selisihnya kembali.
 */

/** Sidik satu berkas hasil render: hash isi + ukuran, keduanya untuk diagnosis. */
export interface RenderFingerprint {
  hash: string;
  bytes: number;
}

/** Sepasang render frame yang sama lewat dua jalur aset. */
export interface ParityAttempt {
  /** Jalur lokal: aset disalin ke public dir, diambil dengan staticFile(). */
  local: RenderFingerprint;
  /** Jalur cloud: aset diambil dari URL dasar. */
  url: RenderFingerprint;
}

export type ParityVerdict =
  /** Kedua jalur identik — yang diharapkan. */
  | "identik"
  /** Percobaan pertama berbeda, ulangannya identik: derau runner, bukan cacat. */
  | "goyah"
  /** Selisihnya berulang — aset memang tidak sampai lewat salah satu jalur. */
  | "berbeda";

export const parityVerdict = (
  first: ParityAttempt,
  retry?: ParityAttempt | undefined,
): ParityVerdict => {
  if (first.local.hash === first.url.hash) return "identik";
  if (retry === undefined) return "berbeda";
  return retry.local.hash === retry.url.hash ? "goyah" : "berbeda";
};

/** Baris diagnosis yang dicetak gerbang, sama bentuknya untuk goyah dan gagal. */
export const describeAttempt = (label: string, attempt: ParityAttempt): string =>
  `  ${label}\n` +
  `    staticFile   : ${attempt.local.hash} (${attempt.local.bytes} byte)\n` +
  `    assetBaseUrl : ${attempt.url.hash} (${attempt.url.bytes} byte)`;
