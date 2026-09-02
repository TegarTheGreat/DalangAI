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

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startStudioServer } from "../src/server/index";
import { exitSoon, launchBrowser } from "./browser";
import { stubDeps } from "./stub-deps";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEMO = process.argv[2]
  ? resolve(repoRoot, process.argv[2])
  : join(repoRoot, "examples", "borobudur-60s");

/**
 * Lebar nyata: ponsel, tablet, laptop 13"/14"/16", dan monitor lebar.
 *
 * 1680/1536/1512 ada karena cacat pernah bersembunyi PERSIS di antara dua
 * ambang yang diuji: di 1450-1600px segmen rasio "1:1" tergunting, sementara
 * 1600 dan 1440 keduanya bersih. Daftar yang hanya berisi ambang media query
 * hanya menguji tempat yang sudah dipikirkan.
 */
const WIDTHS = [
  1920, 1680, 1600, 1536, 1512, 1440, 1366, 1280, 1200, 1100, 1024, 960, 900, 820, 768,
  600, 420, 380,
];

/**
 * Dialog yang dibuka dan diukur. Dipilih yang isinya PALING BANYAK: kalau yang
 * terpanjang muat, yang lain juga.
 */
const DIALOGS = [
  { opener: '[data-tip^="Render video"]', name: "Ekspor", required: false },
  { opener: '[data-tip^="Gaya proyek"]', name: "Gaya", required: false },
  { opener: '[data-tip^="Catatan sutradara"]', name: "Catatan", required: false },
  { opener: '[data-tip^="Tinjauan render"]', name: "Tinjau", required: false },
  // Dialog Unggah (ADR-0030) dibuka dari riwayat render: berkas render
  // disemai dan tujuan palsu diberi ke stub supaya tombolnya aktif. WAJIB
  // ada: kalau tombolnya hilang, itu regresi, bukan alasan untuk melewati.
  { opener: ".render-publish", name: "Unggah", required: true },
] as const;

/**
 * Isi yang TERGUNTING di dalam panel bergulung.
 *
 * Kelas cacat ini tak terlihat oleh pengukuran mana pun di atas: dialognya
 * muat di layar, halamannya tidak bisa digeser, dan tidak ada yang menindih.
 * Yang terjadi ada di dalamnya — anak flex boleh MENYUSUT di bawah tinggi
 * isinya secara bawaan, jadi kartu setinggi 1500 piksel dipencet jadi 32 dan
 * `overflow: hidden` menggunting sisanya tanpa suara. Panel Pengaturan lahir
 * dengan cacat itu, dan yang menemukannya adalah tangkapan layar untuk README,
 * bukan gerbang ini.
 *
 * Jadi: tiap elemen yang disebut harus setinggi isinya sendiri.
 */
const clippedProbe = (selector: string, name: string): string =>
  `(() => {
    const nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
    const bad = nodes
      .map((el) => {
        if (el.scrollHeight > el.clientHeight + 1) {
          return "tinggi " + el.clientHeight + "px untuk isi " + el.scrollHeight + "px";
        }
        if (el.scrollWidth > el.clientWidth + 1) {
          return "lebar " + el.clientWidth + "px untuk isi " + el.scrollWidth + "px";
        }
        return null;
      })
      .filter(Boolean);
    if (bad.length === 0) return null;
    return "${name}: " + bad.length + " dari " + nodes.length
      + " tergunting isinya (mis. " + bad[0] + ")";
  })()`;

/**
 * Membuka satu dialog, mengukur kotaknya terhadap viewport, lalu menutupnya.
 * Mengembalikan kalimat masalah, atau null kalau muat.
 *
 * Ditulis sebagai string kode: sama seperti MEASURE, ia berjalan di dalam
 * peramban dan tidak boleh mengandung sintaks TypeScript apa pun.
 */
const dialogProbe = (opener: string, name: string, required: boolean): string =>
  `(() => {
    const opener = document.querySelector(${JSON.stringify(opener)});
    if (!opener) return ${required ? `"dialog ${name}: pembukanya tidak ada di DOM"` : "null"};
    if (opener.disabled) return "dialog ${name}: pembukanya nonaktif";
    opener.click();
    const dialog = document.querySelector(".dialog-backdrop .dialog");
    if (!dialog) return null;
    const box = dialog.getBoundingClientRect();
    const bocor = box.top < 0 || box.bottom > window.innerHeight + 1
      || box.left < 0 || box.right > window.innerWidth + 1;
    const tinggi = Math.round(box.height);
    const layar = window.innerHeight;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return bocor
      ? "dialog ${name} keluar layar: tinggi " + tinggi + "px pada layar " + layar + "px"
      : null;
  })()`;

/**
 * Tab panel Properti yang dibuka dan diukur satu per satu.
 *
 * Versi pertama gerbang ini hanya mengukur tab BAWAAN ("Scene"), jadi seluruh
 * isi tab lain tidak pernah dilihat siapa pun sampai seseorang membukanya
 * sendiri di layar sempit. Tab "Lapisan" (ADR-0025) adalah yang paling padat
 * kendalinya — kalau ia muat, yang lain hampir pasti muat, tapi murah untuk
 * memeriksa semuanya sekalian.
 */
const TABS = [
  "Scene",
  "Visual",
  "Teks",
  "Transkrip",
  "Grafis",
  "Lapisan",
  "Transisi",
  "Anotasi",
] as const;

/** Membuka satu tab Properti; false kalau tabnya tidak ada di DOM. */
const tabProbe = (label: string): string =>
  `(() => {
    const tabs = Array.from(document.querySelectorAll(".tab-bar .tab"));
    const target = tabs.find((tab) => (tab.textContent || "").trim().startsWith("${label}"));
    if (!target) return false;
    target.click();
    return true;
  })()`;

/**
 * Memastikan tab Lapisan punya SATU kartu terbuka untuk diukur.
 *
 * Tanpa ini gerbang hanya melihat keadaan kosong ("belum ada lapisan"), yaitu
 * satu paragraf dan satu tombol — dan keadaan kosong tidak pernah meluber.
 * Yang padat kendalinya justru kartu yang terbuka, dan itulah yang harus
 * dibuktikan muat di 380px.
 */
const ENSURE_LAYER = `(() => {
  if (document.querySelector(".inspector-scroll .graphic-card")) return "ada";
  const buttons = Array.from(document.querySelectorAll(".inspector-scroll button"));
  const add = buttons.find((b) => (b.textContent || "").includes("Tambah lapisan"));
  if (!add || add.disabled) return "tidak-bisa";
  add.click();
  return "ditambah";
})()`;

/**
 * Kendali di panel Properti yang keluar dari kolomnya.
 *
 * Diukur per ELEMEN terhadap kotak panel, bukan lewat `scrollWidth` panelnya.
 * Alasannya ketahuan saat mengujinya: kartu tempelan/lapisan memakai
 * `overflow: hidden`, jadi isi yang terlalu lebar TERGUNTING di dalam kartu
 * dan tidak pernah menambah `scrollWidth` panel sama sekali. Pemeriksaan
 * lewat scrollWidth akan hijau persis pada kasus yang paling perlu ditangkap:
 * kendali yang ada tapi tidak bisa dijangkau.
 */
const INSPECTOR_CLIPPED = `(() => {
  const panel = document.querySelector(".inspector-scroll");
  if (!panel) return [];
  const box = panel.getBoundingClientRect();
  const out = [];
  // Panelnya sendiri boleh MELEBAR kalau kolomnya masih punya kelonggaran,
  // dan pada layar lebar itu menyembunyikan isi yang kelewat lebar: yang
  // meluber justru panelnya, bukan kendalinya. Diperiksa lebih dulu.
  if (box.right > window.innerWidth + 1 || box.left < -1) {
    out.push("panel Properti keluar layar (+" +
      Math.round(Math.max(box.right - window.innerWidth, -box.left)) + "px)");
  }
  const nodes = panel.querySelectorAll(
    ".slider-row, .field, .anchor-pad, .lib-search, .segmented, button"
  );
  for (const node of nodes) {
    const r = node.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const lebih = Math.round(Math.max(r.right - box.right, box.left - r.left));
    if (lebih > 1) {
      const nama = (node.className || "").toString().split(" ")[0] || node.tagName;
      out.push(nama + " (+" + lebih + "px)");
    }
  }
  return out.slice(0, 3);
})()`;

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
  // Satu berkas render palsu supaya riwayat render — dan tombol Unggah
  // (ADR-0030) — ada di layar untuk diukur.
  const rendersDir = join(root, "demo", ".dalang", "renders");
  mkdirSync(rendersDir, { recursive: true });
  writeFileSync(join(rendersDir, "preview.mp4"), "mp4-gerbang");

  const studio = await startStudioServer({
    workspaceRoot: root,
    planPath: join(root, "demo", "plan.json"),
    // Panel Pengaturan (ADR-0032) menyunting `.env`. Diarahkan ke folder
    // sementara: gerbang tidak boleh bisa menyentuh berkas .env milik repo.
    settings: { envPath: join(root, ".env") },
    deps: stubDeps({
      publishTargets: () => [
        {
          id: "youtube-uji",
          label: "YouTube (uji)",
          publish: async () => {
            throw new Error("gerbang tata letak tidak mengunggah");
          },
        },
      ],
    }),
    port: 0,
    appDistDir: join(repoRoot, "packages", "studio", "dist"),
  });

  // Chromium yang SAMA dengan render smoke test — deteksi milik paket
  // renderer, jadi CI tidak mengunduh peramban kedua.
  // Peramban gagal dibuka = server ditutup dulu, supaya prosesnya keluar.
  const browser = await launchBrowser().catch((error: unknown) => {
    studio.close();
    throw error;
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
      // Dialog diperiksa TERSENDIRI: ia tidak ada di DOM sampai dibuka, jadi
      // pengukuran di atas tidak pernah melihatnya. Kelas cacatnya nyata —
      // dialog Ekspor tumbuh melewati kedua tepi layar begitu bagian interop
      // masuk (ADR-0023), dan tombol "Mulai ekspor" jadi tak terjangkau.
      for (const dialog of DIALOGS) {
        const overflow = (await page.evaluate(
          dialogProbe(dialog.opener, dialog.name, dialog.required),
        )) as string | null;
        if (overflow) problems.push(overflow);
      }

      // Tiap tab Properti dibuka dan diukur sendiri: isinya baru ada di DOM
      // setelah tabnya aktif, jadi pengukuran di atas tidak pernah melihatnya.
      for (const label of TABS) {
        const opened = (await page.evaluate(tabProbe(label))) as boolean;
        if (!opened) continue;
        await sleep(90);
        if (label === "Lapisan") {
          const state = (await page.evaluate(ENSURE_LAYER)) as string;
          // Penambahan lapisan lewat patch: server, lalu SSE, lalu render ulang.
          if (state === "ditambah") await sleep(700);
        }
        const tabReport = (await page.evaluate(MEASURE)) as Report;
        for (const overlap of tabReport.overlaps) {
          problems.push(`tab ${label}: ${overlap}`);
        }
        if (tabReport.sideScroll > 0) {
          problems.push(`tab ${label}: halaman bisa digeser ke samping`);
        }
        const clipped = (await page.evaluate(INSPECTOR_CLIPPED)) as string[];
        for (const item of clipped) {
          problems.push(`tab ${label}: kendali keluar kolom — ${item}`);
        }
      }
      await page.evaluate(tabProbe("Scene"));

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

    // -- fase lobi: dialog Pengaturan (ADR-0032) ----------------------------
    // Panel ini hanya ada di lobi, jadi proyeknya ditutup dulu lewat rute
    // yang sama dengan tombol "tutup" (bekerja walau server dipatok ke satu
    // proyek). Dijalankan PALING AKHIR supaya seluruh pemeriksaan editor di
    // atas tidak terpengaruh kalau bagian ini rusak.
    //
    // Isinya sengaja diukur di mesin TANPA kunci apa pun: semua kemampuan
    // belum menyala, jadi tiap kartu terbuka dan dialognya berada di keadaan
    // paling tinggi yang mungkin.
    await page.evaluate('fetch("/api/workspace/close", { method: "POST" })');
    let diLobi = false;
    for (let tries = 0; tries < 60; tries++) {
      diLobi = (await page.evaluate(
        'document.querySelector(".lobby-settings") !== null',
      )) as boolean;
      if (diLobi) break;
      await sleep(250);
    }
    if (!diLobi) {
      failures.push("lobi: tombol Pengaturan tidak muncul setelah proyek ditutup");
    } else {
      console.log("\n  lobi — dialog Pengaturan");
      for (const width of WIDTHS) {
        await page.setViewport({ width, height: 860, deviceScaleFactor: 1 });
        await sleep(180);
        // Dibuka sekali lagi TANPA ditutup, supaya isinya bisa diperiksa:
        // dialogProbe menutup dialognya setelah mengukur.
        await page.evaluate(
          '(() => { const b = document.querySelector(".lobby-settings"); if (b) b.click(); })()',
        );
        await sleep(160);
        const terpencet = (await page.evaluate(
          clippedProbe(".settings-dialog .cap-card", "kartu Pengaturan"),
        )) as string | null;
        await page.evaluate(
          'document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))',
        );
        const overflow = (await page.evaluate(
          dialogProbe(".lobby-settings", "Pengaturan", true),
        )) as string | null;
        const sideways = (await page.evaluate(
          "Math.max(0, document.documentElement.scrollWidth - window.innerWidth)",
        )) as number;
        const problems = [
          ...(overflow ? [overflow] : []),
          ...(terpencet ? [terpencet] : []),
          ...(sideways > 0 ? [`lobi bisa digeser ke samping ${sideways}px`] : []),
        ];
        if (problems.length === 0) {
          console.log(`  ${String(width).padStart(4)}px  ok`);
        } else {
          console.log(`  ${String(width).padStart(4)}px  MASALAH`);
          for (const problem of problems) {
            console.log(`          ${problem}`);
            failures.push(`${width}px lobi: ${problem}`);
          }
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
  console.log(
    `\nGerbang tata letak lulus: editor dan lobi, ${WIDTHS.length} lebar layar masing-masing.`,
  );
};

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => exitSoon());
