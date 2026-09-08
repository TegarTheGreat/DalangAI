import type { ScenePlan } from "@dalang/core";
import { FONT_STACK_BODY } from "../../fonts";
import type { DocTheme } from "../documentary-01/theme";

/**
 * klip-01 — bahasa visual "layar penuh, kalimat berat".
 *
 * Preset ini dibuat untuk satu keadaan menonton yang nyata dan berbeda dari
 * dua preset sebelumnya: **layar vertikal, jempol siap menggeser, suara
 * mati.** Tiga kenyataan itu yang menentukan tiap keputusan di bawah.
 *
 * Bedanya dengan documentary-01 bukan sekadar warna:
 *
 * - **Tidak ada grain dan tidak ada vignette.** Keduanya adalah efek bioskop
 *   yang MEREDUPKAN gambar. Di layar ponsel yang dilihat sambil jalan, gambar
 *   redup adalah gambar yang dilewati. Keterbacaan teks di sini dibeli dengan
 *   BOBOT huruf dan stroke, bukan dengan menggelapkan gambarnya.
 * - **Display-nya Anton, bukan serif editorial.** Fraunces menahan mata;
 *   Anton menghentak. Untuk potongan 20 detik yang harus menang di detik
 *   pertama, menghentak yang benar.
 * - **Aksen jenuh, bukan hangat.** Warna aksen di sini berperan sebagai
 *   penanda, bukan penghias: kata yang sedang dibacakan harus terlihat dari
 *   sudut mata.
 *
 * Struktur tipenya sengaja SUPERSET dari `DocTheme`, supaya `Backdrop` —
 * mesin seni prosedural dan pemutar media yang sudah diuji — dipakai apa
 * adanya tanpa disalin. Preset ini memiliki cara MENGGAMBAR-nya sendiri, dan
 * meminjam mesin yang sudah ada; itu seam yang sama yang dipakai tutorial-01.
 */

export interface KlipTheme extends DocTheme {
  /**
   * Pelat di belakang caption. Bukan penggelap layar penuh: hanya sepetak
   * bidang di belakang kalimatnya, supaya gambar di sekitarnya tetap terang.
   */
  plate: string;
  /** Garis retensi di tepi atas — konvensi konten pendek. */
  rail: string;
  railTrack: string;
  /** Warna teks di atas aksen (kontras terbalik untuk chip dan hook). */
  onAccent: string;
}

export const themeFromPlan = (plan: ScenePlan): KlipTheme => {
  const tokens = plan.meta.tokens ?? {};
  const accent = tokens.accent ?? "#FF3D57";
  return {
    bg: tokens.primary ?? "#07080C",
    ink: "#FFFFFF",
    // Lebih pekat daripada documentary-01: di klip, teks sekunder tetap harus
    // terbaca sekilas, bukan berbisik.
    inkSoft: "rgba(255, 255, 255, 0.80)",
    accent,
    plate: "rgba(7, 8, 12, 0.55)",
    rail: accent,
    railTrack: "rgba(255, 255, 255, 0.18)",
    onAccent: "#07080C",
    fontDisplay: tokens.fontDisplay
      ? `${tokens.fontDisplay}, Anton, Impact, sans-serif`
      : "Anton, Impact, sans-serif",
    fontBody: tokens.fontBody
      ? `${tokens.fontBody}, ${FONT_STACK_BODY}`
      : `Plus Jakarta Sans, ${FONT_STACK_BODY}`,
    duotones: [
      ["#1A0B18", "#3D1020"],
      ["#0A1424", "#123A46"],
      ["#180C24", "#3A1145"],
      ["#0C1A12", "#26401A"],
    ],
  };
};
