/**
 * Bentuk gelombang rekaman panjang (ADR-0028) — MURNI, dari PCM mono.
 *
 * Satu jam audio pada 200 Hz adalah 720 ribu sampel; timeline hanya butuh
 * beberapa ratus batang. Tiap batang = puncak mutlak di keranjangnya,
 * dinormalkan 0..1 terhadap skala penuh 16-bit — bukan rata-rata, karena
 * rata-rata mengubur ketukan pendek yang justru dicari orang saat menjelajah.
 */
export const peaksFromPcm = (pcm: Int16Array, buckets: number): number[] => {
  const count = Math.max(1, Math.floor(buckets));
  if (pcm.length === 0) return new Array(count).fill(0);
  const out = new Array<number>(count).fill(0);
  const perBucket = pcm.length / count;
  for (let i = 0; i < pcm.length; i++) {
    const bucket = Math.min(count - 1, Math.floor(i / perBucket));
    const value = Math.abs(pcm[i] ?? 0);
    if (value > (out[bucket] ?? 0)) out[bucket] = value;
  }
  return out.map((value) => Math.round((value / 32767) * 1000) / 1000);
};

/** Laju cuplik yang dipakai untuk bentuk gelombang: cukup untuk 5 ms per sampel. */
export const PEAKS_SAMPLE_RATE = 200;
