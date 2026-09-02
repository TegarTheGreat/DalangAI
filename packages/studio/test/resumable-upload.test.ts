import { describe, expect, it } from "vitest";
import {
  nextChunk,
  retryDelayMs,
  UPLOAD_CHUNK_BYTES,
  uploadFraction,
  uploadId,
} from "../src/app/model/resumable-upload";

/** Bagian murni unggahan yang bisa dilanjutkan (ADR-0028 §11). */
describe("resumable-upload (murni)", () => {
  it("identitas unggahan deterministik, 16 heksadesimal, dan peka terhadap nama/ukuran/mtime", () => {
    const id = uploadId("Wawancara Pagi.MOV", 3_000_000_000, 1_725_000_000_000);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(uploadId("Wawancara Pagi.MOV", 3_000_000_000, 1_725_000_000_000)).toBe(id);
    expect(uploadId("Wawancara Pagi.MOV", 3_000_000_001, 1_725_000_000_000)).not.toBe(id);
    expect(uploadId("Wawancara Pagi.MOV", 3_000_000_000, 1_725_000_000_001)).not.toBe(id);
    expect(uploadId("wawancara pagi.mov", 3_000_000_000, 1_725_000_000_000)).not.toBe(id);
  });

  it("potongan berurutan menutup seluruh berkas tepat sekali; yang terakhir lebih pendek", () => {
    const size = UPLOAD_CHUNK_BYTES * 2 + 1000;
    const ranges: Array<{ start: number; end: number }> = [];
    let offset = 0;
    for (;;) {
      const chunk = nextChunk(offset, size);
      if (!chunk) break;
      ranges.push(chunk);
      offset = chunk.end;
    }
    expect(ranges).toEqual([
      { start: 0, end: UPLOAD_CHUNK_BYTES },
      { start: UPLOAD_CHUNK_BYTES, end: UPLOAD_CHUNK_BYTES * 2 },
      { start: UPLOAD_CHUNK_BYTES * 2, end: size },
    ]);
    expect(nextChunk(size, size)).toBeNull();
    expect(nextChunk(500, 400)).toBeNull();
    // Melanjutkan dari tengah: potongannya mulai dari offset yang diberi server.
    expect(nextChunk(1234, 10_000, 4096)).toEqual({ start: 1234, end: 5330 });
  });

  it("jeda coba-ulang membesar dua kali lipat dan berhenti di 15 detik", () => {
    expect([0, 1, 2, 3, 4, 5].map(retryDelayMs)).toEqual([
      1000, 2000, 4000, 8000, 15_000, 15_000,
    ]);
    expect(retryDelayMs(-3)).toBe(1000);
  });

  it("kemajuan gabungan dipangkas ke 0..1 dan berkas kosong dianggap selesai", () => {
    expect(uploadFraction(100, 50, 200)).toBe(0.75);
    expect(uploadFraction(200, 50, 200)).toBe(1);
    expect(uploadFraction(0, 0, 0)).toBe(1);
  });
});
