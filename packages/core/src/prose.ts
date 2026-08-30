import { countWords } from "./durations";
import { countSyllables } from "./syllables";

/**
 * Pengukur prosa deterministik (ADR-0017) — "detektor generic".
 *
 * KENAPA ADA: keluhan "hasilnya terasa generic" bukan soal selera yang tak
 * terukur. Riset atas teks buatan LLM menemukan pola PERMUKAAN yang bisa
 * dihitung: kepadatan klise, hedging ("cenderung", "pada dasarnya"),
 * paralelisme negatif ("bukan sekadar X melainkan Y"), dan yang paling
 * diagnostik — BURSTINESS rendah, yaitu panjang kalimat yang terlalu seragam.
 * Manusia menulis dengan irama tak rata; model menulis rata.
 *
 * Semua fungsi di sini murni dan bebas model: bisa dijalankan tiap draft
 * tanpa biaya token, dan bisa diuji. Ia tidak menilai apakah gagasannya bagus
 * — ia menangkap kebiasaan bahasa yang membuat naskah terdengar seperti mesin.
 *
 * Leksikon di bawah disusun untuk Bahasa Indonesia. Tidak ada korpus klise
 * AI berbahasa Indonesia yang tervalidasi (dicari, tidak ditemukan), jadi
 * daftar ini adalah kalibrasi awal yang sengaja dibuat kecil dan spesifik —
 * lebih baik melewatkan sebagian daripada menuduh naskah wajar.
 */

/** Frasa yang menandai naskah "aman" tanpa isi. */
export const KLISE_ID: readonly string[] = [
  "di era digital yang serba cepat",
  "di era serba digital",
  "di zaman yang serba modern",
  "seiring berjalannya waktu",
  "seiring perkembangan zaman",
  "mari kita bahas lebih dalam",
  "mari kita selami",
  "penting untuk dicatat bahwa",
  "perlu digarisbawahi bahwa",
  "tak dapat dipungkiri",
  "tidak dapat dipungkiri",
  "merevolusi cara kita",
  "membuka potensi",
  "solusi menyeluruh",
  "terobosan revolusioner",
  "sangat krusial",
  "game changer",
  "dunia yang terus berubah",
];

/** Kata pagar: menurunkan risiko salah dengan mengorbankan ketegasan. */
export const HEDGING_ID: readonly string[] = [
  "mungkin saja",
  "bisa jadi",
  "cenderung",
  "relatif",
  "secara umum",
  "pada dasarnya",
  "sebagian besar",
  "dalam banyak kasus",
  "boleh dikatakan",
  "kurang lebih",
  "bisa dibilang",
];

/**
 * Kata pengisi lisan. Di transkrip spontan ini wajar; di naskah yang DITULIS
 * untuk TTS ia cacat — mesin akan membacakannya sebagai kata sungguhan.
 */
export const PENGISI_ID: readonly string[] = [
  "anu",
  "gitu",
  "kayak",
  "sih",
  "eh",
  "hmm",
  "nah",
  "ya kan",
  "gimana ya",
];

/**
 * Konjungsi/penghubung yang menandai premisnya ada DI LUAR teks. Dipakai untuk
 * memeriksa apakah sebuah klip berdiri sendiri: klip yang dibuka "jadi…" atau
 * "tapi…" menuntut konteks yang tidak dimiliki penonton.
 */
export const PENGHUBUNG_AWAL_ID: readonly string[] = [
  "jadi",
  "tapi",
  "tetapi",
  "namun",
  "karena itu",
  "oleh karena itu",
  "makanya",
  "padahal",
  "sedangkan",
  "dan",
  "lalu",
  "kemudian",
  "nah",
  "selain itu",
  "artinya",
];

const normalise = (text: string): string => text.toLowerCase().replace(/\s+/g, " ");

/** Berapa frasa dari daftar yang muncul, dihitung per 100 kata. */
export const phraseDensity = (text: string, phrases: readonly string[]): number => {
  const words = countWords(text);
  if (words === 0) return 0;
  const haystack = normalise(text);
  let hits = 0;
  for (const phrase of phrases) {
    // Hitung SEMUA kemunculan, bukan sekadar ada/tidak.
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(phrase, from);
      if (at === -1) break;
      hits += 1;
      from = at + phrase.length;
    }
  }
  return (hits / words) * 100;
};

/** Frasa dari daftar yang benar-benar ditemukan (untuk pesan kritik). */
export const phrasesFound = (text: string, phrases: readonly string[]): string[] => {
  const haystack = normalise(text);
  return phrases.filter((phrase) => haystack.includes(phrase));
};

/** Pecah jadi kalimat berdasarkan tanda akhir; abaikan sisa kosong. */
export const splitSentences = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");

export interface ProseStats {
  words: number;
  syllables: number;
  sentences: number;
  /** Panjang kalimat terpanjang dalam kata. */
  longestSentenceWords: number;
  /**
   * Burstiness = simpangan baku panjang kalimat dibagi rerata. Tulisan manusia
   * bervariasi (nilai tinggi); tulisan model rata (nilai rendah). Bernilai 0
   * bila kalimatnya kurang dari dua.
   */
  burstiness: number;
  klisePer100: number;
  hedgingPer100: number;
  pengisiPer100: number;
}

export const proseStats = (text: string): ProseStats => {
  const sentences = splitSentences(text);
  const lengths = sentences.map(countWords).filter((length) => length > 0);
  const mean =
    lengths.length === 0 ? 0 : lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance =
    lengths.length < 2
      ? 0
      : lengths.reduce((sum, length) => sum + (length - mean) ** 2, 0) /
        (lengths.length - 1);
  return {
    words: countWords(text),
    syllables: countSyllables(text),
    sentences: sentences.length,
    longestSentenceWords: lengths.length === 0 ? 0 : Math.max(...lengths),
    burstiness: mean === 0 ? 0 : Math.sqrt(variance) / mean,
    klisePer100: phraseDensity(text, KLISE_ID),
    hedgingPer100: phraseDensity(text, HEDGING_ID),
    pengisiPer100: phraseDensity(text, PENGISI_ID),
  };
};

/** Apakah teks dibuka dengan penghubung yang menggantung ke luar konteks. */
export const opensWithConnector = (text: string): string | null => {
  const first = normalise(text).replace(/^[^a-z]+/, "");
  for (const connector of PENGHUBUNG_AWAL_ID) {
    if (first === connector || first.startsWith(`${connector} `)) return connector;
  }
  return null;
};

const STOPWORDS = new Set([
  "yang",
  "dan",
  "di",
  "ke",
  "dari",
  "untuk",
  "dengan",
  "pada",
  "ini",
  "itu",
  "adalah",
  "akan",
  "tidak",
  "juga",
  "atau",
  "dalam",
  "bisa",
  "ada",
  "sebagai",
  "oleh",
  "kita",
  "para",
  "satu",
  "dua",
  "lebih",
  "saat",
  "telah",
  "sudah",
  "masih",
  "agar",
  "karena",
]);

const contentWords = (text: string): Set<string> =>
  new Set(
    normalise(text)
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3 && !STOPWORDS.has(word)),
  );

/**
 * Kemiripan Jaccard atas kata isi — dipakai untuk menangkap dua scene
 * berurutan yang mengatakan hal yang sama dengan kalimat berbeda. Leksikal
 * saja (tanpa embedding) supaya tetap deterministik, gratis, dan bisa diuji.
 */
export const lexicalOverlap = (a: string, b: string): number => {
  const left = contentWords(a);
  const right = contentWords(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
};
