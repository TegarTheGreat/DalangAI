/**
 * Matematika "pop" kata untuk klip-01 — murni, supaya bisa diuji tanpa
 * merender satu bingkai pun.
 *
 * Caption konten pendek dibaca dengan suara MATI. Yang menandai kata mana
 * yang sedang dibacakan karena itu tidak boleh hanya warna: warna hilang
 * begitu gambar di belakangnya kebetulan sewarna. Yang dipakai di sini
 * tambahan skala sesaat — gerak, dan gerak terlihat di latar apa pun.
 */

/** Lama hentakan sejak kata menyala, milidetik. */
export const POP_MS = 140;

/** Puncak pembesaran kata aktif. 1.14 = 14% lebih besar sesaat. */
export const POP_PEAK = 1.14;

/**
 * Skala kata pada satu titik waktu.
 *
 * `elapsedMs` diukur sejak kata MENYALA. Negatif (kata belum menyala) dan
 * lewat jendela pop keduanya mengembalikan 1 — kata di luar hentakan berdiri
 * pada ukuran normalnya, termasuk kata yang sudah lewat. Hentakan yang tidak
 * pernah pulang akan membuat seluruh kalimat membesar sedikit demi sedikit
 * sampai memenuhi layar.
 *
 * Bentuknya: naik cepat ke puncak di sepertiga awal, lalu turun kembali.
 * Naiknya lebih pendek daripada turunnya karena mata menangkap PERMULAAN
 * gerak, bukan akhirnya.
 */
export const wordPop = (elapsedMs: number): number => {
  if (elapsedMs < 0 || elapsedMs >= POP_MS) return 1;
  const t = elapsedMs / POP_MS;
  const rise = 1 / 3;
  const eased = t < rise ? t / rise : 1 - (t - rise) / (1 - rise);
  return 1 + (POP_PEAK - 1) * eased;
};

/**
 * Lebar pelat caption sebagai pecahan lebar bingkai.
 *
 * Sengaja lebih sempit daripada bidang teks yang tersedia: baris caption yang
 * memenuhi lebar layar ponsel memaksa mata bergerak menyamping, dan mata yang
 * bergerak menyamping kehilangan gambarnya. Angka ini menahan tiap baris di
 * kisaran yang terbaca sekali lirik.
 */
export const PLATE_WIDTH_FRACTION = 0.86;

/**
 * Kemajuan retensi 0..1 untuk garis di tepi atas.
 *
 * Dipisah dari komponennya supaya batas nol-frame (durasi kosong, yang bisa
 * terjadi pada plan yang baru dibuat) diputuskan di satu tempat, bukan
 * ditebak oleh pemanggil.
 */
export const retentionProgress = (frame: number, totalFrames: number): number => {
  if (totalFrames <= 0) return 0;
  return Math.min(Math.max(frame / totalFrames, 0), 1);
};

/**
 * Ukuran huruf kartu hook.
 *
 * Anton jauh lebih rapat daripada Fraunces, jadi ia sanggup berdiri lebih
 * besar pada lebar bingkai yang sama — dan di klip pendek, "lebih besar"
 * adalah keputusan retensi, bukan selera. Basisnya karena itu dinaikkan
 * dulu, baru disusutkan mengikuti panjang judul.
 *
 * Lantainya 76px, bukan 62px seperti documentary-01: judul klip yang menyusut
 * sampai seukuran caption kehilangan alasannya untuk ada sebagai kartu.
 */
export const hookFontSize = (title: string, base: number): number => {
  const wide = base * 1.16;
  const chars = title.length;
  if (chars <= 16) return Math.round(wide);
  return Math.max(Math.round(wide * Math.sqrt(16 / chars)), 76);
};
