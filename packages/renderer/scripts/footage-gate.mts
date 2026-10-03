/**
 * Gerbang rekaman (footage) — rekaman HARUS memenuhi bingkai.
 *
 * Latar belakang. <Video> dari @remotion/media menimpa `style.objectFit` dengan
 * prop `objectFit`-nya sendiri, dan saat render prop yang kosong jatuh ke
 * "contain". Akibatnya rekaman landscape di bingkai 9:16 tampil sebagai pita
 * kecil di tengah dengan warna latar di atas-bawahnya. Cacat itu tidak
 * menghasilkan galat apa pun dan tidak tertangkap oleh gerbang lain, sebab tak
 * satu pun dari mereka merender VIDEO SUNGGUHAN pada rasio yang berbeda dari
 * rekamannya.
 *
 * Gerbang ini membuat dua rekaman sintetis berwarna polos (merah untuk visual
 * dasar, hijau untuk lapisan), merender bingkai 9:16, lalu MENGUKUR piksel:
 *
 *  - sudut-sudut bingkai harus berwarna rekaman dasar, bukan warna latar;
 *  - bagian atas kotak lapisan (fit "cover") harus berwarna rekaman lapisan,
 *    bukan rekaman dasar yang mengintip dari pita "contain".
 *
 * Diuji dengan disabotase: mengembalikan `objectFit` ke `style` membuatnya merah.
 *
 * Jalankan: pnpm --filter @dalang/renderer gate:footage
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RenderInternals } from "@remotion/renderer";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const out = mkdtempSync(join(tmpdir(), "dalang-footage-"));

/**
 * Rekaman polos dari satu PNG yang diulang. Build ffmpeg ramping milik Remotion
 * tidak membawa sumber lavfi `color`, tapi membaca PNG dan menyandi x264.
 */
const buatKlip = async (berkas: string, rgb: [number, number, number]): Promise<void> => {
  const png = berkas.replace(/\.mp4$/, ".png");
  execFileSync(
    "python3",
    [
      "-c",
      "import sys\nfrom PIL import Image\n" +
        "Image.new('RGB',(1280,720),tuple(int(v) for v in sys.argv[2:5])).save(sys.argv[1])",
      png,
      ...rgb.map(String),
    ],
    { stdio: "inherit" },
  );
  await RenderInternals.callFf({
    bin: "ffmpeg",
    args: [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-loop",
      "1",
      "-framerate",
      "30",
      "-i",
      png,
      "-t",
      "2",
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "libx264",
      berkas,
    ],
    indent: false,
    logLevel: "error",
    binariesDirectory: null,
    cancelSignal: undefined,
  });
};

const asetVideo = (file: string) => ({
  file,
  kind: "video",
  source: "local",
  license: "sintetis (gerbang rekaman)",
  width: 1280,
  height: 720,
  durationSec: 2,
  codec: "h264",
  fps: 30,
});

const planFor = (preset: string, denganLapisan: boolean) => ({
  version: 2,
  projectId: `rekaman-${preset}`,
  meta: {
    title: "Uji Rekaman",
    aspectRatio: "9:16",
    language: "id",
    stylePreset: preset,
    format: "bebas",
    // Warna latar yang JELAS berbeda dari merah dan hijau: kalau rekaman tidak
    // memenuhi bingkai, pitanya tampak sebagai biru, bukan sebagai kebetulan.
    tokens: { accent: "#ffd60a", primary: "#0000ff" },
  },
  audio: {},
  scenes: [
    {
      id: "sc-a",
      narration: "",
      duration: 2,
      caption: { enabled: false, style: "inherit", size: "m", position: "bottom" },
      clips: [
        {
          id: "sc-a-k1",
          type: "image",
          assetId: "assets/merah.mp4",
          pinned: true,
          motion: "none",
        },
      ],
      ...(denganLapisan
        ? {
            layers: [
              {
                id: "lap-1",
                visual: { type: "image", assetId: "assets/hijau.mp4" },
                anchor: "tengah",
                width: 0.6,
                height: 0.4,
                radius: 0,
                border: 0,
                fit: "cover",
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
    clipAssets: { "sc-a-k1": asetVideo("assets/merah.mp4") },
    graphicAssets: {},
    layerAssets: denganLapisan ? { "lap-1": asetVideo("assets/hijau.mp4") } : {},
    sfxAssets: {},
    trackAssets: {},
    transcripts: {},
  },
});

const PROBE = `
import json, sys
from pathlib import Path
from PIL import Image

def px(im, x, y):
    return im.getpixel((x, y))[:3]

hasil = {}
for nama in sys.argv[1:]:
    png = sorted(Path(nama).glob("*.png"))
    if not png:
        hasil[Path(nama).name] = None
        continue
    im = Image.open(png[0]).convert("RGB")
    w, h = im.size
    m = 6
    hasil[Path(nama).name] = {
        "ukuran": [w, h],
        "sudut": [px(im, m, m), px(im, w - m - 1, m), px(im, m, h - m - 1), px(im, w - m - 1, h - m - 1)],
        # Tepat di bawah tepi atas kotak lapisan (tinggi 40%, di tengah).
        "atasKotak": px(im, w // 2, int(h * 0.30) + m),
        "bawahKotak": px(im, w // 2, int(h * 0.70) - m),
    }
print(json.dumps(hasil))
`;

const VARIAN = [
  { id: "documentary-01", preset: "documentary-01", lapisan: true },
  { id: "klip-01", preset: "klip-01", lapisan: true },
] as const;

await (async () => {
  for (const varian of VARIAN) {
    const dir = join(out, varian.id);
    mkdirSync(join(dir, "assets"), { recursive: true });
    await buatKlip(join(dir, "assets", "merah.mp4"), [255, 0, 0]);
    await buatKlip(join(dir, "assets", "hijau.mp4"), [0, 255, 0]);
    writeFileSync(
      join(dir, "plan.json"),
      `${JSON.stringify(planFor(varian.preset, varian.lapisan), null, 2)}\n`,
    );
    execFileSync(
      "pnpm",
      ["dalang", "still", join(dir, "plan.json"), "-t", "1", "-s", "0.5", "-o", dir],
      { cwd: repoRoot, stdio: "inherit" },
    );
  }
})();

let ukur: Record<
  string,
  {
    ukuran: [number, number];
    sudut: Array<[number, number, number]>;
    atasKotak: [number, number, number];
    bawahKotak: [number, number, number];
  } | null
>;
try {
  ukur = JSON.parse(
    execFileSync("python3", ["-c", PROBE, ...VARIAN.map((v) => join(out, v.id))], {
      encoding: "utf8",
    }),
  );
} catch (error) {
  console.error(
    "GERBANG REKAMAN GAGAL: pengukur bingkai tidak bisa dijalankan.\n" +
      "  Pasang dulu: python3 -m pip install pillow\n" +
      `  ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

type Rgb = [number, number, number];
/**
 * Dominasi warna, bukan kecerahan: documentary-01 menggelapkan sudut dengan
 * gradien keterbacaan dan vignette, jadi sudut yang sah bisa berupa merah tua.
 * Yang dicari adalah SIAPA yang mengisi piksel itu — rekaman (merah) atau warna
 * latar (biru) — dan itu terbaca dari kanal yang dominan.
 */
const dominan = ([r, g, b]: Rgb, kanal: 0 | 1 | 2): boolean => {
  const v = [r, g, b];
  const ini = v[kanal] ?? 0;
  const lain = Math.max(...v.filter((_, i) => i !== kanal));
  return ini >= 40 && ini > lain * 2.5;
};
const merah = (c: Rgb) => dominan(c, 0);
const hijau = (c: Rgb) => dominan(c, 1);
const rgb = (c: Rgb) => `rgb(${c.join(",")})`;

const masalah: string[] = [];
console.log("Gerbang rekaman — piksel bingkai 9:16 dari rekaman 16:9:");
for (const varian of VARIAN) {
  const hasil = ukur[varian.id];
  if (!hasil) {
    masalah.push(`${varian.id}: bingkai tidak ter-render`);
    continue;
  }
  console.log(
    `  ${varian.id.padEnd(15)} sudut=${hasil.sudut.map(rgb).join(" ")} atasKotak=${rgb(hasil.atasKotak)}`,
  );
  const salah = hasil.sudut.filter((c) => !merah(c));
  if (salah.length > 0) {
    masalah.push(
      `${varian.id}: ${salah.length} dari 4 sudut bingkai BUKAN warna rekaman (${salah.map(rgb).join(", ")}) — rekaman tidak memenuhi bingkai (objectFit jatuh ke "contain")`,
    );
  }
  if (varian.lapisan && !hijau(hasil.atasKotak)) {
    masalah.push(
      `${varian.id}: bagian atas kotak lapisan bukan warna rekaman lapisan (${rgb(hasil.atasKotak)}) — layer.fit "cover" diabaikan untuk video`,
    );
  }
}

if (masalah.length > 0) {
  console.error("\nGERBANG REKAMAN GAGAL:");
  for (const item of masalah) console.error(`  - ${item}`);
  console.error(`  bingkai ada di ${out}`);
  process.exit(1);
}
console.log(
  "\nLulus: rekaman landscape memenuhi bingkai 9:16, dan lapisan video menghormati fit.",
);
