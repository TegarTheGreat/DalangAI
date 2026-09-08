import { describe, expect, it } from "vitest";
import {
  hookFontSize,
  POP_MS,
  POP_PEAK,
  retentionProgress,
  wordPop,
} from "../src/presets/klip-01/klip-model";

/**
 * Matematika murni klip-01.
 *
 * Yang diuji di sini bukan "angkanya enak dilihat" — itu penilaian mata, dan
 * buktinya adalah bingkai yang dirender. Yang diuji adalah sifat-sifat yang
 * kalau rusak menghasilkan cacat yang TIDAK akan pernah dilacak kembali ke
 * fungsinya: kalimat yang membesar sedikit demi sedikit sampai memenuhi
 * layar, judul yang menyusut jadi seukuran caption, dan garis retensi yang
 * meledak jadi NaN pada plan yang baru dibuat.
 */

describe("wordPop", () => {
  it("kata di luar jendela hentakan berdiri pada ukuran normal", () => {
    // Kedua sisi penting. Yang kiri: kata yang BELUM menyala tidak boleh
    // ikut membesar. Yang kanan justru yang paling mahal — hentakan yang
    // tidak pernah pulang membuat setiap kata yang sudah lewat tetap besar,
    // dan kalimatnya tumbuh terus sepanjang halaman caption.
    expect(wordPop(-1)).toBe(1);
    expect(wordPop(-1000)).toBe(1);
    expect(wordPop(POP_MS)).toBe(1);
    expect(wordPop(POP_MS * 10)).toBe(1);
  });

  it("mulai dan berakhir di 1, memuncak di tengah jendela", () => {
    expect(wordPop(0)).toBeCloseTo(1, 6);
    const peak = wordPop(POP_MS / 3);
    expect(peak).toBeCloseTo(POP_PEAK, 6);
    // Menjelang tutup jendela sudah hampir pulang — tidak ada lompatan tajam
    // kembali ke 1 yang akan terlihat sebagai kedutan.
    expect(wordPop(POP_MS - 1)).toBeLessThan(1.01);
  });

  it("tidak pernah mengecilkan kata", () => {
    // Skala di bawah 1 akan membuat kata yang sedang dibacakan justru MUNDUR
    // dari mata — kebalikan dari gunanya.
    for (let ms = -50; ms <= POP_MS + 50; ms += 3) {
      expect(wordPop(ms)).toBeGreaterThanOrEqual(1);
      expect(wordPop(ms)).toBeLessThanOrEqual(POP_PEAK);
    }
  });
});

describe("retentionProgress", () => {
  it("plan tanpa durasi tidak menghasilkan NaN", () => {
    // Plan yang baru dibuat di Studio bisa punya nol frame sesaat. Pembagian
    // dengan nol di sini akan mengalir ke `width: "NaN%"` — garis retensi
    // hilang tanpa satu pun pesan.
    expect(retentionProgress(0, 0)).toBe(0);
    expect(retentionProgress(30, 0)).toBe(0);
    expect(retentionProgress(30, -5)).toBe(0);
  });

  it("dijepit di 0..1", () => {
    expect(retentionProgress(-10, 100)).toBe(0);
    expect(retentionProgress(0, 100)).toBe(0);
    expect(retentionProgress(50, 100)).toBe(0.5);
    expect(retentionProgress(100, 100)).toBe(1);
    // Frame terakhir transisi bisa melewati totalFrames sepersekian bingkai.
    expect(retentionProgress(140, 100)).toBe(1);
  });
});

describe("hookFontSize", () => {
  it("judul pendek memakai basis yang dilebarkan", () => {
    // Anton lebih rapat daripada Fraunces, jadi ia sanggup lebih besar pada
    // lebar bingkai yang sama.
    expect(hookFontSize("Tiga Menit", 100)).toBe(116);
  });

  it("judul panjang menyusut, tapi berhenti di lantai yang masih kartu", () => {
    const pendek = hookFontSize("Tiga Menit", 100);
    const panjang = hookFontSize("Judul yang jauh lebih panjang daripada yang tadi", 100);
    expect(panjang).toBeLessThan(pendek);
    // Lantai 76: di bawah ini kartu hook berhenti terbaca sebagai kartu dan
    // mulai terlihat seperti caption yang kebetulan di tengah.
    expect(panjang).toBeGreaterThanOrEqual(76);
  });

  it("tidak pernah turun di bawah lantai betapa pun panjangnya judul", () => {
    const judul = "x".repeat(400);
    expect(hookFontSize(judul, 100)).toBe(76);
  });

  it("monoton: judul lebih panjang tidak pernah menghasilkan huruf lebih besar", () => {
    let sebelumnya = Number.POSITIVE_INFINITY;
    for (let panjang = 1; panjang <= 120; panjang++) {
      const ukuran = hookFontSize("x".repeat(panjang), 100);
      expect(ukuran).toBeLessThanOrEqual(sebelumnya);
      sebelumnya = ukuran;
    }
  });
});
