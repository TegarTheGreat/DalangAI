import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodePng, describeDiff, diffPng } from "../src/png-diff";

/**
 * Dekoder PNG kecil milik gerbang paritas.
 *
 * Diuji dengan PNG yang DIBUAT DI SINI, bukan fixture biner yang dibekukan:
 * fixture tidak bisa dibaca siapa pun saat testnya gagal, sementara pembangun
 * di bawah ini menyatakan bentuk berkasnya sebagai kode. Kelima filter baris
 * PNG ikut diuji satu per satu — filter Paeth yang salah menghasilkan gambar
 * yang "hampir benar", persis kelas kesalahan yang tidak akan terlihat kalau
 * cuma satu filter yang diuji.
 */

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (const byte of bytes) c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const body = new Uint8Array(type.length + data.length);
  for (let i = 0; i < type.length; i++) body[i] = type.charCodeAt(i);
  body.set(data, type.length);
  const out = new Uint8Array(8 + data.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(out.length - 4, crc32(body));
  return out;
};

/**
 * PNG RGBA 8 bit dari piksel mentah, dengan filter yang dipilih pemanggil.
 * `filter` diterapkan pada SEMUA baris — cukup untuk menagih tiap cabang
 * rekonstruksi tanpa membuat pembangunnya rumit.
 */
const makePng = (
  width: number,
  height: number,
  rgba: number[][],
  filter = 0,
): Uint8Array => {
  const stride = width * 4;
  const raw = new Uint8Array(height * (stride + 1));
  const rows: Uint8Array[] = [];
  for (let y = 0; y < height; y++) {
    const line = new Uint8Array(stride);
    for (let x = 0; x < width; x++) {
      const pixel = rgba[y * width + x] as number[];
      line.set(pixel, x * 4);
    }
    rows.push(line);
  }
  const paeth = (a: number, b: number, c: number): number => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const line = rows[y] as Uint8Array;
    const previous = y > 0 ? (rows[y - 1] as Uint8Array) : new Uint8Array(stride);
    const at = y * (stride + 1);
    raw[at] = filter;
    for (let x = 0; x < stride; x++) {
      const value = line[x] as number;
      const left = x >= 4 ? (line[x - 4] as number) : 0;
      const up = previous[x] as number;
      const upLeft = x >= 4 ? (previous[x - 4] as number) : 0;
      const encoded =
        filter === 0
          ? value
          : filter === 1
            ? value - left
            : filter === 2
              ? value - up
              : filter === 3
                ? value - ((left + up) >> 1)
                : value - paeth(left, up, upLeft);
      raw[at + 1 + x] = encoded & 0xff;
    }
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(Buffer.from(raw)))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

const solid = (width: number, height: number, color: number[]): number[][] =>
  Array.from({ length: width * height }, () => color);

describe("decodePng", () => {
  it("membaca kembali piksel yang ditulis, di kelima filter baris", () => {
    const pixels = [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [10, 20, 30, 40],
    ];
    for (const filter of [0, 1, 2, 3, 4]) {
      const image = decodePng(makePng(2, 2, pixels, filter));
      expect(image.width).toBe(2);
      expect(image.height).toBe(2);
      expect([...image.pixels]).toEqual(pixels.flat());
    }
  });

  it("menolak berkas yang bukan PNG, bukan mengarang isinya", () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow("PNG");
  });
});

describe("diffPng", () => {
  it("dua gambar sama menghasilkan nol piksel berbeda", () => {
    const png = makePng(4, 4, solid(4, 4, [12, 34, 56, 255]));
    const diff = diffPng(png, png);
    expect(diff.differing).toBe(0);
    expect(diff.box).toBeNull();
    expect(describeDiff(diff)).toBe("tidak ada piksel yang berbeda");
  });

  it("melaporkan jumlah, selisih terbesar, dan kotak pembatasnya", () => {
    const base = solid(4, 4, [0, 0, 0, 255]);
    const changed = base.map((pixel, index) =>
      index === 5 || index === 6 ? [0, 0, 40, 255] : pixel,
    );
    const diff = diffPng(makePng(4, 4, base), makePng(4, 4, changed));
    expect(diff.differing).toBe(2);
    expect(diff.maxDelta).toBe(40);
    // Piksel 5 dan 6 = (1,1) dan (2,1).
    expect(diff.box).toEqual({ x: 1, y: 1, width: 2, height: 1 });
    expect(describeDiff(diff)).toContain("2 piksel berbeda");
  });

  /**
   * Inti gunanya alat ini: memisahkan GAMBAR HILANG dari SEPUHAN TEPI.
   *
   * Keduanya cuma "beberapa puluh byte" bedanya di berkas PNG terkompresi, dan
   * dari sha256 keduanya terbaca sama-sama "BERBEDA". Persen bidang dan
   * selisih kanal terbesarlah yang memisahkannya.
   */
  it("membedakan blok besar dari garis tipis", () => {
    const kosong = solid(10, 10, [0, 0, 0, 255]);
    const hilang = kosong.map((pixel, index) =>
      index % 10 < 8 && Math.floor(index / 10) < 8 ? [255, 255, 255, 255] : pixel,
    );
    const besar = diffPng(makePng(10, 10, kosong), makePng(10, 10, hilang));
    expect(besar.percent).toBeGreaterThan(50);
    expect(besar.maxDelta).toBe(255);

    const sepuhan = kosong.map((pixel, index) => (index === 33 ? [2, 2, 2, 255] : pixel));
    const tipis = diffPng(makePng(10, 10, kosong), makePng(10, 10, sepuhan));
    expect(tipis.percent).toBeLessThan(2);
    expect(tipis.maxDelta).toBe(2);
  });

  it("ukuran berbeda dikatakan apa adanya, bukan dibandingkan paksa", () => {
    const diff = diffPng(
      makePng(2, 2, solid(2, 2, [0, 0, 0, 255])),
      makePng(3, 3, solid(3, 3, [0, 0, 0, 255])),
    );
    expect(diff.sameSize).toBe(false);
    expect(describeDiff(diff)).toBe("ukuran gambarnya berbeda");
  });
});
