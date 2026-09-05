/**
 * Unggahan yang bisa dilanjutkan (ADR-0028 §11) — bagian yang MURNI, supaya
 * bisa diuji tanpa XMLHttpRequest: identitas unggahan, pemotongan, jeda
 * coba-ulang, dan angka kemajuan gabungan.
 *
 * Identitasnya dari nama + ukuran + mtime, BUKAN dari sesi: muat ulang tab
 * atau buka esok hari, byte yang sudah sampai tidak dikirim ulang. Isinya
 * tetap di-hash utuh di server saat selesai, jadi identitas yang salah tebak
 * paling-paling berujung mulai dari nol — tidak pernah berkas yang tercampur.
 */

export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
export const UPLOAD_MAX_RETRIES = 6;

const fnv1a = (text: string, seed: number): number => {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
};

/** Identitas unggahan (16 heksadesimal) dari nama, ukuran, dan mtime. */
export const uploadId = (name: string, size: number, lastModified: number): string => {
  const key = `${name}|${size}|${lastModified}`;
  const a = fnv1a(key, 0x811c9dc5).toString(16).padStart(8, "0");
  const b = fnv1a(key, 0x01000193).toString(16).padStart(8, "0");
  return `${a}${b}`;
};

/** Potongan berikutnya [start, end) dari offset; null bila sudah selesai. */
export const nextChunk = (
  offset: number,
  size: number,
  chunk = UPLOAD_CHUNK_BYTES,
): { start: number; end: number } | null =>
  offset >= size ? null : { start: offset, end: Math.min(size, offset + chunk) };

/** Jeda coba-ulang: 1, 2, 4, 8 detik dan seterusnya, paling lama 15 detik. */
export const retryDelayMs = (attempt: number): number =>
  Math.min(15_000, 1000 * 2 ** Math.max(0, attempt));

/** Kemajuan gabungan: byte yang sudah di server + yang sedang dikirim. */
export const uploadFraction = (offset: number, sent: number, size: number): number =>
  size <= 0 ? 1 : Math.min(1, (offset + sent) / size);
