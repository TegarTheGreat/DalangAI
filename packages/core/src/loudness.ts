/**
 * Normalisasi kenyaringan — sisi KEPUTUSAN (ADR-0026, roadmap §9.4).
 *
 * Pengukurannya (EBU R128 / ITU-R BS.1770-4) hidup di paket pipeline karena ia
 * butuh membaca berkas; yang ada di sini hanya aritmetika yang dipakai SAAT
 * MERENDER dan saat menampilkan angkanya di Studio. Keduanya harus memakai
 * rumus yang sama persis: preview yang lebih keras daripada hasil render
 * adalah cacat yang tidak bisa dilihat, hanya didengar — dan biasanya baru
 * setelah videonya diunggah.
 */

/**
 * Sasaran kenyaringan yang lazim, dalam LUFS.
 *
 * Angkanya bukan selera: platform besar menormalkan unggahan ke sekitar
 * nilai-nilai ini, jadi materi yang jauh lebih keras akan DITURUNKAN oleh
 * platformnya sendiri — kerja tambahan yang hasilnya cuma kehilangan dinamika.
 */
export const LOUDNESS_TARGETS = [
  { id: "siar", lufs: -23, label: "Siaran (EBU R128)" },
  { id: "web", lufs: -16, label: "Web & podcast" },
  { id: "sosial", lufs: -14, label: "Media sosial" },
] as const;

export type LoudnessTargetId = (typeof LOUDNESS_TARGETS)[number]["id"];

/**
 * Batas penguatan, dalam desibel.
 *
 * Rekaman yang sangat pelan (mis. -45 LUFS) menuntut +29 dB untuk mencapai
 * -16 — dan yang ikut naik 29 dB bukan cuma suaranya, tapi juga desis, dengung
 * jala-jala, dan derau ruangannya. Menolak menaikkan sejauh itu memberi hasil
 * yang lebih pelan daripada diminta, tapi masih bisa didengar; menurutinya
 * memberi hasil yang keras dan rusak.
 */
export const MAX_LOUDNESS_GAIN_DB = 12;
export const MIN_LOUDNESS_GAIN_DB = -24;

/**
 * Kenaikan kenyaringan saat sumber MONO diputar sebagai dual-mono di campuran
 * stereo: dua kanal identik menjumlahkan DAYA, bukan amplitudo.
 *
 * Angkanya bukan taksiran — 10*log10(2) = 3,01 dB — dan terukur persis begitu
 * pada render nyata: nada mono -26,68 LUFS keluar sebagai -23,67 LUFS.
 */
export const MONO_UPMIX_LU = 3.01;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** dB -> faktor linear. */
export const dbToGain = (db: number): number => 10 ** (db / 20);

/**
 * Faktor penguatan yang membawa satu sumber ke sasarannya.
 *
 * `lufs` undefined berarti BELUM DIUKUR, dan jawabannya 1 — bukan tebakan.
 * Berkas yang tidak pernah diukur lalu dinaikkan berdasarkan angka karangan
 * adalah cara paling cepat membuat satu klip meledak di tengah video.
 */
export const loudnessGain = (
  lufs: number | undefined,
  targetLufs: number | null,
  channels?: number | undefined,
): number => {
  if (lufs === undefined || targetLufs === null) return 1;
  if (!Number.isFinite(lufs)) return 1;
  const db = clamp(
    targetLufs - effectiveLufs(lufs, channels),
    MIN_LOUDNESS_GAIN_DB,
    MAX_LOUDNESS_GAIN_DB,
  );
  return dbToGain(db);
};

/**
 * Kenyaringan sumber SEPERTI YANG AKAN TERDENGAR di campuran stereo.
 *
 * Yang disimpan adalah angka ukur berkasnya yang apa adanya — itu yang bisa
 * dibandingkan dengan alat ukur lain dan yang ditampilkan di Studio. Koreksi
 * mono dihitung DI SINI, saat dipakai, bukan dibakukan ke dalam data: kalau
 * suatu saat keluarannya bukan stereo, angka yang tersimpan tetap benar dan
 * hanya rumus ini yang berubah.
 */
export const effectiveLufs = (lufs: number, channels?: number | undefined): number =>
  channels === 1 ? lufs + MONO_UPMIX_LU : lufs;

/** Apakah penguatan yang diminta terpotong batas — dipakai untuk memberi tahu. */
export const loudnessGainClamped = (
  lufs: number | undefined,
  targetLufs: number | null,
  channels?: number | undefined,
): boolean => {
  if (lufs === undefined || targetLufs === null || !Number.isFinite(lufs)) return false;
  const db = targetLufs - effectiveLufs(lufs, channels);
  return db > MAX_LOUDNESS_GAIN_DB || db < MIN_LOUDNESS_GAIN_DB;
};
