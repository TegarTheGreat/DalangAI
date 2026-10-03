import { type TextOverlay, TYPEWRITER_FRAMES_PER_CHAR } from "@dalang/core";

/**
 * Jadwal animasi teks berjenjang — bagian MURNI (tanpa Remotion), supaya bunyi
 * ketik (ADR-0043) dan animasinya membaca angka dari SATU tempat.
 *
 * Bunyi ketik dijatuhkan tepat di bingkai sebuah huruf tampil. Kalau jadwalnya
 * ditulis dua kali — sekali di animasi, sekali di penempatan bunyi — keduanya
 * akan menyimpang pada perubahan pertama, dan simpangan 3 bingkai antara huruf
 * dan bunyinya sudah terdengar sebagai keyboard yang tertinggal.
 */

/** Jeda antar potongan (frame) untuk animasi berjenjang. */
export const STAGGER_FRAMES = 3;

/**
 * Pecah konten sesuai jenis animasi: `typewriter` per karakter, `pop`/`rise`
 * per kata, `fade` tidak dipecah (satu blok).
 */
export const splitForAnim = (content: string, anim: TextOverlay["anim"]): string[] => {
  if (anim === "fade") return [content];
  if (anim === "typewriter") return Array.from(content);
  return content.split(/(\s+)/).filter((piece) => piece !== "");
};

/** Potongan yang hanya spasi dirender polos (di luar kotak inline-block). */
export const isSpacer = (piece: string): boolean => /^\s+$/.test(piece);

/**
 * Bingkai (relatif terhadap mulainya teks) tempat potongan ke-`index` pada
 * animasi `typewriter` muncul. Karakter muncul utuh saat gilirannya tiba.
 */
export const typewriterRevealFrame = (index: number): number =>
  index * TYPEWRITER_FRAMES_PER_CHAR;
