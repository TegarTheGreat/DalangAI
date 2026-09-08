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
 *    sudut.
 *
 * Dua tuntutan itu sengaja saling menyilang: efek yang tertukar
 * implementasinya akan lulus salah satunya dan gagal yang lain.
 *
 * Jalankan: pnpm --filter @dalang/templates gate:pengayaan
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const out = mkdtempSync(join(tmpdir(), "dalang-pengayaan-"));

/** Plan satu scene, hanya efeknya yang berbeda. */
const planFor = (id: string, vignette: number, grain: number) => ({
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
    },
  ],
  renderState: {
    narrationAudio: {},
    dubAudio: {},
    clipAssets: {},
    graphicAssets: {},
    layerAssets: {},
    sfxAssets: {},
    trackAssets: {},
    transcripts: {},
  },
});

const VARIAN = [
  { id: "polos", vignette: 0, grain: 0 },
  { id: "vignette", vignette: 0.7, grain: 0 },
  { id: "grain", vignette: 0, grain: 0.8 },
] as const;

for (const varian of VARIAN) {
  const dir = join(out, varian.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "plan.json"),
    `${JSON.stringify(planFor(varian.id, varian.vignette, varian.grain), null, 2)}\n`,
  );
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
    return {"tekstur": tekstur, "rasioSudut": sudut / max(tengah, 0.01)}

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

let ukur: Record<string, { tekstur: number; rasioSudut: number } | null>;
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
    `  ${nama.padEnd(9)} tekstur=${nilai.tekstur.toFixed(3)} rasioSudut=${nilai.rasioSudut.toFixed(3)}`,
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

if (problems.length > 0) {
  console.error("\nGERBANG PENGAYAAN GAGAL:");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(`  bingkai ada di ${out}`);
  process.exit(1);
}
console.log(
  "\nLulus: vignette menggelapkan tepi tanpa menambah tekstur, butiran menambah tekstur tanpa menggelapkan tepi.",
);
