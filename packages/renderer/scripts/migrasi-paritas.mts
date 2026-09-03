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
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseScenePlan } from "@dalang/core";
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

    const berkasV1 = await render(jalurV1, "v1");
    const berkasV2 = await render(jalurV2, "v2");

    if (berkasV1.length !== berkasV2.length) {
      console.error(
        `GAGAL: jumlah frame berbeda (${berkasV1.length} vs ${berkasV2.length}).`,
      );
      process.exitCode = 1;
      return;
    }

    let beda = 0;
    for (const [index, fileV1] of berkasV1.entries()) {
      const fileV2 = berkasV2[index] as string;
      const a = sha256(fileV1);
      const b = sha256(fileV2);
      const cocok = a === b;
      if (!cocok) beda++;
      console.log(
        `  frame ${frames[index]}: ${cocok ? "identik" : "BERBEDA"} ` +
          `v1=${a.slice(0, 12)} v2=${b.slice(0, 12)}`,
      );
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
      `Paritas migrasi OK: ${berkasV1.length} frame identik byte per byte (${argPath}).`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

await main();
