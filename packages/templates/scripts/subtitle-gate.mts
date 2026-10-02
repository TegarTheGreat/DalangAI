/**
 * Gerbang subtitle (ADR-0039).
 *
 * Dua klaim di ADR ini tidak bisa dibuktikan tes unit, dan keduanya baru
 * ketahuan SETELAH berkasnya diunggah:
 *
 * 1. **"Berkasnya benar-benar terbaca pemutar lain."** Tes yang membaca ulang
 *    keluaran kita dengan pembaca kita sendiri hanya membuktikan dua berkas
 *    kita saling setuju. Gerbang ini memakai IMPLEMENTASI RUJUKAN — pustaka
 *    `webvtt-py` membaca .vtt maupun .srt kita — persis seperti gerbang
 *    interop memakai OpenTimelineIO resmi.
 *
 * 2. **"Waktunya cocok dengan videonya."** Ini yang paling mahal kalau salah:
 *    teks yang melenceng tetap berupa berkas yang sah, lolos setiap tes
 *    format, dan cacatnya cuma terlihat oleh penonton yang menyalakan teksnya.
 *    Jangkarnya di sini BUKAN modul subtitle, melainkan `activeSceneIndex` —
 *    fungsi yang MEMUTUSKAN scene mana yang tampil di bingkai tertentu saat
 *    merender. Tiap kartu dicocokkan ke scene yang narasinya memuat teksnya,
 *    lalu titik tengah kartu itu harus jatuh di scene yang sama menurut
 *    renderer. Kalau subtitle berpindah ke jam yang salah (jumlah durasi
 *    scene, bukan tata letak render), kartu-kartu belakang mendarat di scene
 *    yang keliru dan gerbang ini merah.
 *
 * Kalau pustaka rujukannya tidak ada, gerbang ini GAGAL — bukan dilewati
 * diam-diam. Gerbang yang bisa no-op adalah gerbang yang tidak pernah terbukti
 * ada.
 *
 * Jalankan: pnpm --filter @dalang/templates gate:subtitle [plan.json]
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeTimeline, parseScenePlan, type ScenePlan } from "@dalang/core";
import { activeSceneIndex, computeFrameLayout, FPS } from "../src/layout";
import { buildSubtitleCues, type SubtitleCue, toSrt, toVtt } from "../src/subtitle";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const demo = process.argv[2]
  ? resolve(repoRoot, process.argv[2])
  : join(repoRoot, "examples", "borobudur-60s", "plan.json");

const plan: ScenePlan = parseScenePlan(JSON.parse(readFileSync(demo, "utf8")));
const out = mkdtempSync(join(tmpdir(), "dalang-subtitle-gate-"));

const probe = `
import json, sys
import webvtt

srt_path, vtt_path = sys.argv[1], sys.argv[2]

# start_in_seconds milik webvtt-py 0.5.1 membulatkan ke DETIK BULAT, jadi
# milidetiknya diambil dari komponen Timestamp yang benar-benar ia parse —
# kalau tidak, gerbang ini buta terhadap selisih di bawah satu detik, yaitu
# justru selisih yang paling sering terjadi.
def ms(t):
    return ((t.hours * 60 + t.minutes) * 60 + t.seconds) * 1000 + t.milliseconds

def dump(caps):
    return [
        {"start": ms(c.start_time), "end": ms(c.end_time), "lines": list(c.lines)}
        for c in caps
    ]

print(json.dumps({
    "srt": dump(webvtt.from_srt(srt_path)),
    "vtt": dump(webvtt.read(vtt_path)),
}))
`;

/** Cap waktu dari pembaca rujukan, dalam MILIDETIK. */
type RefCue = { start: number; end: number; lines: string[] };

const cues: SubtitleCue[] = buildSubtitleCues(plan);
const srtPath = join(out, "uji.srt");
const vttPath = join(out, "uji.vtt");
writeFileSync(srtPath, toSrt(cues));
writeFileSync(vttPath, toVtt(cues));

let baca: { srt: RefCue[]; vtt: RefCue[] };
try {
  const raw = execFileSync("python3", ["-c", probe, srtPath, vttPath], {
    encoding: "utf8",
  });
  baca = JSON.parse(raw) as { srt: RefCue[]; vtt: RefCue[] };
} catch (error) {
  console.error(
    "GERBANG SUBTITLE GAGAL: pembaca rujukan tidak bisa dijalankan.\n" +
      "  Pasang dulu: python3 -m pip install webvtt-py\n" +
      `  ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

const problems: string[] = [];

/** Teks dinormalkan supaya perbandingan tidak tersandung spasi dan baris. */
const rata = (text: string) => text.replace(/\s+/g, " ").trim();

// --- 1. Pembaca rujukan melihat kartu yang SAMA banyaknya dan sama isinya ---
for (const [nama, dibaca] of [
  ["SRT", baca.srt],
  ["VTT", baca.vtt],
] as const) {
  if (dibaca.length !== cues.length) {
    problems.push(
      `${nama}: pembaca rujukan menemukan ${dibaca.length} kartu, kami menulis ${cues.length}`,
    );
    continue;
  }
  dibaca.forEach((ref, i) => {
    const milik = cues[i];
    if (!milik) return;
    if (rata(ref.lines.join(" ")) !== rata(milik.lines.join(" "))) {
      problems.push(
        `${nama} kartu ${i + 1}: teks yang dibaca rujukan berbeda — ` +
          `"${rata(ref.lines.join(" "))}" vs "${rata(milik.lines.join(" "))}"`,
      );
    }
    // Cap waktu ditulis bulat milidetik, jadi cocoknya harus PERSIS.
    if (ref.start !== Math.round(milik.startMs)) {
      problems.push(
        `${nama} kartu ${i + 1}: awal terbaca ${ref.start} ms, kami tulis ${Math.round(milik.startMs)} ms`,
      );
    }
    if (ref.end !== Math.round(milik.endMs)) {
      problems.push(
        `${nama} kartu ${i + 1}: akhir terbaca ${ref.end} ms, kami tulis ${Math.round(milik.endMs)} ms`,
      );
    }
  });
}

// --- 2. Kartu tidak bertindihan dan tidak berdurasi nol ---
baca.srt.forEach((cue, i) => {
  if (cue.end <= cue.start) {
    problems.push(
      `kartu ${i + 1} berdurasi nol atau negatif (${cue.start} -> ${cue.end} ms)`,
    );
  }
  const next = baca.srt[i + 1];
  if (next && next.start < cue.end) {
    problems.push(
      `kartu ${i + 1} bertindihan dengan kartu ${i + 2} (${cue.end} > ${next.start})`,
    );
  }
});

// --- 3. Jam yang dipakai adalah tata letak RENDER, bukan jumlah durasi scene ---
const layout = computeFrameLayout(plan);
const durasiVideo = layout.totalFrames / FPS;
const durasiMateri = computeTimeline(plan).totalSec;
const akhir = (baca.srt[baca.srt.length - 1]?.end ?? 0) / 1000;
if (akhir > durasiVideo + 0.001) {
  problems.push(
    `kartu terakhir berakhir di ${akhir.toFixed(3)} dtk, melewati durasi video ${durasiVideo.toFixed(3)} dtk`,
  );
}

/**
 * Jangkar yang BEBAS dari modul subtitle: scene mana yang tampil di bingkai
 * mana, menurut renderer sendiri.
 */
const sceneRanges: Array<[number, number]> = plan.scenes.map(() => [0, 0]);
for (let frame = 0; frame < layout.totalFrames; frame++) {
  const index = activeSceneIndex(layout, frame);
  const range = sceneRanges[index] as [number, number];
  if (range[1] === 0) range[0] = frame;
  range[1] = frame + 1 - range[0];
}

let tercocok = 0;
baca.srt.forEach((cue, i) => {
  const teks = rata(cue.lines.join(" "));
  // Scene ASAL kartu ini: yang narasinya memuat teksnya. Kalau ada lebih dari
  // satu (narasi kembar), kartunya dilewati — jangkarnya jadi tidak tegas.
  const cocok = plan.scenes
    .map((scene, index) => ({ index, narasi: rata(scene.narration) }))
    .filter((s) => s.narasi.length > 0 && s.narasi.includes(teks));
  if (cocok.length !== 1) return;
  const asal = cocok[0]?.index ?? 0;
  tercocok++;

  const tengahDetik = (cue.start + cue.end) / 2000;
  const tengahFrame = Math.min(
    layout.totalFrames - 1,
    Math.max(0, Math.round(tengahDetik * FPS)),
  );
  const tampil = activeSceneIndex(layout, tengahFrame);
  if (tampil !== asal) {
    const [mulai, panjang] = sceneRanges[asal] as [number, number];
    problems.push(
      `kartu ${i + 1} ("${teks.slice(0, 40)}...") milik scene ${plan.scenes[asal]?.id} ` +
        `(bingkai ${mulai}..${mulai + panjang - 1}), tapi titik tengahnya (bingkai ${tengahFrame}) ` +
        `jatuh di scene ${plan.scenes[tampil]?.id}`,
    );
  }
});

if (tercocok === 0) {
  problems.push(
    "tidak satu pun kartu bisa dicocokkan ke scene asalnya — jangkar waktunya tidak teruji",
  );
}

console.log(`Gerbang subtitle atas ${demo}`);
console.log(
  `  ${cues.length} kartu · video ${durasiVideo.toFixed(2)} dtk · materi ${durasiMateri.toFixed(2)} dtk · ${tercocok} kartu berjangkar`,
);
if (problems.length > 0) {
  console.error("\nGERBANG SUBTITLE GAGAL:");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(`  berkas ada di ${out}`);
  process.exit(1);
}
console.log(
  "Lulus: pembaca rujukan membaca kedua berkas, dan tiap kartu jatuh di scene asalnya.",
);
