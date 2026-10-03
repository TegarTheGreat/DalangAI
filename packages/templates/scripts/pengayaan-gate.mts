/**
 * Gerbang pengayaan (ADR-0041).
 *
 * Preset warna, vignette, dan butiran adalah DATA yang lolos skema apa pun.
 * Nilai `preset: "senja"` yang tidak terdaftar di peta CSS menghasilkan gambar
 * yang terlihat persis seperti tanpa filter — tidak ada galat, tidak ada tes
 * merah, dan tidak ada yang tahu sampai ada yang membandingkan dua bingkai.
 *
 * Gerbang ini merender bingkai yang SAMA tiga kali — polos, ber-vignette,
 * dan berbutir — lalu MENGUKURNYA:
 *
 *  - vignette wajib menggelapkan SUDUT relatif terhadap tengah, tanpa
 *    menambah tekstur;
 *  - butiran wajib menaikkan beda piksel BERTETANGGA, tanpa menggelapkan
 *    sudut;
 *  - vignette pada LAPISAN VIDEO wajib menggelapkan sudut KOTAK lapisan itu
 *    — bukan sudut bingkai. Sisipan adalah tempat efek ini paling mudah
 *    dilewatkan: ia jalur render yang berbeda dari visual dasar.
 *
 * Dua tuntutan itu sengaja saling menyilang: efek yang tertukar
 * implementasinya akan lulus salah satunya dan gagal yang lain.
 *
 * Bagian kedua mengukur TRANSISI ANTAR KLIP di tiga rasio: setelah clock-wipe
 * selesai, seluruh bingkai harus sudah milik klip kedua. Transisi itu jalur
 * render yang berbeda dari transisi antar scene (ClipStrip, bukan preset), dan
 * pernah lupa menerima ukuran bingkai — di 16:9 sapuannya berhenti sebelum
 * menutup, dan baji gelap menetap di sisi kanan sepanjang klip kedua.
 *
 * Jalankan: pnpm --filter @dalang/templates gate:pengayaan
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const out = mkdtempSync(join(tmpdir(), "dalang-pengayaan-"));

/** PNG abu-abu rata 64x64 — murni zlib, tanpa pustaka gambar. */
const pngAbuAbu = (nilai: number): Buffer => {
  const ukuran = 64;
  const baris = Buffer.concat([Buffer.from([0]), Buffer.alloc(ukuran, nilai)]);
  const mentah = Buffer.concat(Array.from({ length: ukuran }, () => baris));
  const crcTabel = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (data: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of data) c = (crcTabel[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const potongan = (tipe: string, isi: Buffer): Buffer => {
    const panjang = Buffer.alloc(4);
    panjang.writeUInt32BE(isi.length);
    const badan = Buffer.concat([Buffer.from(tipe, "ascii"), isi]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(badan));
    return Buffer.concat([panjang, badan, sum]);
  };
  const kepala = Buffer.alloc(13);
  kepala.writeUInt32BE(ukuran, 0);
  kepala.writeUInt32BE(ukuran, 4);
  kepala[8] = 8; // kedalaman bit
  kepala[9] = 0; // abu-abu
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    potongan("IHDR", kepala),
    potongan("IDAT", deflateSync(mentah)),
    potongan("IEND", Buffer.alloc(0)),
  ]);
};

/** Plan satu scene, hanya efeknya yang berbeda. */
const planFor = (
  id: string,
  vignette: number,
  grain: number,
  lapisan: { vignette: number } | null = null,
) => ({
  version: 2,
  projectId: id,
  meta: {
    title: "Uji Efek",
    aspectRatio: "9:16",
    language: "id",
    stylePreset: "documentary-01",
    format: "bebas",
  },
  audio: {},
  scenes: [
    {
      id: "sc-a",
      narration: "Satu kalimat pendek untuk menguji efek.",
      duration: 3,
      clips: [
        {
          id: "sc-a-k1",
          type: "solid",
          variant: "topo",
          motion: "none",
          filter: { preset: "none", vignette, grain },
        },
      ],
      // Kotak lapisan: 70% lebar x 40% tinggi, di tengah — gerbang mengukur
      // sudut KOTAK itu, jadi angkanya harus sama dengan yang dipakai probe.
      ...(lapisan
        ? {
            layers: [
              {
                id: "lap-1",
                visual: {
                  type: "image",
                  assetId: "lap",
                  filter: { preset: "none", vignette: lapisan.vignette, grain: 0 },
                },
                anchor: "tengah",
                width: 0.7,
                height: 0.4,
                radius: 0,
                entrance: "diam",
              },
            ],
          }
        : {}),
    },
  ],
  renderState: {
    narrationAudio: {},
    dubAudio: {},
    clipAssets: {},
    graphicAssets: {},
    layerAssets: lapisan
      ? { "lap-1": { file: "assets/lap.png", kind: "image", source: "local" } }
      : {},
    sfxAssets: {},
    trackAssets: {},
    transcripts: {},
  },
});

const VARIAN = [
  { id: "polos", vignette: 0, grain: 0, lapisan: null },
  { id: "vignette", vignette: 0.7, grain: 0, lapisan: null },
  { id: "grain", vignette: 0, grain: 0.8, lapisan: null },
  { id: "lapisan-polos", vignette: 0, grain: 0, lapisan: { vignette: 0 } },
  { id: "lapisan-vignette", vignette: 0, grain: 0, lapisan: { vignette: 0.9 } },
] as const;

for (const varian of VARIAN) {
  const dir = join(out, varian.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "plan.json"),
    `${JSON.stringify(planFor(varian.id, varian.vignette, varian.grain, varian.lapisan), null, 2)}\n`,
  );
  if (varian.lapisan) {
    mkdirSync(join(dir, "assets"), { recursive: true });
    writeFileSync(join(dir, "assets", "lap.png"), pngAbuAbu(128));
  }
  execFileSync(
    "pnpm",
    ["dalang", "still", join(dir, "plan.json"), "-t", "1.5", "-s", "0.5", "-o", dir],
    { cwd: repoRoot, stdio: "inherit" },
  );
}

const probe = `
import json, sys
from pathlib import Path
from PIL import Image

def ukur(path):
    im = Image.open(path).convert("L")
    w, h = im.size
    d = list(im.getdata())
    # Beda piksel bertetangga: butiran menaikkannya, vignette tidak.
    baris = range(0, h, 3)
    beda = sum(abs(d[y*w+x] - d[y*w+x+1]) for y in baris for x in range(w - 1))
    tekstur = beda / (len(list(baris)) * (w - 1))
    # Sudut vs tengah: vignette menurunkannya, butiran tidak.
    sudut = sum(d[y*w+x] for y in range(h//8) for x in range(w//8)) / ((h//8)*(w//8))
    ty = range(h//2 - h//16, h//2 + h//16)
    tx = range(w//2 - w//16, w//2 + w//16)
    tengah = sum(d[y*w+x] for y in ty for x in tx) / (len(list(ty)) * len(list(tx)))
    # Kotak lapisan (70% x 40%, di tengah): sudut kotak vs tengah kotak.
    kx0, kx1 = int(w * 0.15), int(w * 0.85)
    ky0, ky1 = int(h * 0.30), int(h * 0.70)
    kw, kh = kx1 - kx0, ky1 - ky0
    px, py = max(kw // 12, 2), max(kh // 12, 2)
    ks = [d[y*w+x] for y in range(ky0 + 2, ky0 + 2 + py) for x in range(kx0 + 2, kx0 + 2 + px)]
    kc = [d[y*w+x] for y in range(ky0 + kh//2 - py//2, ky0 + kh//2 + py//2) for x in range(kx0 + kw//2 - px//2, kx0 + kw//2 + px//2)]
    rasio_kotak = (sum(ks) / len(ks)) / max(sum(kc) / len(kc), 0.01)
    return {"tekstur": tekstur, "rasioSudut": sudut / max(tengah, 0.01), "rasioKotak": rasio_kotak}

hasil = {}
for nama in sys.argv[1:]:
    dir_ = Path(nama)
    png = sorted(dir_.glob("*.png"))
    if not png:
        hasil[dir_.name] = None
    else:
        hasil[dir_.name] = ukur(png[0])
print(json.dumps(hasil))
`;

let ukur: Record<
  string,
  { tekstur: number; rasioSudut: number; rasioKotak: number } | null
>;
try {
  const raw = execFileSync(
    "python3",
    ["-c", probe, ...VARIAN.map((v) => join(out, v.id))],
    { encoding: "utf8" },
  );
  ukur = JSON.parse(raw);
} catch (error) {
  console.error(
    "GERBANG PENGAYAAN GAGAL: pengukur bingkai tidak bisa dijalankan.\n" +
      "  Pasang dulu: python3 -m pip install pillow\n" +
      `  ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

const problems: string[] = [];
const polos = ukur.polos;
const vignette = ukur.vignette;
const grain = ukur.grain;
if (!polos || !vignette || !grain) {
  console.error("GERBANG PENGAYAAN GAGAL: ada bingkai yang tidak ter-render.");
  process.exit(1);
}

console.log("Gerbang pengayaan — ukuran bingkai:");
for (const [nama, nilai] of Object.entries(ukur)) {
  if (!nilai) continue;
  console.log(
    `  ${nama.padEnd(17)} tekstur=${nilai.tekstur.toFixed(3)} rasioSudut=${nilai.rasioSudut.toFixed(3)} rasioKotak=${nilai.rasioKotak.toFixed(3)}`,
  );
}

// --- Vignette: sudut lebih gelap, tekstur TIDAK berubah ---
if (vignette.rasioSudut >= polos.rasioSudut - 0.05) {
  problems.push(
    `vignette tidak menggelapkan sudut (rasio ${vignette.rasioSudut.toFixed(3)} vs polos ${polos.rasioSudut.toFixed(3)})`,
  );
}
if (Math.abs(vignette.tekstur - polos.tekstur) > polos.tekstur * 0.06) {
  problems.push(
    `vignette mengubah TEKSTUR (${vignette.tekstur.toFixed(3)} vs ${polos.tekstur.toFixed(3)}) — itu pekerjaan butiran, bukan vignette`,
  );
}

// --- Butiran: tekstur naik, sudut TIDAK menggelap ---
if (grain.tekstur <= polos.tekstur * 1.05) {
  problems.push(
    `butiran tidak menaikkan tekstur (${grain.tekstur.toFixed(3)} vs polos ${polos.tekstur.toFixed(3)})`,
  );
}
if (grain.rasioSudut < polos.rasioSudut - 0.06) {
  problems.push(
    `butiran menggelapkan sudut (rasio ${grain.rasioSudut.toFixed(3)} vs polos ${polos.rasioSudut.toFixed(3)}) — itu pekerjaan vignette`,
  );
}

// --- Vignette pada LAPISAN: sudut KOTAK lapisan menggelap, dan hanya di sana ---
const lapPolos = ukur["lapisan-polos"];
const lapVignette = ukur["lapisan-vignette"];
if (!lapPolos || !lapVignette) {
  problems.push("bingkai dengan lapisan video tidak ter-render");
} else {
  if (lapVignette.rasioKotak >= lapPolos.rasioKotak - 0.05) {
    problems.push(
      `vignette pada lapisan tidak menggelapkan sudut kotaknya (rasio ${lapVignette.rasioKotak.toFixed(3)} vs polos ${lapPolos.rasioKotak.toFixed(3)}) — ClipEffects tidak terpasang di LayersOverlay`,
    );
  }
  // Vignette lapisan TIDAK boleh bocor ke sudut bingkai.
  if (lapVignette.rasioSudut < lapPolos.rasioSudut - 0.05) {
    problems.push(
      `vignette lapisan menggelapkan sudut BINGKAI (rasio ${lapVignette.rasioSudut.toFixed(3)} vs polos ${lapPolos.rasioSudut.toFixed(3)}) — seharusnya terkurung di kotak lapisan`,
    );
  }
}

// --- Transisi antar KLIP: setelah clock-wipe selesai, bingkai utuh milik klip kedua ---
const RASIO_KLIP = ["16:9", "9:16", "1:1"] as const;
const planKlip = (aspek: string) => ({
  version: 2,
  projectId: `klip-${aspek.replace(":", "x")}`,
  meta: {
    title: "Uji Transisi Klip",
    aspectRatio: aspek,
    language: "id",
    stylePreset: "klip-01",
    format: "bebas",
  },
  audio: {},
  scenes: [
    {
      id: "sc-a",
      narration: "",
      caption: { enabled: false },
      clips: [
        {
          id: "sc-a-k1",
          type: "image",
          assetId: "assets/gelap.png",
          pinned: true,
          durationSec: 2,
          transition: { type: "clock-wipe", durationFrames: 15 },
        },
        {
          id: "sc-a-k2",
          type: "image",
          assetId: "assets/terang.png",
          pinned: true,
          durationSec: 2,
        },
      ],
    },
  ],
  renderState: {
    narrationAudio: {},
    dubAudio: {},
    clipAssets: {
      "sc-a-k1": { file: "assets/gelap.png", kind: "image", source: "local" },
      "sc-a-k2": { file: "assets/terang.png", kind: "image", source: "local" },
    },
    graphicAssets: {},
    layerAssets: {},
    sfxAssets: {},
    trackAssets: {},
    transcripts: {},
  },
});

const dirKlip = (aspek: string) => join(out, `klip-${aspek.replace(":", "x")}`);
for (const aspek of RASIO_KLIP) {
  const dir = dirKlip(aspek);
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "plan.json"), `${JSON.stringify(planKlip(aspek), null, 2)}\n`);
  writeFileSync(join(dir, "assets", "gelap.png"), pngAbuAbu(30));
  writeFileSync(join(dir, "assets", "terang.png"), pngAbuAbu(220));
  // t=1,0 dtk: hanya klip pertama. t=3,2 dtk: transisi (1,9-2,1 dtk) sudah lama selesai.
  execFileSync(
    "pnpm",
    [
      "dalang",
      "still",
      join(dir, "plan.json"),
      "-t",
      "1.0",
      "3.2",
      "-s",
      "0.4",
      "-o",
      dir,
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );
}

const probeKlip = `
import json, sys
from pathlib import Path
from PIL import Image

def blok(path):
    # Rata-rata kecerahan per petak 12x8, di bawah garis retensi (12% teratas).
    im = Image.open(path).convert("L")
    w, h = im.size
    d = im.load()
    y0 = int(h * 0.12)
    tinggi = (h - y0) // 8
    lebar = w // 12
    hasil = []
    for by in range(8):
        for bx in range(12):
            tot = n = 0
            for y in range(y0 + by * tinggi + 2, y0 + (by + 1) * tinggi - 2, 3):
                for x in range(bx * lebar + 2, (bx + 1) * lebar - 2, 3):
                    tot += d[x, y]
                    n += 1
            hasil.append(tot / max(n, 1))
    return hasil

keluar = {}
for nama in sys.argv[1:]:
    png = sorted(Path(nama).glob("*.png"), key=lambda p: int(p.stem.rsplit("-f", 1)[1]))
    if len(png) < 2:
        keluar[Path(nama).name] = None
        continue
    awal, akhir = blok(png[0]), blok(png[-1])
    keluar[Path(nama).name] = {
        "awalMaks": max(awal),
        "akhirMin": min(akhir),
        "akhirIndeks": akhir.index(min(akhir)),
    }
print(json.dumps(keluar))
`;

let klipUkur: Record<
  string,
  { awalMaks: number; akhirMin: number; akhirIndeks: number } | null
>;
try {
  klipUkur = JSON.parse(
    execFileSync("python3", ["-c", probeKlip, ...RASIO_KLIP.map(dirKlip)], {
      encoding: "utf8",
    }),
  );
} catch (error) {
  console.error(
    `GERBANG PENGAYAAN GAGAL: pengukur transisi klip tidak bisa dijalankan.\n  ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
console.log("\nTransisi antar klip (clock-wipe), petak kecerahan 12x8:");
for (const aspek of RASIO_KLIP) {
  const nama = `klip-${aspek.replace(":", "x")}`;
  const nilai = klipUkur[nama];
  if (!nilai) {
    problems.push(`transisi klip ${aspek}: bingkai tidak ter-render`);
    continue;
  }
  console.log(
    `  ${aspek.padEnd(5)} sebelum: terang maks ${nilai.awalMaks.toFixed(0)}  sesudah: gelap min ${nilai.akhirMin.toFixed(0)} (petak ${nilai.akhirIndeks})`,
  );
  // Sebelum transisi hanya klip gelap (30): tidak boleh ada petak terang.
  if (nilai.awalMaks > 80) {
    problems.push(
      `transisi klip ${aspek}: sebelum transisi sudah ada petak terang (${nilai.awalMaks.toFixed(0)}) — klip kedua bocor lebih awal`,
    );
  }
  // Sesudah transisi seluruh bingkai klip terang (220): petak tergelap pun harus terang.
  if (nilai.akhirMin < 190) {
    problems.push(
      `transisi klip ${aspek}: setelah clock-wipe selesai masih ada petak gelap (${nilai.akhirMin.toFixed(0)}, petak ${nilai.akhirIndeks}) — sapuan tidak menutup bingkai; ukuran bingkai tidak sampai ke transisi antar klip`,
    );
  }
}

if (problems.length > 0) {
  console.error("\nGERBANG PENGAYAAN GAGAL:");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(`  bingkai ada di ${out}`);
  process.exit(1);
}
console.log(
  "\nLulus: vignette menggelapkan tepi tanpa menambah tekstur, butiran menambah tekstur tanpa menggelapkan tepi, vignette lapisan terkurung di kotak lapisannya, dan clock-wipe antar klip menutup bingkai di 16:9, 9:16, dan 1:1.",
);
