import type { PlanExpectation } from "./score";

/**
 * Kasus eval agent (ADR-0022 §7.4).
 *
 * Dipilih supaya saling BERBEDA sumbunya, bukan sekadar banyak: tiap kasus
 * menguji satu hal yang bisa rusak sendiri-sendiri — menyimpulkan format dari
 * brief yang tidak menyebutnya, mematuhi rasio yang diminta eksplisit,
 * menahan diri pada durasi pendek, dan memahami topik yang butuh angka.
 *
 * Brief-nya sengaja ditulis seperti orang menulis, bukan seperti spesifikasi:
 * kalimat pendek, tidak lengkap, kadang dua permintaan dalam satu napas. Eval
 * yang briefnya rapi hanya mengukur kemampuan mengisi formulir.
 */

export interface EvalCase {
  id: string;
  /** Apa yang sedang diuji kasus ini — dicetak di papan skor saat gagal. */
  sumbu: string;
  brief: string;
  expectation: PlanExpectation;
}

export const EVAL_CASES: readonly EvalCase[] = [
  {
    id: "vertikal-eksplisit",
    sumbu: "mematuhi rasio & durasi yang diminta eksplisit",
    brief:
      "bikin video tiktok 30 detik tentang kenapa kopi robusta indonesia lebih pahit dari arabika",
    expectation: {
      aspectRatio: "9:16",
      language: "id",
      targetSec: 30,
      mustMention: ["robusta"],
    },
  },
  {
    id: "format-tersirat-tutorial",
    sumbu: "menyimpulkan format dari brief yang tidak menyebutnya",
    brief:
      "tolong buatkan panduan langkah demi langkah cara ekspor video di Dalang Studio, untuk pengguna baru",
    expectation: { format: "tutorial", language: "id" },
  },
  {
    id: "esai-panjang",
    sumbu: "menahan struktur pada durasi panjang tanpa jadi daftar",
    brief:
      "video esai 3 menit soal sejarah Borobudur — dari dibangun, terkubur abu, sampai dipugar UNESCO",
    expectation: {
      format: "edukasi",
      targetSec: 180,
      mustMention: ["Borobudur", "UNESCO"],
    },
  },
  {
    id: "berita-angka",
    sumbu: "membawa angka konkret ke naskah, bukan generalisasi",
    brief: "ringkasan berita 45 detik: harga emas antam naik, jelaskan penyebabnya",
    expectation: { format: "berita", targetSec: 45, mustMention: ["emas"] },
  },
  {
    id: "brief-minim",
    sumbu: "brief satu kalimat tanpa arahan apa pun",
    brief: "video tentang gunung bromo",
    expectation: { language: "id" },
  },
] as const;
