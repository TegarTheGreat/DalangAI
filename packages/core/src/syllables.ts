/**
 * Penghitung suku kata Bahasa Indonesia dan estimasi durasi berbasis suku kata
 * (ADR-0017).
 *
 * KENAPA: estimasi lama memakai jumlah KATA (2,4 kata/detik). Itu keliru untuk
 * Bahasa Indonesia karena panjang kata sangat bervariasi lewat afiksasi —
 * "dan" (1 suku kata) dan "mempertanggungjawabkan" (8 suku kata) dihitung
 * sama. Akibatnya scene bernarasi berat afiks selalu kekurangan waktu, dan
 * scene bernarasi pendek kelebihan.
 *
 * Data rujukan: penelitian kecepatan bicara dewasa normal (Surakarta, n=63)
 * mengukur 225-333 suku kata/menit dan 104-149 kata/menit — memberi rasio
 * sekitar 2,2 suku kata per kata untuk Bahasa Indonesia lisan. Rasio itu juga
 * sejalan dengan koreksi 0,6 pada grafik Fry untuk teks Indonesia.
 *
 * Estimasi ini HANYA dipakai sebelum TTS berjalan; begitu ada audio nyata,
 * durasi audio itulah yang menang. Jadi memperbaikinya adalah memperbaiki
 * kualitas perencanaan, bukan mengubah hasil akhir yang sudah bersuara.
 */

/** Rasio khas suku kata per kata dalam Bahasa Indonesia lisan. */
export const SYLLABLES_PER_WORD_ID = 2.2;

/**
 * Tempo narasi: 5,7 suku kata/detik (342 suku kata/menit). Sedikit di atas
 * langit-langit percakapan terukur (333/menit) karena naskah tertulis yang
 * dibacakan TTS tidak ragu, tidak berdehem, dan tidak mengulang.
 *
 * Catatan kalibrasi yang jujur: tetapan lama 2,4 kata/detik ternyata setara
 * ~373 suku kata/menit pada naskah demo (rasio nyatanya 2,59 suku kata/kata,
 * bukan 2,2 — narasi tertulis lebih berafiks dan berangka daripada
 * percakapan). Artinya estimasi lama memberi waktu TERLALU SEDIKIT, lebih
 * cepat dari manusia mana pun yang pernah diukur. Angka ini memperbaiki itu,
 * dan konsekuensinya durasi perkiraan proyek tanpa suara jadi sedikit lebih
 * panjang — itu koreksi, bukan regresi.
 */
export const SYLLABLES_PER_SECOND = 5.7;

const VOWELS = "aeiou";

/**
 * Diftong Indonesia (ai, au, oi) dihitung SATU suku kata, tetapi HANYA di
 * akhir kata: "pandai", "pulau", "amboi". Di tengah kata, gugus yang sama
 * justru menyeberangi batas suku kata dan berbunyi dua — "a-ir", "ba-ik",
 * "la-ut", "ke-a-ja-ib-an". Membedakan posisi ini adalah selisih antara
 * hitungan yang benar dan yang meleset satu suku kata pada kata umum.
 */
const DIPHTHONGS = new Set(["ai", "au", "oi"]);

/**
 * Angka dibaca panjang tetapi tidak beraksara: "2024" terucap "dua ribu dua
 * puluh empat" (8 suku kata). Rata-rata nama digit Indonesia sekitar dua suku
 * kata, dan pola "ribu/puluh" mempertahankan rasio itu, jadi tiap digit
 * dihitung 2. Tanpa ini, narasi berangka selalu diberi waktu terlalu sedikit.
 */
const SYLLABLES_PER_DIGIT = 2;

/**
 * Jumlah suku kata satu kata Indonesia. Aturan dasarnya sederhana: tiap
 * gugus vokal = satu suku kata, karena "e" Indonesia tidak pernah bisu
 * (berbeda dari Inggris) dan digraf konsonan (ng, ny, sy, kh) tidak
 * menambah suku kata — otomatis benar karena kita hanya menghitung vokal.
 */
export const countSyllablesInWord = (word: string): number => {
  const lower = word.toLowerCase();
  const digits = (lower.match(/\d/g) ?? []).length;
  const letters = lower.replace(/[^a-z]/g, "");
  if (letters === "") return digits * SYLLABLES_PER_DIGIT;

  let syllables = 0;
  let index = 0;
  while (index < letters.length) {
    const char = letters[index] as string;
    if (!VOWELS.includes(char)) {
      index += 1;
      continue;
    }
    const pair = letters.slice(index, index + 2);
    if (pair.length === 2 && DIPHTHONGS.has(pair) && index + 2 === letters.length) {
      syllables += 1;
      index += 2;
      continue;
    }
    syllables += 1;
    index += 1;
  }
  // Kata beraksara tanpa vokal (akronim seperti "PLN") tetap terucap.
  return Math.max(1, syllables) + digits * SYLLABLES_PER_DIGIT;
};

/** Jumlah suku kata seluruh teks. */
export const countSyllables = (text: string): number =>
  text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .reduce((sum, word) => sum + countSyllablesInWord(word), 0);
