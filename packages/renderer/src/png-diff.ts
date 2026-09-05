import { inflateSync } from "node:zlib";

/**
 * Pembanding PNG piksel-per-piksel, tanpa dependensi.
 *
 * Kenapa ada: kedua gerbang paritas (migrasi skema dan aset URL) menjatuhkan
 * vonis dari sha256 — benar sebagai vonis, tetapi tidak berguna sebagai
 * diagnosis. "132759 byte vs 132736 byte" tidak bisa membedakan dua hal yang
 * penanganannya berlawanan: GAMBAR YANG HILANG (cacat sungguhan, ribuan piksel
 * berubah di satu blok besar) dan SEPUHAN TEPI yang bergeser satu tingkat
 * (selisih beberapa ratus piksel tipis di garis tepi, tanpa satu pun kanal
 * bergeser jauh). Selisih byte tidak bisa membedakannya; jumlah dan sebaran
 * piksel bisa.
 *
 * Cakupannya sengaja sempit — 8 bit per kanal, RGB atau RGBA, tanpa
 * interlace: itu yang ditulis tangkapan layar Chrome, dan satu-satunya PNG
 * yang pernah masuk ke gerbang ini. Format lain DITOLAK terang-terangan, bukan
 * dibaca setengah benar: dekoder yang menebak menghasilkan diagnosis yang
 * menyesatkan, dan diagnosis yang menyesatkan lebih buruk daripada tidak ada.
 */

export interface PngImage {
  width: number;
  height: number;
  /** RGBA 8 bit, panjang = width * height * 4. */
  pixels: Uint8Array;
}

export interface PngDiff {
  /** Ukuran keduanya sama? Kalau tidak, sisanya tidak dihitung. */
  sameSize: boolean;
  width: number;
  height: number;
  /** Jumlah piksel yang salah satu kanalnya berbeda. */
  differing: number;
  /** Berapa persen dari seluruh bidang. */
  percent: number;
  /** Selisih kanal terbesar (0-255). */
  maxDelta: number;
  /** Kotak pembatas piksel yang berbeda; null bila tidak ada yang berbeda. */
  box: { x: number; y: number; width: number; height: number } | null;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
};

/** Baca PNG 8-bit RGB/RGBA non-interlace jadi RGBA datar. */
export const decodePng = (bytes: Uint8Array): PngImage => {
  for (const [index, expected] of SIGNATURE.entries()) {
    if (bytes[index] !== expected) throw new Error("bukan berkas PNG");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Uint8Array[] = [];

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4] as number,
      bytes[offset + 5] as number,
      bytes[offset + 6] as number,
      bytes[offset + 7] as number,
    );
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      const bitDepth = bytes[offset + 16];
      const colorType = bytes[offset + 17];
      const interlace = bytes[offset + 20];
      if (bitDepth !== 8) throw new Error(`PNG ${bitDepth} bit belum didukung`);
      if (interlace !== 0) throw new Error("PNG interlace belum didukung");
      if (colorType === 2) channels = 3;
      else if (colorType === 6) channels = 4;
      else throw new Error(`PNG color type ${colorType} belum didukung`);
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }

  if (width === 0 || height === 0) throw new Error("PNG tanpa IHDR yang sah");
  const raw = inflateSync(Buffer.concat(idat.map((chunk) => Buffer.from(chunk))));
  const stride = width * channels;
  const pixels = new Uint8Array(width * height * 4);
  // Baris sebelumnya, sudah direkonstruksi — dibutuhkan filter Up/Average/Paeth.
  let previous = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];
    const line = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const value = raw[rowStart + 1 + x] as number;
      const left = x >= channels ? (line[x - channels] as number) : 0;
      const up = previous[x] as number;
      const upLeft = x >= channels ? (previous[x - channels] as number) : 0;
      let recon: number;
      switch (filter) {
        case 0:
          recon = value;
          break;
        case 1:
          recon = value + left;
          break;
        case 2:
          recon = value + up;
          break;
        case 3:
          recon = value + ((left + up) >> 1);
          break;
        case 4:
          recon = value + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`filter PNG ${filter} tidak dikenal`);
      }
      line[x] = recon & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      pixels[dst] = line[src] as number;
      pixels[dst + 1] = line[src + 1] as number;
      pixels[dst + 2] = line[src + 2] as number;
      pixels[dst + 3] = channels === 4 ? (line[src + 3] as number) : 255;
    }
    previous = line;
  }

  return { width, height, pixels };
};

/** Bandingkan dua PNG; hasilnya angka yang bisa dibaca manusia. */
export const diffPng = (aBytes: Uint8Array, bBytes: Uint8Array): PngDiff => {
  const a = decodePng(aBytes);
  const b = decodePng(bBytes);
  if (a.width !== b.width || a.height !== b.height) {
    return {
      sameSize: false,
      width: a.width,
      height: a.height,
      differing: 0,
      percent: 0,
      maxDelta: 0,
      box: null,
    };
  }

  let differing = 0;
  let maxDelta = 0;
  let minX = a.width;
  let minY = a.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const index = (y * a.width + x) * 4;
      let delta = 0;
      for (let channel = 0; channel < 4; channel++) {
        const difference = Math.abs(
          (a.pixels[index + channel] as number) - (b.pixels[index + channel] as number),
        );
        if (difference > delta) delta = difference;
      }
      if (delta === 0) continue;
      differing++;
      if (delta > maxDelta) maxDelta = delta;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  return {
    sameSize: true,
    width: a.width,
    height: a.height,
    differing,
    percent: (differing / (a.width * a.height)) * 100,
    maxDelta,
    box:
      maxX < 0
        ? null
        : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
};

/**
 * Satu baris yang bisa dibaca orang yang sedang menatap CI merah.
 *
 * Bentuknya sengaja menyebut PERSEN dan KOTAK PEMBATAS lebih dulu: itu dua
 * angka yang langsung memisahkan gambar hilang dari sepuhan tepi, dan orang
 * yang membacanya biasanya cuma punya sepuluh detik sebelum memutuskan apakah
 * ini masalahnya atau bukan.
 */
/**
 * Batas "kebisingan rasterisasi" — di bawahnya dua PNG dianggap gambar yang
 * SAMA meski byte-nya berbeda.
 *
 * Angkanya bukan tebakan; ia dibaca dari kegagalan CI yang sesungguhnya.
 * Gerbang paritas migrasi menjatuhkan frame 12 dengan hitungan ini:
 *
 *   248 piksel berbeda (0,191% dari 270x480), selisih kanal terbesar 2/255,
 *   terkurung di kotak 264x479 pada (0, 1)
 *
 * dan yang berbeda BUKAN v1 melawan v2, melainkan satu sisi melawan RENDER
 * ULANGNYA SENDIRI — plan yang sama, dua kali, di runner yang sama. Selisih
 * kanal 2/255 yang tersebar tipis ke hampir seluruh bidang adalah tanda
 * pembulatan rasterisasi (sepuhan tepi sub-piksel di Chrome headless), bukan
 * tanda ada yang berubah di gambarnya: 2/255 berada di bawah ambang lihat
 * mata manusia pada layar mana pun.
 *
 * Kenapa ambang ini tetap menangkap cacat yang dicari gerbangnya: field yang
 * tidak ikut migrasi mengganti GAMBAR — aset lain, teks hilang, tata letak
 * bergeser. Semuanya menggeser kanal puluhan sampai 255, jauh di atas 2, dan
 * pergeseran satu bingkai pada animasi pun memberi selisih besar di tepi yang
 * bergerak. Tidak ada cacat migrasi yang bisa bersembunyi di bawah 2/255.
 *
 * Batas LUAS tetap dipasang berdampingan: pergeseran serba-sedikit yang
 * menyentuh hampir seluruh bidang (mis. filter kecerahan yang hilang saat
 * migrasi) akan lolos ambang kanal, tapi tidak lolos ambang luas. Yang
 * terukur di CI 0,191%; 2% memberi kelonggaran nyata tanpa mendekati
 * "seluruh gambarnya berubah".
 */
export const NOISE_MAX_DELTA = 2;
export const NOISE_MAX_PERCENT = 2;

/**
 * Dua PNG setara secara GAMBAR? Ini vonis yang dipakai kedua gerbang paritas,
 * satu definisi untuk keduanya: ambang yang disalin akan menyimpang, dan yang
 * menyimpang duluan pasti yang jarang dibaca.
 */
export const withinRasterNoise = (diff: PngDiff): boolean =>
  diff.sameSize && diff.maxDelta <= NOISE_MAX_DELTA && diff.percent <= NOISE_MAX_PERCENT;

export const describeDiff = (diff: PngDiff): string => {
  if (!diff.sameSize) return "ukuran gambarnya berbeda";
  if (diff.differing === 0) return "tidak ada piksel yang berbeda";
  const box = diff.box as NonNullable<PngDiff["box"]>;
  return (
    `${diff.differing} piksel berbeda (${diff.percent.toFixed(3)}% dari ` +
    `${diff.width}x${diff.height}), selisih kanal terbesar ${diff.maxDelta}/255, ` +
    `terkurung di kotak ${box.width}x${box.height} pada (${box.x}, ${box.y})`
  );
};
