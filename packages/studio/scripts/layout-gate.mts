/**
 * Gerbang tata letak studio.
 *
 * Header editor punya sebelas kontrol, tiga chip, dan sakelar rasio dalam satu
 * baris. Selama berbulan-bulan ia BERTUMPUK SENDIRI di setiap lebar laptop
 * 1440px ke bawah — label "Properti" digambar di atas "9:16" — dan tidak ada
 * satu tes pun yang gagal karenanya, karena tumpang tindih bukan galat: DOM-nya
 * benar, komponennya ter-render, semua tesnya hijau. Yang salah hanya kotak
 * geometrinya, dan itu cuma terlihat kalau ada yang benar-benar mengukur.
 *
 * Skrip ini yang mengukur. Untuk setiap lebar layar yang ditargetkan, ia
 * memeriksa empat hal:
 *
 *   1. tidak ada dua kontrol header yang kotaknya saling menindih;
 *   2. tidak ada kontrol header yang tergunting habis oleh overflow (kecuali
 *      di wadah yang memang bisa digulir) — kemampuan yang hilang tanpa jejak
 *      sama buruknya dengan yang tertindih;
 *   3. tidak ada tab properti yang terpotong di wadah yang TIDAK bisa digulir;
 *   4. halaman tidak bisa digeser ke samping sama sekali (cangkang aplikasi
 *      menggulir di dalam panel, bukan mendorong dokumen).
 *
 * Browsernya adalah Chromium yang SUDAH dipakai render smoke test (lewat
 * findBrowserExecutable milik paket renderer) — CI tidak mengunduh peramban
 * kedua.
 *
 * Jalankan: pnpm --filter @dalang/studio gate:layout
 */

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findBrowserExecutable } from "@dalang/renderer";
import { openBrowser } from "@remotion/renderer";
import { startStudioServer } from "../src/server/index";
import { stubDeps } from "./stub-deps";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEMO = process.argv[2]
  ? resolve(repoRoot, process.argv[2])
  : join(repoRoot, "examples", "borobudur-60s");

/** Lebar nyata: ponsel, tablet, laptop 13"/14"/16", dan monitor lebar. */
const WIDTHS = [
  1920, 1600, 1440, 1366, 1280, 1200, 1100, 1024, 960, 900, 820, 768, 600, 420, 380,
];

interface Report {
  overlaps: string[];
  clippedTools: string[];
  clippedTabs: string[];
  sideScroll: number;
}

/**
 * Kode pengukur dibaca dari berkas .js tersendiri (measure-layout.js), bukan
 * ditulis di sini sebagai fungsi atau template literal — dua bentuk itu
 * masing-masing pernah merusaknya diam-diam; alasannya ada di berkas itu.
 */
const MEASURE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "measure-layout.js"),
  "utf8",
);

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

const main = async (): Promise<void> => {
  if (!existsSync(join(DEMO, "plan.json"))) {
    throw new Error(`Proyek contoh tidak ditemukan: ${DEMO}`);
  }
  if (!existsSync(join(repoRoot, "packages", "studio", "dist", "index.html"))) {
    throw new Error(
      "App studio belum ter-build — jalankan dulu: pnpm --filter @dalang/studio build",
    );
  }

  // Salin ke folder sementara: gerbang ini membuka sesi yang MENULIS
  // (.dalang/pipeline.db), dan proyek contoh di repo harus tetap bersih.
  const root = mkdtempSync(join(tmpdir(), "dalang-gate-layout-"));
  cpSync(DEMO, join(root, "demo"), { recursive: true });

  const studio = await startStudioServer({
    workspaceRoot: root,
    planPath: join(root, "demo", "plan.json"),
    deps: stubDeps(),
    port: 0,
    appDistDir: join(repoRoot, "packages", "studio", "dist"),
  });

  // Chromium yang SAMA dengan render smoke test — deteksi milik paket
  // renderer, jadi CI tidak mengunduh peramban kedua.
  const browser = await openBrowser("chrome", {
    logLevel: "error",
    browserExecutable: findBrowserExecutable() ?? null,
  });
  const page = await browser.newPage({
    context: () => null,
    logLevel: "error",
    indent: false,
    pageIndex: 0,
    onBrowserLog: null,
    onLog: () => undefined,
  });

  const failures: string[] = [];
  try {
    await page.goto({ url: studio.url, timeout: 30_000 });
    // Tunggu cangkang editor benar-benar ada isinya (timeline butuh plan).
    for (let tries = 0; tries < 60; tries++) {
      const ready = (await page.evaluate(
        'document.querySelectorAll(".topbar-actions > *").length > 0',
      )) as boolean;
      if (ready) break;
      await sleep(250);
    }

    for (const width of WIDTHS) {
      await page.setViewport({
        width,
        height: 860,
        deviceScaleFactor: 1,
      });
      await sleep(220);
      const report = (await page.evaluate(MEASURE)) as Report;
      const problems = [
        ...report.overlaps,
        ...report.clippedTools.map((tool) => `kontrol tergunting: ${tool}`),
        ...report.clippedTabs.map((tab) => `tab terpotong: ${tab}`),
        ...(report.sideScroll > 0
          ? [`halaman bisa digeser ke samping ${report.sideScroll}px`]
          : []),
      ];
      if (problems.length === 0) {
        console.log(`  ${String(width).padStart(4)}px  ok`);
      } else {
        console.log(`  ${String(width).padStart(4)}px  MASALAH`);
        for (const problem of problems) {
          console.log(`          ${problem}`);
          failures.push(`${width}px: ${problem}`);
        }
      }
    }
  } finally {
    await page.close().catch(() => undefined);
    await browser.close({ silent: true }).catch(() => undefined);
    studio.close();
    rmSync(root, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`\nGERBANG TATA LETAK GAGAL — ${failures.length} masalah:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nGerbang tata letak lulus di ${WIDTHS.length} lebar layar.`);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
