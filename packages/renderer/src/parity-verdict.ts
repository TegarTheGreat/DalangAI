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
 * Saringan pertama adalah KETERULANGAN: pemanggil `staticFile()` yang terlewat
 * membuat aset hilang di SETIAP render, sedangkan derau rasterisasi tidak
 * bertahan pada percobaan kedua. Jadi gerbang ini merender ulang frame yang
 * bermasalah sekali lagi, dan tidak menyatakan gagal kecuali selisihnya kembali.
 *
 * Saringan kedua, ditambahkan setelah ada ANGKANYA: BESAR selisihnya. Semula
 * modul ini menolak toleransi apa pun dengan alasan keterulangan sudah cukup;
 * pengukuran menunjukkan alasan itu tidak lengkap. Satu jalan CI mencatat dua
 * render dari plan yang PERSIS sama berbeda 248 piksel (0,191% bidang) dengan
 * selisih kanal terbesar 2/255 — berulang di dalam jalan itu, jadi lolos
 * saringan keterulangan, padahal 2/255 tidak bisa dilihat mata dan mustahil
 * menyembunyikan aset yang hilang (yang menggeser kanal puluhan sampai 255).
 *
 * Keduanya dipakai bersama, bukan menggantikan: gagal hanya kalau selisihnya
 * BERULANG dan CUKUP BESAR untuk terlihat. Ambangnya satu tempat di
 * `png-diff.ts` supaya kedua gerbang paritas memakai definisi yang sama.
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

/** Vonis akhir; "setara" hanya lahir setelah hitungan piksel ikut dibaca. */
export type ParityFinalVerdict = ParityVerdict | "setara";

/**
 * Vonis hash disaring sekali lagi oleh besar selisihnya.
 *
 * Hanya "berbeda" yang bisa berubah: "identik" dan "goyah" sudah lulus, dan
 * menurunkan keduanya lewat piksel tidak menjawab pertanyaan apa pun. Selisih
 * yang berulang TAPI di bawah ambang lihat jadi "setara" — lulus, dengan
 * angkanya tetap dicetak gerbang supaya toleransinya tidak pernah senyap.
 *
 * Kedua percobaan harus sama-sama di bawah ambang. Satu percobaan yang
 * selisihnya besar sudah cukup jadi bukti aset benar-benar tidak sampai;
 * "rata-ratanya kecil" bukan pembelaan untuk frame yang sekali waktu kosong.
 */
export const parityFinalVerdict = (
  hashVerdict: ParityVerdict,
  noise: { first: boolean; retry: boolean },
): ParityFinalVerdict => {
  if (hashVerdict !== "berbeda") return hashVerdict;
  return noise.first && noise.retry ? "setara" : "berbeda";
};

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
