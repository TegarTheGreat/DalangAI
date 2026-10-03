/**
 * Gerbang bunyi ketik (ADR-0043) — bunyinya HARUS jatuh bersama hurufnya.
 *
 * Bunyi ketik yang terpasang tetapi meleset tiga bingkai dari hurufnya tidak
 * menghasilkan galat, tes merah, atau peringatan: ia lolos setiap pemeriksaan
 * struktur dan baru terdengar sebagai keyboard yang tertinggal. Gerbang ini
 * merender VIDEO sungguhan di ketiga preset, lalu mengukur dua hal dari file
 * itu sendiri:
 *
 *  - dari BINGKAI: kapan huruf-huruf tampil (piksel magenta bertambah), dan
 *    bahwa semuanya jatuh di kisi jadwal animasi;
 *  - dari AUDIO: kapan tiap ketukan berbunyi (onset), dan bahwa jaraknya ke
 *    waktu huruf konstan — keterlambatan tetap sekitar 43 ms yang dibawa
 *    penyandian AAC ke SEMUA audio keluaran Dalang diukur dan diperbolehkan,
 *    tetapi simpangan antar-ketukan dibatasi setengah bingkai.
 *
 * Ia juga menangkap kelas cacat yang ditemukan bersamanya: preset `tutorial-01`
 * dulu tidak memutar efek suara APA PUN. Ketukan hanyalah cue yang paling
 * mudah diukur.
 *
 * Kontrol: plan yang sama dengan `sound: "none"` harus SENYAP — supaya yang
 * terdeteksi memang ketukan, bukan musik atau gema.
 *
 * Jalankan: pnpm --filter @dalang/renderer gate:ketik
 */

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RenderInternals } from "@remotion/renderer";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const out = mkdtempSync(join(tmpdir(), "dalang-ketik-"));

const TEKS = "Kebebasan finansial dimulai dari satu keputusan kecil hari ini";
const DURASI = 5;
const FPS = 30;
const MULAI = 0.1;
const AKHIR = 1;

const planFor = (preset: string, bunyi: "ketik" | "none") => {
  const tutorial = preset === "tutorial-01";
  return {
    version: 2,
    projectId: `ketik-${preset}`,
    meta: {
      title: "Uji Ketik",
      aspectRatio: "16:9",
      language: "id",
      stylePreset: preset,
      format: "bebas",
    },
    audio: { voice: { provider: "silence", voiceId: "x", speed: 1 } },
    scenes: [
      {
        id: "sc-a",
        narration: "",
        duration: DURASI,
        caption: { enabled: false, style: "inherit", size: "m", position: "bottom" },
        clips: tutorial
          ? [
              {
                id: "sc-a-k1",
                type: "screenshot",
                assetId: "assets/step-1-brief.png",
                pinned: true,
              },
            ]
          : [{ id: "sc-a-k1", type: "solid", variant: "duotone", motion: "none" }],
        texts: [
          {
            id: "t-1",
            content: TEKS,
            role: "headline",
            position: "center",
            align: "center",
            size: "m",
            emphasis: "none",
            anim: "typewriter",
            sound: bunyi,
            soundVolume: 0.8,
            // Magenta: warna yang tidak ada di latar preset mana pun, jadi
            // piksel magenta = huruf yang sudah tampil.
            color: "#ff00ff",
            stroke: 0,
            startFrac: MULAI,
            endFrac: AKHIR,
          },
        ],
      },
    ],
    renderState: {
      narrationAudio: {},
      dubAudio: {},
      clipAssets: tutorial
        ? {
            "sc-a-k1": {
              file: "assets/step-1-brief.png",
              kind: "image",
              source: "local",
              license: "uji",
              width: 3200,
              height: 1800,
            },
          }
        : {},
      graphicAssets: {},
      layerAssets: {},
      sfxAssets: {},
      trackAssets: {},
      transcripts: {},
    },
  };
};

const callFf = (args: string[]) =>
  RenderInternals.callFf({
    bin: "ffmpeg",
    args: ["-hide_banner", "-loglevel", "error", "-y", ...args],
    indent: false,
    logLevel: "error",
    binariesDirectory: null,
    cancelSignal: undefined,
  });

const siapkan = (nama: string, preset: string, bunyi: "ketik" | "none") => {
  const dir = join(out, nama);
  mkdirSync(dir, { recursive: true });
  if (preset === "tutorial-01") {
    cpSync(join(repoRoot, "examples", "tutorial-studio", "assets"), join(dir, "assets"), {
      recursive: true,
    });
  }
  writeFileSync(
    join(dir, "plan.json"),
    `${JSON.stringify(planFor(preset, bunyi), null, 2)}\n`,
  );
  return dir;
};

const PROBE = `
import glob, json, struct, sys, wave
from PIL import Image

dir_ = sys.argv[1]
frames = sorted(glob.glob(dir_ + "/frames/*.png"))
cnt = []
for f in frames:
    im = Image.open(f).convert("RGB")
    px = im.load()
    w, h = im.size
    c = 0
    for y in range(0, h):
        for x in range(0, w):
            r, g, b = px[x, y]
            if r > 180 and b > 180 and g < 90:
                c += 1
    cnt.append(c)
reveal = [i for i in range(1, len(cnt)) if cnt[i] - cnt[i - 1] >= 12]

w = wave.open(dir_ + "/a.wav")
n = w.getnframes()
sr = w.getframerate()
xs = struct.unpack("<%dh" % n, w.readframes(n))
mx = max((abs(v) for v in xs), default=0)
onsets = []
if mx >= 200:
    thr = 0.30 * mx
    refractory = int(sr * 0.045)
    i = 0
    while i < n:
        if abs(xs[i]) > thr:
            onsets.append(i / sr)
            i += refractory
        else:
            i += 1
print(json.dumps({"frames": len(frames), "reveal": reveal, "onsets": onsets, "max": mx}))
`;

interface Ukur {
  frames: number;
  reveal: number[];
  onsets: number[];
  max: number;
}

const render = async (dir: string): Promise<Ukur> => {
  execFileSync(
    "pnpm",
    [
      "dalang",
      "render",
      join(dir, "plan.json"),
      "--profile",
      "draft",
      "-o",
      join(dir, "out.mp4"),
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );
  rmSync(join(dir, "frames"), { recursive: true, force: true });
  mkdirSync(join(dir, "frames"), { recursive: true });
  await callFf([
    "-i",
    join(dir, "out.mp4"),
    "-vf",
    "scale=480:-1",
    "-fps_mode",
    "passthrough",
    join(dir, "frames", "%04d.png"),
  ]);
  await callFf([
    "-i",
    join(dir, "out.mp4"),
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    join(dir, "a.wav"),
  ]);
  try {
    return JSON.parse(
      execFileSync("python3", ["-c", PROBE, dir], { encoding: "utf8" }),
    ) as Ukur;
  } catch (error) {
    console.error(
      "GERBANG KETIK GAGAL: pengukur tidak bisa dijalankan.\n" +
        "  Pasang dulu: python3 -m pip install pillow\n" +
        `  ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
};

// --- Harapan dari jadwal animasi: persis rumus TextsOverlay -----------------
const nf = DURASI * FPS;
const mulai = Math.round(MULAI * nf);
const akhir = Math.max(mulai + 1, Math.round(AKHIR * nf));
const huruf = Array.from(TEKS);
const KISI = 3; // TYPEWRITER_FRAMES_PER_CHAR
// Teks memudar keluar pada ~10 bingkai terakhir jendelanya; di sana jumlah
// piksel turun dan tidak lagi bicara soal huruf yang muncul.
const AKHIR_MUNCUL = akhir - 12;
const semuaKetukan = huruf
  .map((_, i) => mulai + KISI * i)
  .filter((frame) => frame <= akhir && frame < nf);
const hurufTampil = semuaKetukan.filter(
  (frame, i) => !/\s/.test(huruf[i] ?? "") && frame < AKHIR_MUNCUL,
);

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

const masalah: string[] = [];
const PRESET = ["documentary-01", "klip-01", "tutorial-01"] as const;

console.log("Gerbang ketik — bingkai dan audio dari video jadi:");
for (const preset of PRESET) {
  const dir = siapkan(preset, preset, "ketik");
  const hasil = await render(dir);

  // 1. Bunyi ADA, satu per huruf yang sempat tampil — tidak lebih (huruf yang
  //    jendelanya sudah habis tidak berbunyi) dan tidak kurang.
  const jumlah = hasil.onsets.length;
  if (jumlah !== semuaKetukan.length) {
    masalah.push(
      `${preset}: ${jumlah} ketukan terdengar, seharusnya ${semuaKetukan.length}` +
        (jumlah === 0 ? " — preset ini tidak memutar efek suara sama sekali" : ""),
    );
    console.log(`  ${preset.padEnd(15)} ketukan=${jumlah}/${semuaKetukan.length}`);
    continue;
  }

  // 2. Selisih ketukan terhadap bingkai hurufnya: konstan, dan tidak mendahului.
  const selisihMs = hasil.onsets.map(
    (waktu, i) => (waktu - (semuaKetukan[i] ?? 0) / FPS) * 1000,
  );
  const tengah = median(selisihMs);
  const simpang = Math.max(...selisihMs.map((d) => Math.abs(d - tengah)));
  if (tengah < -10 || tengah > 80) {
    masalah.push(
      `${preset}: ketukan terlambat ${tengah.toFixed(0)} ms dari hurufnya (batas -10..80 ms)`,
    );
  }
  if (simpang > 17) {
    masalah.push(
      `${preset}: simpangan antar-ketukan ${simpang.toFixed(0)} ms (batas 17 ms, setengah bingkai)`,
    );
  }

  // 3. Dari bingkai: huruf hanya tampil di kisi jadwal, dan sebagian besar
  //    huruf tertangkap (huruf tipis seperti "i" bisa lolos dari ambang).
  const kisi = new Set(semuaKetukan);
  const muncul = hasil.reveal.filter((frame) => frame < AKHIR_MUNCUL);
  const liar = muncul.filter((frame) => !kisi.has(frame));
  if (liar.length > 0) {
    masalah.push(
      `${preset}: huruf tampil di bingkai ${liar.slice(0, 5).join(", ")} yang bukan kisi jadwal (${KISI} bingkai)`,
    );
  }
  const tertangkap = hurufTampil.filter((frame) => muncul.includes(frame)).length;
  // Ambang 12 piksel menolak getaran anti-alias (<= 10) tetapi juga melewatkan
  // huruf tipis ("i", "l", tanda baca); terukur 24-34 dari 36, jadi batasnya 60%.
  if (tertangkap < hurufTampil.length * 0.6) {
    masalah.push(
      `${preset}: hanya ${tertangkap} dari ${hurufTampil.length} huruf terlihat muncul di bingkai yang dijadwalkan`,
    );
  }
  if (muncul[0] !== mulai) {
    masalah.push(
      `${preset}: huruf pertama tampil di bingkai ${muncul[0] ?? "(tidak ada)"}, seharusnya ${mulai}`,
    );
  }

  console.log(
    `  ${preset.padEnd(15)} ketukan=${jumlah}/${semuaKetukan.length} ` +
      `terlambat=${tengah.toFixed(0)}ms simpangan=${simpang.toFixed(0)}ms ` +
      `huruf-terlihat=${tertangkap}/${hurufTampil.length}`,
  );
}

// --- Kontrol: tanpa sound, video harus senyap -------------------------------
const kontrol = await render(siapkan("kontrol", "documentary-01", "none"));
console.log(`  ${"kontrol".padEnd(15)} ketukan=${kontrol.onsets.length} (harus 0)`);
if (kontrol.onsets.length > 0 || kontrol.max >= 200) {
  masalah.push(
    `kontrol: sound "none" tetap menghasilkan bunyi (puncak ${kontrol.max}, ${kontrol.onsets.length} onset)`,
  );
}

if (masalah.length > 0) {
  console.error("\nGERBANG KETIK GAGAL:");
  for (const item of masalah) console.error(`  - ${item}`);
  console.error(`  berkas ada di ${out}`);
  process.exit(1);
}
console.log(
  "\nLulus: ketukan jatuh bersama hurufnya di ketiga preset, tidak ada yang berbunyi setelah teksnya hilang, dan tanpa sound videonya senyap.",
);
