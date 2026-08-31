/**
 * Pengukur kenyaringan EBU R128 / ITU-R BS.1770-4 (ADR-0026, roadmap §9.4).
 *
 * Murni: masuk PCM, keluar satu angka LUFS. Tidak ada berkas, tidak ada
 * proses anak, tidak ada jaringan — jadi seluruh aturannya bisa diuji dengan
 * sinyal yang kita bangkitkan sendiri dan kita tahu jawabannya.
 *
 * KENAPA DITULIS SENDIRI, bukan memanggil `ffmpeg -af ebur128`. Dalang tidak
 * punya ffmpeg sebagai dependensi, dan menambahkannya berarti setiap pengguna
 * dan setiap runner CI harus memasang biner 70 MB untuk mendapat satu angka.
 * Yang dibutuhkan cuma PCM, dan PCM sudah bisa didapat lewat `extractAudio`
 * milik Remotion yang MEMANG sudah ada di tumpukan ini (lihat port
 * `AudioProbe`). Sisanya aritmetika yang spesifikasinya terbuka.
 *
 * Yang diimplementasikan: penapis K (dua tahap biquad), blok 400 ms bertumpang
 * 75%, gerbang mutlak -70 LUFS, lalu gerbang relatif -10 LU. Itu definisi
 * "integrated loudness" yang dipakai seluruh industri.
 */

export interface PcmAudio {
  sampleRate: number;
  /** Satu Float32Array per kanal, rentang -1..1. */
  channels: Float32Array[];
}

// ---------------------------------------------------------------------------
// WAV
// ---------------------------------------------------------------------------

const ascii = (view: Uint8Array, offset: number, length: number): string =>
  String.fromCharCode(...view.subarray(offset, offset + length));

/**
 * Pembaca WAV PCM (integer 8/16/24/32-bit dan float 32-bit).
 *
 * Chunk ditelusuri, bukan diasumsikan berurutan: berkas WAV sah boleh punya
 * `LIST`/`fact`/`bext` sebelum `data`, dan pembaca yang melompat ke byte 44
 * akan membaca metadata sebagai suara pada berkas seperti itu.
 */
interface WavHeader {
  /** Kode format WAVE: 1 = PCM integer, 3 = float. Selain itu terkompresi. */
  format: number;
  channelCount: number;
  sampleRate: number;
  bitsPerSample: number;
  dataOffset: number;
  dataLength: number;
}

/**
 * Nama manusiawi untuk kode format WAVE yang sering muncul.
 *
 * Ada supaya pesan galat menyebut "AAC", bukan "255" — nomor itu tidak
 * memberi tahu siapa pun apa yang harus dilakukan berikutnya.
 */
export const wavFormatName = (format: number): string =>
  ({
    1: "PCM",
    3: "PCM float",
    17: "IMA ADPCM",
    49: "GSM 6.10",
    85: "MP3",
    255: "AAC",
    8192: "AC-3",
    8193: "DTS",
    26481: "Opus",
    61868: "FLAC",
  })[format] ?? `format ${format}`;

const readWavHeader = (bytes: Uint8Array): WavHeader => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.byteLength < 12 ||
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 4) !== "WAVE"
  ) {
    throw new Error("Bukan berkas WAV (header RIFF/WAVE tidak ditemukan).");
  }

  let format = 0;
  let channelCount = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataLength = 0;

  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      format = view.getUint16(body, true);
      channelCount = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE menyimpan format aslinya di GUID; dua byte
      // pertamanya adalah kode format yang sama.
      if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true);
    } else if (id === "data") {
      dataOffset = body;
      dataLength = Math.min(size, bytes.byteLength - body);
    }
    offset = body + size + (size % 2);
  }

  if (dataOffset < 0 || channelCount === 0 || sampleRate === 0) {
    throw new Error("Berkas WAV tidak punya chunk fmt/data yang lengkap.");
  }
  return { format, channelCount, sampleRate, bitsPerSample, dataOffset, dataLength };
};

/**
 * Kode format sebuah berkas WAV, atau `null` kalau ia bukan WAV sama sekali.
 *
 * Dipakai untuk MEMERIKSA keluaran pengekstrak audio sebelum mencoba
 * membacanya. Sebuah "berkas .wav" bisa berisi AAC hasil salin-aliran; itu
 * kontainer WAV yang sah tapi bukan PCM, dan hanya kode format ini yang
 * membedakannya.
 */
export const wavFormatCode = (bytes: Uint8Array): number | null => {
  try {
    return readWavHeader(bytes).format;
  } catch {
    return null;
  }
};

/** Apakah isinya benar-benar PCM yang bisa dibaca — bukan sekadar berakhiran .wav. */
export const isPcmWav = (bytes: Uint8Array): boolean => {
  const format = wavFormatCode(bytes);
  return format === 1 || format === 3;
};

export const decodeWav = (bytes: Uint8Array): PcmAudio => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { format, channelCount, sampleRate, bitsPerSample, dataOffset, dataLength } =
    readWavHeader(bytes);

  if (format !== 1 && format !== 3) {
    throw new Error(
      `Isi WAV ini ${wavFormatName(format)}, bukan PCM — perlu dekoder untuk mengukurnya.`,
    );
  }

  const bytesPerSample = bitsPerSample / 8;
  const frames = Math.floor(dataLength / (bytesPerSample * channelCount));
  const channels = Array.from({ length: channelCount }, () => new Float32Array(frames));

  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channelCount; channel++) {
      const at = dataOffset + (frame * channelCount + channel) * bytesPerSample;
      let value: number;
      if (format === 3) {
        value =
          bitsPerSample === 64 ? view.getFloat64(at, true) : view.getFloat32(at, true);
      } else if (bitsPerSample === 8) {
        // 8-bit WAV adalah UNSIGNED; titik nolnya 128, bukan 0.
        value = (view.getUint8(at) - 128) / 128;
      } else if (bitsPerSample === 16) {
        value = view.getInt16(at, true) / 32768;
      } else if (bitsPerSample === 24) {
        const raw =
          view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getInt8(at + 2) << 16);
        value = raw / 8388608;
      } else if (bitsPerSample === 32) {
        value = view.getInt32(at, true) / 2147483648;
      } else {
        throw new Error(`Kedalaman bit WAV ${bitsPerSample} tidak didukung.`);
      }
      (channels[channel] as Float32Array)[frame] = value;
    }
  }

  return { sampleRate, channels };
};

// ---------------------------------------------------------------------------
// Penapis K
// ---------------------------------------------------------------------------

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * Koefisien penapis K untuk laju cuplik SEMBARANG.
 *
 * BS.1770 hanya menuliskan koefisien untuk 48 kHz. Memakainya apa adanya pada
 * 44,1 atau 22,05 kHz menggeser titik potong penapisnya dan menghasilkan angka
 * yang salah beberapa persepuluh LU — cukup untuk membuat dua berkas yang
 * sebenarnya sama nyaring terdengar berbeda. Karena itu koefisiennya dihitung
 * ulang dari prototipe analognya lewat transformasi bilinear, cara yang sama
 * yang dipakai implementasi rujukan (libebur128).
 */
const kWeightingStages = (sampleRate: number): [Biquad, Biquad] => {
  // Tahap 1: shelving frekuensi tinggi (+~4 dB), meniru pantulan kepala.
  const f0 = 1681.974450955533;
  const G = 3.999843853973347;
  const Q = 0.7071752369554196;

  const K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  const den1 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / den1,
    b1: (2 * (K * K - Vh)) / den1,
    b2: (Vh - (Vb * K) / Q + K * K) / den1,
    a1: (2 * (K * K - 1)) / den1,
    a2: (1 - K / Q + K * K) / den1,
  };

  // Tahap 2: high-pass (RLB), membuang energi frekuensi sangat rendah yang
  // tidak ikut terdengar sebagai kenyaringan.
  const f0b = 38.13547087602444;
  const Qb = 0.5003270373238773;
  const Kb = Math.tan((Math.PI * f0b) / sampleRate);
  const den2 = 1 + Kb / Qb + Kb * Kb;
  const highpass: Biquad = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (Kb * Kb - 1)) / den2,
    a2: (1 - Kb / Qb + Kb * Kb) / den2,
  };

  return [shelf, highpass];
};

const applyBiquad = (input: Float32Array, filter: Biquad): Float32Array => {
  const out = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i] as number;
    const y0 =
      filter.b0 * x0 + filter.b1 * x1 + filter.b2 * x2 - filter.a1 * y1 - filter.a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
};

/**
 * Bobot per kanal menurut BS.1770.
 *
 * Kanal surround belakang dihitung 1,41x; depan dan tengah 1x; LFE TIDAK ikut
 * sama sekali. Untuk mono dan stereo — satu-satunya yang benar-benar dipakai
 * Dalang hari ini — semuanya 1.
 */
const channelWeight = (index: number, count: number): number => {
  if (count <= 2) return 1;
  // 5.1: L R C LFE Ls Rs
  if (count >= 6 && index === 3) return 0;
  return index >= 4 ? 1.41 : 1;
};

const BLOCK_SEC = 0.4;
const OVERLAP = 0.75;
/** Konstanta kalibrasi BS.1770 supaya sinus 1 kHz -20 dBFS terbaca -20 LUFS. */
const OFFSET_LU = -0.691;
const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = -10;

export interface LoudnessResult {
  /** Kenyaringan terintegrasi, LUFS. `null` = tidak ada blok yang lolos gerbang. */
  lufs: number | null;
  /** Puncak sampel tertinggi (linear, 0-1+) — dipakai memperingatkan kliping. */
  peak: number;
  durationSec: number;
  /**
   * Jumlah kanal sumbernya. Ikut dilaporkan karena kenyaringan yang TERDENGAR
   * bergantung padanya: sumber mono di campuran stereo naik 3,01 LU.
   */
  channels: number;
}

/**
 * Kenyaringan terintegrasi satu potongan audio.
 *
 * Mengembalikan `null` untuk materi yang seluruhnya di bawah gerbang mutlak
 * (sunyi, atau nyaris sunyi). Itu BUKAN nol dan bukan -70: berkas sunyi tidak
 * punya kenyaringan yang bermakna, dan menormalisasi berdasarkan angka
 * karangan akan menaikkan desisnya sampai batas penguatan.
 */
export const integratedLoudness = (audio: PcmAudio): LoudnessResult => {
  const { sampleRate, channels } = audio;
  const frames = channels[0]?.length ?? 0;
  const durationSec = sampleRate > 0 ? frames / sampleRate : 0;

  let peak = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) {
      const magnitude = Math.abs(channel[i] as number);
      if (magnitude > peak) peak = magnitude;
    }
  }

  const channelCount = channels.length;
  const blockSize = Math.round(BLOCK_SEC * sampleRate);
  const step = Math.round(blockSize * (1 - OVERLAP));
  if (blockSize <= 0 || step <= 0 || frames < blockSize) {
    // Lebih pendek dari satu blok 400 ms: R128 tidak terdefinisi di situ, dan
    // memaksakan angka untuk potongan sependek itu memberi hasil yang
    // bergantung pada di mana kebetulan ia terpotong.
    return { lufs: null, peak, durationSec, channels: channelCount };
  }

  const [shelf, highpass] = kWeightingStages(sampleRate);
  const weighted = channels.map((channel) =>
    applyBiquad(applyBiquad(channel, shelf), highpass),
  );

  // Daya rata-rata per blok, sudah ditimbang antar kanal.
  const blockPower: number[] = [];
  for (let start = 0; start + blockSize <= frames; start += step) {
    let sum = 0;
    weighted.forEach((channel, index) => {
      const weight = channelWeight(index, weighted.length);
      if (weight === 0) return;
      let square = 0;
      for (let i = start; i < start + blockSize; i++) {
        const value = channel[i] as number;
        square += value * value;
      }
      sum += weight * (square / blockSize);
    });
    blockPower.push(sum);
  }

  const loudnessOf = (power: number): number =>
    power > 0 ? OFFSET_LU + 10 * Math.log10(power) : Number.NEGATIVE_INFINITY;

  // Gerbang MUTLAK: buang yang di bawah -70 LUFS.
  const aboveAbsolute = blockPower.filter(
    (power) => loudnessOf(power) > ABSOLUTE_GATE_LUFS,
  );
  if (aboveAbsolute.length === 0)
    return { lufs: null, peak, durationSec, channels: channelCount };

  // Gerbang RELATIF: ambang = rata-rata yang lolos gerbang mutlak, kurang 10 LU.
  const meanAbsolute =
    aboveAbsolute.reduce((sum, power) => sum + power, 0) / aboveAbsolute.length;
  const threshold = loudnessOf(meanAbsolute) + RELATIVE_GATE_LU;
  const aboveRelative = aboveAbsolute.filter((power) => loudnessOf(power) > threshold);
  if (aboveRelative.length === 0)
    return { lufs: null, peak, durationSec, channels: channelCount };

  const mean =
    aboveRelative.reduce((sum, power) => sum + power, 0) / aboveRelative.length;
  return {
    lufs: Number(loudnessOf(mean).toFixed(2)),
    peak,
    durationSec,
    channels: channelCount,
  };
};

/** WAV mentah -> hasil ukur. Pintasan yang dipakai stage dan tesnya. */
export const measureWavLoudness = (bytes: Uint8Array): LoudnessResult =>
  integratedLoudness(decodeWav(bytes));
