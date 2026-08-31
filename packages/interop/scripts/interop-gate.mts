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
import { fromFcpxml, parseFcpTime } from "../src/from-fcpxml";
import { fromOtio } from "../src/from-otio";
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
const refOtioPath = join(out, "ref.otio");
const refFcpxPath = join(out, "ref.fcpxml");
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

/**
 * Harapan soal LAPISAN (ADR-0025) dihitung dari PLAN, bukan dari `timeline`.
 *
 * Ini pelajaran yang sama dengan versi pertama gerbang ini: harapan yang
 * diturunkan dari modul yang sedang diuji akan ikut berubah saat modulnya
 * rusak, dan gerbangnya tetap hijau. Percobaan nyata: menghapus trek lapisan
 * dari `buildEditTimeline` LULUS ketika harapannya dibaca dari `timeline`, dan
 * langsung gagal setelah dipindah ke sini.
 */
const layersWithAsset = plan.scenes.flatMap((scene, index) =>
  scene.layers
    .filter((layer) => plan.renderState.layerAssets[layer.id] !== undefined)
    .map((layer) => {
      const sceneStart = layout.sceneStarts[index] ?? 0;
      const sceneFrames = layout.sceneFrames[index] ?? 0;
      const from = Math.round(layer.startFrac * sceneFrames);
      const to = Math.round(layer.endFrac * sceneFrames);
      return {
        id: layer.id,
        start: sceneStart + from,
        duration: Math.max(1, to - from),
      };
    }),
);
const expectedLayerClips = layersWithAsset.length;
// Lapisan hidup di trek video TAMBAHAN. Berapa tepatnya bergantung pada
// tumpang-tindih antar lapisan (satu trek per lajur), jadi yang diperiksa
// batasnya: minimal satu trek tambahan kalau ada lapisan, maksimal satu trek
// per lapisan.
const minVideoTracks = 1 + (expectedLayerClips > 0 ? 1 : 0);
const maxVideoTracks = 1 + expectedLayerClips;

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
# Trek video KEDUA dan seterusnya = lapisan (ADR-0025).
out["otio_layer_ranges"] = [
    [c.name, int(round(c.trimmed_range_in_parent().start_time.value)),
     int(round(c.trimmed_range_in_parent().duration.value))]
    for track in video[1:] for c in track if isinstance(c, otio.schema.Clip)
]

# Arah KEDUA: implementasi rujukan MENULIS, pembaca kami yang membaca.
# Berkas yang ditulis pustaka resmi adalah contoh terbaik dari "berkas yang
# datang dari perkakas lain" — dan itu justru kasus yang harus dilayani impor.
ref_otio, ref_fcpx = sys.argv[3], sys.argv[4]
otio.adapters.write_to_file(tl, ref_otio)

# PENULIS fcpx_xml rujukan menuntut available_range ada di tiap klip; ia
# melempar AttributeError kalau None. Kami sengaja menulis None untuk gambar
# diam yang panjang sumbernya tidak diketahui (lihat ADR-0023 butir 4), jadi
# nilainya diisi DI SINI SAJA — semata untuk memperoleh berkas tulisan rujukan
# yang bisa dibaca balik. Ini keterbatasan penulis rujukan, bukan berkas kami:
# PEMBACA rujukan menerima berkas kami apa adanya.
for c in tl.find_children(descended_from_type=otio.schema.Clip):
    mr = c.media_reference
    if getattr(mr, "available_range", "x") is None:
        mr.available_range = otio.opentime.TimeRange(
            otio.opentime.RationalTime(0, c.source_range.duration.rate),
            c.source_range.duration,
        )
otio.adapters.write_to_file(tl, ref_fcpx, "fcpx_xml")
ref = otio.adapters.read_from_file(ref_fcpx, "fcpx_xml")
ref_tl = ref if isinstance(ref, otio.schema.Timeline) else list(
    ref.find_children(descended_from_type=otio.schema.Timeline)
)[0]
ref_video = [t for t in ref_tl.tracks if t.kind == otio.schema.TrackKind.Video]
out["ref_fcpx_durations"] = [
    round(c.trimmed_range_in_parent().duration.value
          / c.trimmed_range_in_parent().duration.rate, 3)
    for c in (ref_video[0] if ref_video else [])
    if isinstance(c, otio.schema.Clip)
]

print(json.dumps(out))
`;

let report: Record<string, unknown>;
try {
  const stdout = execFileSync(
    "python3",
    ["-c", probe, otioPath, fcpxPath, refOtioPath, refFcpxPath],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
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

if (
  num("otio_video_tracks") < minVideoTracks ||
  num("otio_video_tracks") > maxVideoTracks
) {
  problems.push(
    `trek video di .otio: ${num("otio_video_tracks")}, seharusnya ${minVideoTracks}..${maxVideoTracks}`,
  );
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
// Lapisan wajib ikut menyeberang, bukan hilang diam-diam: klip trek utama
// PLUS klip lapisan harus terbaca pustaka rujukan.
if (num("fcpx_clips") < expectedClips + expectedLayerClips) {
  problems.push(
    `klip .fcpxml: ${num("fcpx_clips")}, minimal ${expectedClips} klip utama + ${expectedLayerClips} lapisan`,
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

/**
 * Lapisan: ADA, dan di TEMPATNYA.
 *
 * Jumlah saja tidak cukup. Sisipan yang menyeberang dengan offset meleset
 * setengah transisi terlihat benar di daftar klip dan salah di garis waktu —
 * dan itu justru cacat yang gerbang ini ada untuk menangkapnya. Angka yang
 * dibandingkan berasal dari `computeFrameLayout` milik renderer, bukan dari
 * pengekspor.
 */
const rows = (key: string): [string, number, number][] =>
  Array.isArray(report[key]) ? (report[key] as [string, number, number][]) : [];

// .otio: PERSIS. OTIO menyimpan frame sebagai bilangan bulat, jadi tidak ada
// pembulatan yang bisa disalahkan kalau angkanya meleset.
for (const layer of layersWithAsset) {
  const row = rows("otio_layer_ranges").find(([name]) => name === layer.id);
  if (!row) {
    problems.push(`.otio: lapisan ${layer.id} tidak terbaca pustaka rujukan`);
    continue;
  }
  if (row[1] !== layer.start || row[2] !== layer.duration) {
    problems.push(
      `.otio: lapisan ${layer.id} di ${row[1]}+${row[2]}, seharusnya ${layer.start}+${layer.duration}`,
    );
  }
}

/**
 * .fcpxml lewat adapter rujukan: ADA, dan sejauh satu frame dari tempatnya.
 *
 * Toleransi satu frame itu BUKAN kelonggaran untuk kita — ia menutupi
 * keterbatasan pembacanya, dan itu sudah diperiksa sampai ke barisnya.
 * `otio_fcpx_xml_adapter/fcpx_xml.py` mengubah waktu rasional jadi frame
 * dengan `int(...)` (fungsi `to_rational_time` dan `_number_of_frames`), yaitu
 * PEMOTONGAN, bukan pembulatan. Untuk nilai kita `50900/3000s` pada 30fps
 * Python menghitung `50900/3000*30 = 508.99999999999994`, jadi `int()`
 * menjawab 508 padahal nilainya persis 509 frame. Nilai lain di berkas yang
 * sama (`48800/3000s` -> tepat 488.0) lolos utuh: bedanya semata galat float,
 * bukan bentuk berkasnya.
 *
 * Karena itu ketepatan sisi FCPXML dijaga di tempat lain: `.otio` di atas
 * memeriksanya PERSIS, dan atribut `offset` di berkas kita sendiri dibaca
 * ulang sebagai pecahan bulat di bawah.
 */
for (const layer of layersWithAsset) {
  const row = rows("fcpx_ranges").find(([name]) => name === layer.id);
  if (!row) {
    problems.push(`.fcpxml: lapisan ${layer.id} tidak terbaca adapter rujukan`);
    continue;
  }
  if (Math.abs(row[1] - layer.start) > 1 || Math.abs(row[2] - layer.duration) > 1) {
    problems.push(
      `.fcpxml: lapisan ${layer.id} di ${row[1]}+${row[2]}, seharusnya ${layer.start}+${layer.duration}`,
    );
  }
}

/**
 * Ketepatan penulis FCPXML kita sendiri, tanpa perantara float.
 *
 * `parseFcpTime` mengurai "50900/3000s" sebagai pecahan bulat, jadi
 * perbandingan ini bebas dari galat yang membatasi adapter rujukan. Angka
 * pembandingnya tetap datang dari `computeFrameLayout` milik renderer.
 */
const fcpxText = readFileSync(fcpxPath, "utf8");
for (const layer of layersWithAsset) {
  const match = new RegExp(
    `<asset-clip name="${layer.id}"[^>]*offset="([^"]+)"[^>]*duration="([^"]+)"`,
  ).exec(fcpxText);
  if (!match) {
    problems.push(`.fcpxml: elemen lapisan ${layer.id} tidak ada di berkas kita`);
    continue;
  }
  const offsetFrames = Math.round((parseFcpTime(match[1]) ?? -1) * timeline.fps);
  const durationFrames = Math.round((parseFcpTime(match[2]) ?? -1) * timeline.fps);
  if (offsetFrames !== layer.start || durationFrames !== layer.duration) {
    problems.push(
      `.fcpxml (teks): lapisan ${layer.id} di ${offsetFrames}+${durationFrames}, seharusnya ${layer.start}+${layer.duration}`,
    );
  }
}

/**
 * Arah kedua: berkas yang DITULIS implementasi rujukan dibaca pembaca kami.
 *
 * Pengujian impor dengan berkas yang kita tulis sendiri hanya membuktikan dua
 * modul kita saling setuju. Berkas dari pustaka resmi adalah contoh nyata
 * "berkas yang datang dari perkakas lain" — persis kasus yang impor ada untuk
 * melayaninya.
 */
const bacaBalik = (): void => {
  const refDurations = Array.isArray(report.ref_fcpx_durations)
    ? (report.ref_fcpx_durations as number[])
    : [];
  try {
    const dariOtio = fromOtio(JSON.parse(readFileSync(refOtioPath, "utf8")), {
      projectDir: out,
    });
    if (dariOtio.plan.scenes.length !== expectedClips) {
      problems.push(
        `impor .otio tulisan rujukan: ${dariOtio.plan.scenes.length} scene, seharusnya ${expectedClips}`,
      );
    }
  } catch (error) {
    problems.push(
      `impor .otio tulisan rujukan gagal: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    const dariFcpx = fromFcpxml(readFileSync(refFcpxPath, "utf8"), { projectDir: out });
    const durations = dariFcpx.plan.scenes.map((scene) => Number(scene.duration));
    if (durations.length !== refDurations.length) {
      problems.push(
        `impor .fcpxml tulisan rujukan: ${durations.length} scene, rujukan membaca ${refDurations.length}`,
      );
    } else {
      durations.forEach((duration, index) => {
        // Toleransi satu frame: rujukan dan kami membulatkan pecahan rasional
        // di tempat yang sedikit berbeda, dan menuntut kesamaan bit adalah
        // menuntut hal yang bukan inti persoalannya.
        if (Math.abs(duration - (refDurations[index] as number)) > 1 / timeline.fps) {
          problems.push(
            `impor .fcpxml scene ${index + 1}: ${duration}s, rujukan membaca ${refDurations[index]}s`,
          );
        }
      });
    }
  } catch (error) {
    problems.push(
      `impor .fcpxml tulisan rujukan gagal: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};
bacaBalik();

console.log(`Gerbang interop atas ${demo}`);
console.log(
  `  .otio   ${num("otio_clips")} klip · ${num("otio_transitions")} peralihan · ${num("otio_frames")} frame · ${num("otio_audio_tracks")} trek audio`,
);
console.log(`  .fcpxml ${num("fcpx_clips")} klip terbaca adapter rujukan`);
console.log(
  `  balik   pembaca kami atas berkas tulisan rujukan: ${(report.ref_fcpx_durations as number[] | undefined)?.length ?? 0} klip fcpxml`,
);

if (problems.length > 0) {
  console.error("\nGERBANG INTEROP GAGAL:");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(`  berkas ada di ${out}`);
  process.exit(1);
}
console.log("\nLulus: implementasi rujukan membaca kedua berkas dan angkanya cocok.");
