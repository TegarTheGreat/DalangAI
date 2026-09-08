/**
 * Laporan "apa yang tidak ikut menyeberang".
 *
 * Ekspor interchange selalu kehilangan sesuatu — itu sifat formatnya, bukan
 * cacat implementasi. Yang jadi cacat adalah kalau kehilangannya DIAM: orang
 * membuka hasilnya di Resolve, melihat klip polos tanpa caption dan tanpa Ken
 * Burns, lalu mengira Dalang yang rusak. Karena itu laporan ini bukan
 * tambahan opsional; ia bagian dari nilai kembalian pengekspor, dan tiap
 * permukaan (CLI, Studio) wajib menampilkannya.
 */
export interface InteropNote {
  /** Kode stabil untuk UI/tes; bukan untuk dibaca pengguna. */
  code: string;
  /** Kalimat untuk manusia, menyebut jumlah dan alasannya. */
  detail: string;
}

/** Beberapa baris teks siap cetak untuk CLI. */
export const formatInteropNotes = (notes: InteropNote[]): string[] =>
  notes.length === 0
    ? [
        "  Tidak ada yang hilang: plan ini tidak memakai fitur yang di luar jangkauan format.",
      ]
    : notes.map((note) => `  - ${note.detail}`);
