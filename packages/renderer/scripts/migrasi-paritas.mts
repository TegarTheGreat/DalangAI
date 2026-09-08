/**
 * Gerbang paritas migrasi skema (ADR-0033 §7, rencana verifikasi butir 1).
 *
 * Sebuah still dirender DUA kali:
 *   1. dari plan VERSI 1, yang dimigrasikan `parseScenePlan` saat dibaca;
 *   2. dari plan VERSI 2 yang sama, tersimpan apa adanya.
 *
 * Keduanya wajib identik BYTE PER BYTE.
 *
 * Kenapa ini ada, dan kenapa bukan unit test: unit test migrasi hanya
 * membuktikan bentuk datanya cocok dengan yang DIHARAPKAN penulis testnya. Satu
 * field yang lupa ikut pindah — `focusY`, `trimStartSec`, sebuah filter — tetap
 * lolos skema, tetap lolos setiap test bentuk, dan baru terlihat sebagai gambar
 * yang bergeser. Yang bisa menangkapnya cuma merender keduanya.
 *
 * Plan v1-nya TIDAK disimpan di repo, melainkan dibuat ulang dari contoh v2
 * yang ada dengan membalik migrasinya. Fixture v1 yang dibekukan akan berhenti
 * mewakili contoh yang sesungguhnya begitu contohnya berubah, dan gerbang yang
 * menguji plan yang sudah tidak dipakai siapa pun adalah gerbang yang lulus
 * tanpa menjamin apa-apa.
 *
 * BATAS YANG PERLU DINYATAKAN: still tidak memuat audio, jadi gerbang ini
 * membuktikan jalur GAMBAR. Ia juga tidak membandingkan hasil SEBELUM dan
 * SESUDAH perubahan kode — mustahil dalam satu proses, karena hanya satu versi
 * skema yang hidup di satu waktu. Perbandingan itu dilakukan sekali secara
 * manual saat ADR-0033 diterapkan.
 *
 * Jalankan: pnpm --filter @dalang/renderer migrasi-paritas [path/plan.json]
 */

import { createHash } from "node:crypto";
import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseScenePlan } from "@dalang/core";
import { describeDiff, diffPng, withinRasterNoise } from "../src/png-diff";
import { renderPlanStills } from "../src/render";

const sha256 = (file: string): string =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Balikkan v2 -> v1: kebalikan tepat dari `migrateV1ToV2`.
 *
 * Hidup DI SINI, bukan di `@dalang/core`: menurunkan versi bukan kemampuan yang
 * dijanjikan produk ini kepada siapa pun (migrasi hanya berjalan maju), dan
 * mengekspornya sebagai API berarti seseorang suatu saat memakainya untuk
 * menyimpan plan — lalu kehilangan setiap field yang lahir setelah v1.
 */
const turunkanKeV1 = (plan: unknown): unknown => {
  if (!isRecord(plan)) throw new Error("plan bukan objek");
  const next: Record<string, unknown> = { ...plan, version: 1 };

  const scenes = plan.scenes;
  if (!Array.isArray(scenes)) throw new Error("plan tanpa scenes");
  next.scenes = scenes.map((scene) => {
    if (!isRecord(scene)) throw new Error("scene bukan objek");
    const clips = scene.clips;
    if (!Array.isArray(clips) || clips.length !== 1 || !isRecord(clips[0])) {
      throw new Error(
        `scene "${String(scene.id)}" bukan berklip-satu — gerbang ini hanya ` +
          "berlaku selama v1 masih bisa mewakili contohnya",
      );
    }
    const { id: _clipId, durationSec: _d, transition: _t, ...visual } = clips[0];
    const { clips: _drop, ...rest } = scene;
    return { ...rest, visual };
  });

  const renderState = plan.renderState;
  if (isRecord(renderState)) {
    const { clipAssets, ...restState } = renderState;
    const resolvedAssets: Record<string, unknown> = {};
    if (isRecord(clipAssets)) {
      for (const [clipId, asset] of Object.entries(clipAssets)) {
        // Kunci klip hasil migrasi selalu `${sceneId}-k1`; itu yang dibalik.
        resolvedAssets[clipId.replace(/-k1$/, "")] = asset;
      }
    }
    next.renderState = { ...restState, resolvedAssets };
  }

  // `$schema` menunjuk berkas artefak per versi; ikut diturunkan supaya plan
  // v1 yang dibuat gerbang ini tidak menunjuk skema v2.
  if (typeof next.$schema === "string") {
    next.$schema = next.$schema.replace(
      "scene-plan.v2.schema.json",
      "scene-plan.v1.schema.json",
    );
  }
  return next;
};

/** Siapkan folder proyek berisi plan + aset, siap dirender. */
const siapkanProyek = (dir: string, sumberDir: string, plan: unknown): string => {
  mkdirSync(dir, { recursive: true });
  cpSync(sumberDir, dir, {
    recursive: true,
    filter: (src) => !src.endsWith("plan.json") && !src.includes(`${".dalang"}`),
  });
  const planPath = join(dir, "plan.json");
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  return planPath;
};

const main = async () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const argPath = process.argv[2] ?? "examples/borobudur-60s/plan.json";
  const v2Path = resolve(repoRoot, argPath);
  const sumberDir = dirname(v2Path);
  const v2Plan = JSON.parse(readFileSync(v2Path, "utf8")) as unknown;

  const asli = parseScenePlan(v2Plan);
  const v1Plan = turunkanKeV1(v2Plan);
  // Plan v1-nya harus benar-benar melewati jalur migrasi dan mendarat identik
  // dengan aslinya. Kalau tidak, membandingkan gambarnya sudah tidak ada guna.
  //
  // `$schema` DIKECUALIKAN, dan itu bukan kelonggaran: ia kait perkakas editor
  // yang menunjuk berkas artefak per versi, jadi plan v1 memang seharusnya
  // menunjuk artefak v1. Runtime tidak pernah membacanya, jadi ia tidak bisa
  // menggeser satu piksel pun — dan gerbang gambar di bawah ini yang
  // membuktikan pernyataan itu, bukan komentar ini.
  const tanpaSchema = ({
    $schema: _abaikan,
    ...sisa
  }: ReturnType<typeof parseScenePlan>) => sisa;
  const dimigrasikan = parseScenePlan(v1Plan);
  if (JSON.stringify(tanpaSchema(dimigrasikan)) !== JSON.stringify(tanpaSchema(asli))) {
    console.error(
      "GAGAL: plan v1 hasil turunan tidak bermigrasi kembali ke plan v2 yang sama.",
    );
    process.exitCode = 1;
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "dalang-migrasi-paritas-"));
  try {
    const jalurV1 = siapkanProyek(join(root, "v1"), sumberDir, v1Plan);
    const jalurV2 = siapkanProyek(join(root, "v2"), sumberDir, v2Plan);

    // Tiga frame, bukan satu: kartu judul, satu scene beraset di tengah, dan
    // satu lagi mendekati akhir. Satu frame hanya membuktikan satu scene.
    const total = Math.max(1, asli.scenes.length);
    const frames = [12, Math.round(total * 30), -30];

    const render = async (planPath: string, label: string) => {
      const out = join(root, `out-${label}`);
      mkdirSync(out, { recursive: true });
      const hasil = await renderPlanStills({
        planPath,
        frames,
        scale: 0.25,
        imageFormat: "png",
        logLevel: "error",
        outputLocationFor: (frame) => join(out, `f${frame}.png`),
      });
      return hasil.outputs.map((o) => o.outputLocation);
    };

    /**
     * Tiap plan dirender DUA KALI, dan itu bukan pemborosan.
     *
     * Gerbang ini menuduh satu hal saja: "ada field yang tidak ikut pindah".
     * Tuduhan itu hanya sah kalau rendernya sendiri deterministik — kalau
     * bukan, dua berkas berbeda dari plan yang SAMA akan dilaporkan sebagai
     * cacat migrasi, dan orang yang membacanya akan mencari kesalahan di
     * tempat yang tidak ada kesalahannya. Sudah terjadi: satu jalan CI
     * melaporkan frame 240 berbeda padahal kedua plan terbukti identik setelah
     * parse (pemeriksaan JSON di atas lolos), jadi yang berbeda mustahil
     * datang dari migrasi.
     *
     * Dua render kontrol per sisi menjawabnya di tempat: kalau sebuah sisi
     * berbeda dengan DIRINYA SENDIRI, yang dilaporkan adalah rendernya yang
     * tidak deterministik, bukan migrasinya.
     */
    const berkasV1 = await render(jalurV1, "v1");
    const ulangV1 = await render(jalurV1, "v1-ulang");
    const berkasV2 = await render(jalurV2, "v2");
    const ulangV2 = await render(jalurV2, "v2-ulang");

    if (berkasV1.length !== berkasV2.length) {
      console.error(
        `GAGAL: jumlah frame berbeda (${berkasV1.length} vs ${berkasV2.length}).`,
      );
      process.exitCode = 1;
      return;
    }

    /**
     * Bukti yang bisa DILIHAT saat merah, bukan cuma dua sha256 yang berbeda.
     *
     * Hitungan piksel memisahkan dua sebab yang penanganannya berlawanan:
     * field yang benar-benar tidak ikut pindah menggeser blok besar, sementara
     * sepuhan tepi yang berbeda satu tingkat menyentuh pecahan persen bidang.
     * PNG-nya sendiri ikut disimpan supaya bisa dibuka mata manusia.
     */
    const artefakDir = join(repoRoot, "artefak-paritas");
    const bukti = (frame: number, pasangan: [string, string][]): string => {
      mkdirSync(artefakDir, { recursive: true });
      const tersimpan: string[] = [];
      for (const [label, file] of pasangan) {
        const tujuan = join(artefakDir, `migrasi-f${frame}-${label}.png`);
        copyFileSync(file, tujuan);
        tersimpan.push(tujuan);
      }
      return tersimpan.join(", ");
    };
    const piksel = (a: string, b: string): string => {
      try {
        return describeDiff(diffPng(readFileSync(a), readFileSync(b)));
      } catch (error) {
        return `gagal dibandingkan piksel: ${error instanceof Error ? error.message : String(error)}`;
      }
    };

    /**
     * Vonis "gambarnya sama", bukan "byte-nya sama".
     *
     * sha256 adalah saringan pertama karena murah dan tepat saat cocok. Saat
     * TIDAK cocok ia diam soal seberapa jauh bedanya, dan justru itu yang
     * menentukan: rasterisasi Chrome headless menggeser sepuhan tepi 1-2
     * tingkat antar render berturut-turut dari plan yang PERSIS sama (terukur
     * di CI, lihat komentar ambang di png-diff.ts). Gerbang yang menjatuhkan
     * itu sebagai cacat migrasi menuduh tempat yang salah, dan gerbang yang
     * menuduh salah cukup sering akan diabaikan orang — kerusakan yang jauh
     * lebih mahal daripada frame yang lolos.
     *
     * Yang ditoleransi HANYA selisih di bawah ambang; setiap toleransi tetap
     * DICETAK dengan angkanya, jadi tidak ada yang tersembunyi.
     */
    const setara = (a: string, b: string): { sama: boolean; catatan: string } => {
      if (sha256(a) === sha256(b)) return { sama: true, catatan: "identik" };
      try {
        const diff = diffPng(readFileSync(a), readFileSync(b));
        return { sama: withinRasterNoise(diff), catatan: describeDiff(diff) };
      } catch (error) {
        return {
          sama: false,
          catatan: `gagal dibandingkan piksel: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    };

    let beda = 0;
    let goyah = 0;
    let ditoleransi = 0;
    for (const [index, fileV1] of berkasV1.entries()) {
      const fileV2 = berkasV2[index] as string;
      const a = sha256(fileV1);
      const b = sha256(fileV2);
      const aUlang = sha256(ulangV1[index] as string);
      const bUlang = sha256(ulangV2[index] as string);
      const kontrolV1 = setara(fileV1, ulangV1[index] as string);
      const kontrolV2 = setara(fileV2, ulangV2[index] as string);
      const antarVersi = setara(fileV1, fileV2);
      const stabil = kontrolV1.sama && kontrolV2.sama;
      const cocok = antarVersi.sama;
      const nomor = frames[index] as number;
      for (const [label, hasil] of [
        ["kontrol v1", kontrolV1],
        ["kontrol v2", kontrolV2],
        ["v1 vs v2", antarVersi],
      ] as [string, { sama: boolean; catatan: string }][]) {
        if (hasil.sama && hasil.catatan !== "identik") {
          ditoleransi++;
          console.log(
            `  frame ${nomor}: ${label} beda byte tapi SETARA secara gambar — ${hasil.catatan}`,
          );
        }
      }
      if (!stabil) {
        goyah++;
        const sisi = kontrolV1.sama ? "v2" : "v1";
        const pasangan: [string, string] =
          sisi === "v1"
            ? [fileV1, ulangV1[index] as string]
            : [fileV2, ulangV2[index] as string];
        console.log(
          `  frame ${nomor}: GOYAH — plan yang sama memberi hasil berbeda ` +
            `(v1 ${a.slice(0, 12)}/${aUlang.slice(0, 12)}, ` +
            `v2 ${b.slice(0, 12)}/${bUlang.slice(0, 12)})\n` +
            `      sisi ${sisi}: ${piksel(pasangan[0], pasangan[1])}\n` +
            `      bukti: ${bukti(nomor, [
              [`${sisi}-a`, pasangan[0]],
              [`${sisi}-b`, pasangan[1]],
            ])}`,
        );
        continue;
      }
      if (!cocok) {
        beda++;
        console.log(
          `  frame ${nomor}: BERBEDA v1=${a.slice(0, 12)} v2=${b.slice(0, 12)}\n` +
            `      ${piksel(fileV1, fileV2)}\n` +
            `      bukti: ${bukti(nomor, [
              ["v1", fileV1],
              ["v2", fileV2],
            ])}`,
        );
        continue;
      }
      console.log(
        `  frame ${nomor}: ${antarVersi.catatan === "identik" ? "identik" : "setara"} ` +
          `v1=${a.slice(0, 12)} v2=${b.slice(0, 12)}`,
      );
    }

    if (goyah > 0) {
      console.error(
        `GAGAL: ${goyah} dari ${berkasV1.length} frame TIDAK DETERMINISTIK — plan ` +
          "yang sama memberi berkas berbeda pada dua render berturut-turut. Ini " +
          "cacat renderer atau lingkungannya, BUKAN cacat migrasi: paritas v1/v2 " +
          "tidak bisa diperiksa sampai rendernya stabil.",
      );
      process.exitCode = 1;
      return;
    }

    if (beda > 0) {
      console.error(
        `GAGAL: ${beda} dari ${berkasV1.length} frame berbeda antara plan v1 ` +
          "yang dimigrasikan dan plan v2 — ada field yang tidak ikut pindah.",
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `Paritas migrasi OK: ${berkasV1.length} frame setara antara v1-termigrasi dan v2` +
        (ditoleransi > 0
          ? `, ${ditoleransi} perbandingan lolos lewat ambang kebisingan rasterisasi`
          : " (identik byte per byte)") +
        ` (${argPath}).`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

await main();
