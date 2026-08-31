/**
 * Gerbang interop (ADR-0023).
 *
 * Ekspor interchange punya satu klaim yang tidak bisa dibuktikan tes unit:
 * "berkasnya benar-benar bisa dibuka perkakas lain". Tes yang membaca ulang
 * keluaran kita dengan pembaca kita sendiri hanya membuktikan dua berkas kita
 * saling setuju — dan dua-duanya bisa salah dengan cara yang sama.
 *
 * Gerbang ini memakai IMPLEMENTASI RUJUKAN: pustaka OpenTimelineIO resmi
 * (Python) membaca .otio kita, dan adapter fcpx_xml resmi membaca .fcpxml
 * kita. Lalu jumlah klip, durasi total, dan urutannya dibandingkan dengan
 * garis waktu yang kita niatkan.
 *
 * Kalau pustakanya tidak ada, gerbang ini GAGAL — bukan dilewati diam-diam.
 * Gerbang yang bisa no-op adalah gerbang yang tidak pernah terbukti ada.
 *
 * Jalankan: pnpm --filter @dalang/interop gate:interop
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseScenePlan } from "@dalang/core";
import { activeSceneIndex, computeFrameLayout } from "@dalang/templates/layout";
import { toFcpxml } from "../src/fcpxml";
import { otioToJson } from "../src/otio";
import { buildEditTimeline } from "../src/timeline";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const demo = process.argv[2]
  ? resolve(repoRoot, process.argv[2])
  : join(repoRoot, "examples", "borobudur-60s", "plan.json");

const plan = parseScenePlan(JSON.parse(readFileSync(demo, "utf8")));
const timeline = buildEditTimeline(plan, { planPath: demo });
const out = mkdtempSync(join(tmpdir(), "dalang-interop-gate-"));
const otioPath = join(out, "gate.otio");
const fcpxPath = join(out, "gate.fcpxml");
writeFileSync(otioPath, otioToJson(timeline));
writeFileSync(fcpxPath, toFcpxml(timeline));

const videoTrack = timeline.tracks.find((track) => track.kind === "video");
const expectedClips = (videoTrack?.items ?? []).filter(
  (item) => item.kind === "clip",
).length;

/**
 * Pembanding yang BEBAS dari modul yang sedang diuji.
 *
 * Versi pertama gerbang ini membandingkan hasil baca pustaka rujukan dengan
 * angka yang dihitung ulang oleh `buildEditTimeline` — dan itu tautologi:
 * saat titik potongnya digeser satu frame untuk mengujinya, kedua sisi ikut
 * bergeser dan gerbangnya tetap hijau. Sekarang jangkarnya `activeSceneIndex`
 * milik renderer: fungsi yang MEMUTUSKAN scene mana yang tampil di frame
 * tertentu. Kalau ekspor tidak memotong di tempat penonton melihat potongan,
 * pertanyaannya sudah salah sejak awal.
 */
const layout = computeFrameLayout(plan);
const sceneRanges: Array<[number, number]> = plan.scenes.map(() => [0, 0]);
for (let frame = 0; frame < layout.totalFrames; frame++) {
  const index = activeSceneIndex(layout, frame);
  const range = sceneRanges[index] as [number, number];
  if (range[1] === 0) range[0] = frame;
  range[1] = frame + 1 - range[0];
}
/** Rentang yang seharusnya, hanya untuk scene yang punya berkas aset. */
const intended = plan.scenes
  .map((scene, index) => ({ scene, range: sceneRanges[index] as [number, number] }))
  .filter(({ scene }) => plan.renderState.resolvedAssets[scene.id] !== undefined)
  .map(({ range }) => range);
const expectedFrames = layout.totalFrames;

const probe = `
import json, sys
import opentimelineio as otio

otio_path, fcpx_path = sys.argv[1], sys.argv[2]
out = {}

tl = otio.adapters.read_from_file(otio_path)
video = [t for t in tl.tracks if t.kind == otio.schema.TrackKind.Video]
out["otio_video_tracks"] = len(video)
out["otio_clips"] = len([c for c in video[0] if isinstance(c, otio.schema.Clip)]) if video else 0
out["otio_transitions"] = (
    len([c for c in video[0] if isinstance(c, otio.schema.Transition)]) if video else 0
)
out["otio_frames"] = int(round(video[0].duration().value)) if video else 0
out["otio_audio_tracks"] = len(
    [t for t in tl.tracks if t.kind == otio.schema.TrackKind.Audio]
)
out["otio_urls"] = [
    c.media_reference.target_url
    for c in video[0]
    if isinstance(c, otio.schema.Clip) and hasattr(c.media_reference, "target_url")
] if video else []

fx = otio.adapters.read_from_file(fcpx_path, "fcpx_xml")
fx_tl = fx if isinstance(fx, otio.schema.Timeline) else list(
    fx.find_children(descended_from_type=otio.schema.Timeline)
)[0]
fx_clips = list(fx_tl.find_children(descended_from_type=otio.schema.Clip))
out["fcpx_clips"] = len(fx_clips)
out["fcpx_ranges"] = [
    [c.name, int(round(c.trimmed_range_in_parent().start_time.value)),
     int(round(c.trimmed_range_in_parent().duration.value))]
    for c in fx_clips
]
out["otio_ranges"] = [
    [c.name, int(round(c.trimmed_range_in_parent().start_time.value)),
     int(round(c.trimmed_range_in_parent().duration.value))]
    for c in video[0] if isinstance(c, otio.schema.Clip)
] if video else []

print(json.dumps(out))
`;

let report: Record<string, unknown>;
try {
  const stdout = execFileSync("python3", ["-c", probe, otioPath, fcpxPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  report = JSON.parse(stdout) as Record<string, unknown>;
} catch (error) {
  console.error(
    "GERBANG INTEROP GAGAL — implementasi rujukan tidak bisa membaca keluaran kita.",
  );
  console.error(
    "  Pasang dulu kalau belum ada: pip install opentimelineio otio-fcpx-xml-adapter",
  );
  const detail = error instanceof Error ? error.message : String(error);
  const stderr = (error as { stderr?: Buffer | string }).stderr;
  console.error(`  ${stderr ? String(stderr).trim() : detail}`);
  console.error(`  berkas ada di ${out}`);
  process.exit(1);
}

const num = (key: string): number => Number(report[key] ?? -1);
const problems: string[] = [];

if (num("otio_video_tracks") !== 1) {
  problems.push(`trek video di .otio: ${num("otio_video_tracks")}, seharusnya 1`);
}
if (num("otio_clips") !== expectedClips) {
  problems.push(`klip .otio: ${num("otio_clips")}, seharusnya ${expectedClips}`);
}
if (num("otio_frames") !== expectedFrames) {
  problems.push(
    `durasi trek video .otio: ${num("otio_frames")} frame, seharusnya ${expectedFrames}`,
  );
}
if (num("otio_transitions") !== (videoTrack?.transitions.length ?? 0)) {
  problems.push(
    `peralihan .otio: ${num("otio_transitions")}, seharusnya ${videoTrack?.transitions.length}`,
  );
}
// FCPXML sengaja tidak menulis transisi, tapi klipnya harus utuh semua.
if (num("fcpx_clips") < expectedClips) {
  problems.push(`klip .fcpxml terbaca: ${num("fcpx_clips")}, minimal ${expectedClips}`);
}
const urls = Array.isArray(report.otio_urls) ? (report.otio_urls as string[]) : [];
if (urls.some((url) => !url.startsWith("file:///"))) {
  problems.push("ada target_url yang bukan file:// absolut");
}

/**
 * Perbandingan yang paling berharga: POSISI tiap klip menurut pembaca rujukan
 * versus posisi yang kita niatkan. Jumlah klip yang benar tapi offset meleset
 * satu frame adalah cacat yang lolos semua pemeriksaan lain, dan baru
 * ketahuan sebagai "audionya tidak sinkron" setelah dibuka di editor lain.
 */
const compareRanges = (key: string, label: string) => {
  const rows = Array.isArray(report[key])
    ? (report[key] as [string, number, number][])
    : [];
  // FCPXML tidak menyimpan gap di ujung, jadi jumlahnya boleh lebih sedikit;
  // yang TIDAK boleh adalah klip yang ada tapi posisinya berbeda.
  rows.forEach(([name, start, duration], index) => {
    const want = intended[index];
    if (!want) return;
    if (start !== want[0] || duration !== want[1]) {
      problems.push(
        `${label}: klip ${index + 1} (${name}) di ${start}+${duration}, seharusnya ${want[0]}+${want[1]}`,
      );
    }
  });
};
compareRanges("otio_ranges", ".otio");
compareRanges("fcpx_ranges", ".fcpxml");

console.log(`Gerbang interop atas ${demo}`);
console.log(
  `  .otio   ${num("otio_clips")} klip · ${num("otio_transitions")} peralihan · ${num("otio_frames")} frame · ${num("otio_audio_tracks")} trek audio`,
);
console.log(`  .fcpxml ${num("fcpx_clips")} klip terbaca adapter rujukan`);

if (problems.length > 0) {
  console.error("\nGERBANG INTEROP GAGAL:");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(`  berkas ada di ${out}`);
  process.exit(1);
}
console.log("\nLulus: implementasi rujukan membaca kedua berkas dan angkanya cocok.");
