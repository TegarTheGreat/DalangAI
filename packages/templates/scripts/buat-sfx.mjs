/**
 * Pembangkit pustaka efek suara bawaan (ADR-0041).
 *
 * DISINTESIS, bukan diunduh, dan itu keputusan lisensi sebelum jadi keputusan
 * teknis: efek suara "gratis" di internet hampir selalu punya syarat atribusi
 * yang berbeda-beda, dan pustaka yang syaratnya tidak seragam adalah pustaka
 * yang tidak bisa dipakai tanpa membaca satu per satu. Yang lahir dari berkas
 * ini murni angka, jadi hasilnya CC0 tanpa syarat apa pun.
 *
 * Ikut di-commit — berbeda dari pembangkit bed musik, yang hanya ada di
 * riwayat repo. Pembangkit yang tidak ikut membuat berkas suaranya jadi data
 * yatim: tidak ada yang bisa mengubah panjang atau nadanya tanpa menebak
 * ulang cara membuatnya.
 *
 * Jalankan: node packages/templates/scripts/buat-sfx.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 44100;
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "public", "sfx");

/** Amplop serang-luruh sederhana; t dan panjang dalam detik. */
const adsr = (t, len, attack, release) => {
  if (t < 0 || t > len) return 0;
  if (t < attack) return t / attack;
  const sisa = len - t;
  if (sisa < release) return Math.max(0, sisa / release);
  return 1;
};

/** Noise deterministik — LCG, bukan Math.random: berkasnya harus sama tiap kali. */
const makeNoise = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state / 0xffffffff) * 2 - 1;
  };
};

/** Low-pass satu kutub; cutoff dalam Hz. */
const lowpass = (cutoff) => {
  const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / RATE);
  let y = 0;
  return (x) => {
    y += alpha * (x - y);
    return y;
  };
};

/** High-pass satu kutub. */
const highpass = (cutoff) => {
  const lp = lowpass(cutoff);
  return (x) => x - lp(x);
};

const sine = (t, freq) => Math.sin(2 * Math.PI * freq * t);

/**
 * Delapan bunyi yang benar-benar dipakai editor video pendek, bukan delapan
 * bunyi yang kebetulan mudah disintesis.
 */
/** Panjang tiap bunyi, detik — satu sumber, dipakai resep DAN penulisnya. */
const DURASI = {
  whoosh: 0.55,
  pop: 0.12,
  klik: 0.06,
  ding: 0.9,
  tap: 0.14,
  swipe: 0.32,
  impact: 1.1,
  riser: 1.6,
};

const RESEP = {
  // Sapuan udara untuk transisi — noise ter-filter yang cutoff-nya naik lalu
  // turun, persis gerak "wusshh".
  whoosh: (len = DURASI.whoosh) => {
    const noise = makeNoise(1337);
    const lp = lowpass(1200);
    const hp = highpass(180);
    return (t) => {
      const p = t / len;
      // Cutoff bergerak 300 Hz -> 5 kHz -> 600 Hz.
      const naik = Math.sin(Math.PI * p);
      const lp2 = lowpass(300 + naik * 4700);
      const raw = lp2(hp(noise()));
      void lp;
      return raw * adsr(t, len, 0.06, 0.3) * 0.55;
    };
  },
  // Letup pendek untuk teks masuk.
  pop:
    (len = DURASI.pop) =>
    (t) => {
      const f = 620 * Math.exp(-9 * t);
      return sine(t, f) * adsr(t, len, 0.004, 0.09) * 0.7;
    },
  // Klik antarmuka untuk tutorial.
  klik: (len = DURASI.klik) => {
    const noise = makeNoise(4711);
    const hp = highpass(2200);
    return (t) => hp(noise()) * adsr(t, len, 0.001, 0.05) * 0.45;
  },
  // Dentang lembut untuk penanda "selesai" / poin penting.
  ding:
    (len = DURASI.ding) =>
    (t) => {
      const dasar = sine(t, 1318.5) * 0.6 + sine(t, 2637) * 0.25 + sine(t, 3956) * 0.1;
      return dasar * Math.exp(-4.2 * t) * adsr(t, len, 0.003, 0.25) * 0.6;
    },
  // Ketukan kayu untuk aksen ritmis.
  tap: (len = DURASI.tap) => {
    const noise = makeNoise(9001);
    const bp = lowpass(2600);
    const hp = highpass(400);
    return (t) =>
      (hp(bp(noise())) * 0.6 + sine(t, 300 * Math.exp(-14 * t)) * 0.5) *
      Math.exp(-26 * t) *
      adsr(t, len, 0.002, 0.05) *
      0.75;
  },
  // Geser layar untuk potongan cepat.
  swipe: (len = DURASI.swipe) => {
    const noise = makeNoise(2024);
    const hp = highpass(900);
    return (t) => {
      const p = t / len;
      const lp = lowpass(1500 + p * 6000);
      return lp(hp(noise())) * Math.sin(Math.PI * p) ** 1.5 * 0.5;
    };
  },
  // Hentakan rendah untuk judul menghentak.
  impact: (len = DURASI.impact) => {
    const noise = makeNoise(777);
    const lp = lowpass(240);
    return (t) => {
      const sub = sine(t, 62 * Math.exp(-1.6 * t)) * Math.exp(-3.4 * t);
      const badan = lp(noise()) * Math.exp(-6 * t);
      return (sub * 0.85 + badan * 0.5) * adsr(t, len, 0.002, 0.4) * 0.8;
    };
  },
  // Naikan tegangan sebelum reveal.
  riser: (len = DURASI.riser) => {
    const noise = makeNoise(31337);
    const hp = highpass(300);
    return (t) => {
      const p = t / len;
      const lp = lowpass(600 + p * p * 7000);
      const nada = sine(t, 220 * (1 + p * 2.2)) * 0.25 * p;
      return (lp(hp(noise())) * 0.55 * p + nada) * adsr(t, len, 0.2, 0.08) * 0.75;
    };
  },
};

/** WAV PCM 16-bit mono. */
const toWav = (samples) => {
  const data = Buffer.alloc(44 + samples.length * 2);
  data.write("RIFF", 0, "ascii");
  data.writeUInt32LE(36 + samples.length * 2, 4);
  data.write("WAVEfmt ", 8, "ascii");
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(RATE, 24);
  data.writeUInt32LE(RATE * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36, "ascii");
  data.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((value, i) => {
    const clipped = Math.max(-1, Math.min(1, value));
    data.writeInt16LE(Math.round(clipped * 32767), 44 + i * 2);
  });
  return data;
};

/**
 * Kenyaringan terintegrasi ala EBU R128, disederhanakan: high-pass sebagai
 * pendekatan K-weighting, lalu blok 400 ms dengan gerbang absolut -70 LUFS dan
 * gerbang relatif -10 LU.
 *
 * Mengembalikan `null` untuk bunyi yang lebih pendek dari satu blok. Itu bukan
 * kegagalan pengukuran melainkan sifat besarannya: kenyaringan TERINTEGRASI
 * tidak punya arti untuk bunyi 60 milidetik, dan angka yang dipaksa keluar
 * dari sana akan dipakai orang seolah-olah berarti. Bunyi pendek dijamin
 * setara lewat normalisasi PUNCAK, bukan lewat angka yang mengaku LUFS.
 */
const integratedLufs = (samples) => {
  const hp = highpass(38);
  const pre = samples.map((s) => hp(s));
  const blok = Math.round(RATE * 0.4);
  const langkah = Math.round(blok / 4);
  const daya = [];
  for (let i = 0; i + blok <= pre.length; i += langkah) {
    let sum = 0;
    for (let j = i; j < i + blok; j++) sum += pre[j] * pre[j];
    daya.push(sum / blok);
  }
  if (daya.length === 0) return null;
  const loud = (p) => -0.691 + 10 * Math.log10(Math.max(p, 1e-12));
  const lolos = daya.filter((p) => loud(p) > -70);
  if (lolos.length === 0) return null;
  const rerata = lolos.reduce((a, b) => a + b, 0) / lolos.length;
  const ambang = loud(rerata) - 10;
  const akhir = lolos.filter((p) => loud(p) > ambang);
  const pakai = akhir.length > 0 ? akhir : lolos;
  return loud(pakai.reduce((a, b) => a + b, 0) / pakai.length);
};

mkdirSync(outDir, { recursive: true });
const laporan = [];
for (const [id, buat] of Object.entries(RESEP)) {
  const fn = buat();
  const durasi = DURASI[id];
  const total = Math.round(durasi * RATE);
  const samples = new Array(total);
  for (let i = 0; i < total; i++) samples[i] = fn(i / RATE);
  // Normalisasi puncak ke -1 dBFS: bunyi pustaka harus setara satu sama lain,
  // dan yang menyetel volume adalah cue-nya, bukan kebetulan sintesisnya.
  const puncak = Math.max(...samples.map(Math.abs), 1e-9);
  const gain = 0.891 / puncak;
  const akhir = samples.map((s) => s * gain);
  const file = join(outDir, `${id}.wav`);
  writeFileSync(file, toWav(akhir));
  const lufs = integratedLufs(akhir);
  laporan.push({
    id,
    durasi,
    lufs: lufs === null ? "(terlalu pendek)" : Number(lufs.toFixed(2)),
    bytes: toWav(akhir).length,
  });
}
console.table(laporan);
console.log(`\n${laporan.length} berkas ditulis ke ${outDir}`);
console.log("Salin kolom lufs ke BUNDLED_SFX di packages/templates/src/sfx.ts.");
