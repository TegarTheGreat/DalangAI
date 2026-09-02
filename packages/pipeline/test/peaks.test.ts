import { describe, expect, it } from "vitest";
import { peaksFromPcm } from "../src/peaks";

describe("peaksFromPcm (ADR-0028)", () => {
  it("mengambil PUNCAK per keranjang, bukan rata-rata, dinormalkan 0..1", () => {
    // 10 sampel, 2 keranjang: keranjang pertama memuat satu ketukan pendek.
    const pcm = new Int16Array([0, 0, 32767, 0, 0, 100, 100, 100, 100, 100]);
    expect(peaksFromPcm(pcm, 2)).toEqual([1, 0.003]);
  });

  it("jumlah batang selalu sama dengan yang diminta, PCM kosong = nol semua", () => {
    expect(peaksFromPcm(new Int16Array(0), 4)).toEqual([0, 0, 0, 0]);
    expect(peaksFromPcm(new Int16Array([5, -9]), 5)).toHaveLength(5);
    expect(peaksFromPcm(new Int16Array(1000).fill(-16384), 3)).toEqual([0.5, 0.5, 0.5]);
  });
});
