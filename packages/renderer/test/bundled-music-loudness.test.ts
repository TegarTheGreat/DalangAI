import { readFileSync } from "node:fs";
import { join } from "node:path";
import { measureWavLoudness } from "@dalang/pipeline";
import { BUNDLED_MUSIC } from "@dalang/templates/music";
import { templatesPublicDir } from "@dalang/templates/paths";
import { describe, expect, it } from "vitest";

/**
 * ADR-0026: angka kenyaringan bed pustaka harus COCOK dengan berkasnya.
 *
 * `BUNDLED_MUSIC` membawa `lufs` supaya bed pustaka tidak perlu melewati tahap
 * ukur sama sekali — ia sudah ada di repo dan tidak akan berubah. Tapi
 * konstanta yang menggambarkan isi sebuah berkas adalah konstanta yang bisa
 * BOHONG: berkasnya diganti, angkanya tertinggal, dan sejak itu setiap video
 * memakai bed yang dinormalisasi ke tempat yang salah tanpa satu pun test
 * berubah warna.
 *
 * Jadi angkanya diukur ULANG di sini dari berkas yang benar-benar ada. Ini
 * satu-satunya test yang menyeberangi paket (templates + pipeline), dan itu
 * memang alasannya ada: hanya renderer yang bisa melihat keduanya.
 */
describe("kenyaringan bed pustaka", () => {
  for (const music of BUNDLED_MUSIC) {
    it(`${music.id}: konstanta ${music.lufs} LUFS cocok dengan berkasnya`, () => {
      const bytes = readFileSync(join(templatesPublicDir, music.file));
      const measured = measureWavLoudness(new Uint8Array(bytes));

      // Toleransi 0,05 LU: konstantanya dibulatkan ke dua desimal, jadi ini
      // menuntut angka yang sama persis sampai pembulatannya — bukan sekadar
      // "kira-kira mirip".
      expect(measured.lufs).not.toBeNull();
      expect(measured.lufs as number).toBeCloseTo(music.lufs, 1);
      expect(Math.abs((measured.lufs as number) - music.lufs)).toBeLessThan(0.05);
    });

    it(`${music.id}: jumlah kanal ${music.channels} cocok dengan berkasnya`, () => {
      // Konstanta kanal sama rawannya dengan konstanta LUFS: mengganti bed
      // mono dengan bed stereo tanpa memperbarui angka ini membuat setiap
      // video memakai musik 3 dB terlalu pelan, tanpa satu test pun berubah.
      const bytes = readFileSync(join(templatesPublicDir, music.file));
      expect(measureWavLoudness(new Uint8Array(bytes)).channels).toBe(music.channels);
    });

    it(`${music.id}: tidak melewati skala penuh`, () => {
      const bytes = readFileSync(join(templatesPublicDir, music.file));
      // Bed yang sudah clipping di berkasnya akan terdengar pecah pada setiap
      // video yang memakainya, dan tidak ada pengaturan volume yang bisa
      // memperbaikinya setelah itu.
      expect(measureWavLoudness(new Uint8Array(bytes)).peak).toBeLessThanOrEqual(1);
    });
  }
});
