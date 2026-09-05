/**
 * Gerbang paritas aset (ADR-0019).
 *
 * Sebuah still dirender DUA kali dari plan yang sama:
 *   1. jalur lokal — aset plan disalin ke public dir bundle, diambil dengan
 *      `staticFile()`;
 *   2. jalur cloud — aset plan TIDAK disalin sama sekali, dan diambil dari URL
 *      dasar yang dilayani server HTTP sementara di skrip ini.
 *
 * Keduanya wajib menghasilkan berkas yang identik byte per byte.
 *
 * Kenapa ini ada, dan kenapa bukan unit test: satu pemanggil `staticFile()`
 * yang terlewat saat memindahkan aset ke jalur URL TIDAK menggagalkan test mana
 * pun — ia hanya membuat gambar atau suara hilang di video, dan hanya terlihat
 * kalau ada yang benar-benar merender. Skrip ini yang merender.
 *
 * APA ARTI SELISIH BYTE DI SINI, diuji dengan mutasi dan bukan diduga: satu
 * pemanggil `staticFile()` untuk aset PLAN membuat render jalur URL GAGAL
 * TOTAL, bukan menghasilkan gambar yang berbeda sedikit — asetnya memang tidak
 * ada di bundle jalur itu, jadi Remotion membatalkan render-nya. Dicoba dua
 * kali (mengganti `assetSrc` dengan `staticFile`, lalu menyajikan SVG dengan
 * content-type yang salah), keduanya berakhir sebagai CancelledError. Jadi
 * selisih byte yang LOLOS render bukan aset yang hilang: ia perbedaan
 * rasterisasi. Hitungan piksel di pesan kegagalan yang membedakan keduanya,
 * dan PNG-nya ikut disimpan supaya bisa dilihat.
 *
 * DUA PERCOBAAN, BUKAN SATU. Frame yang berselisih dirender ulang sekali
 * sebelum divonis, dan hanya selisih yang BERULANG yang menggagalkan gerbang.
 * Alasannya ada di src/parity-verdict.ts: pemanggil `staticFile()` yang
 * terlewat membuat aset hilang di setiap render, sedangkan derau runner tidak
 * bertahan pada ulangan — jadi keterulangan, bukan besar selisihnya, yang
 * memisahkan cacat dari kebisingan. Gerbangnya tetap byte per byte.
 *
 * BATAS YANG PERLU DINYATAKAN: still tidak memuat audio, jadi gerbang ini
 * membuktikan jalur GAMBAR (latar scene, screenshot, ikon, stiker) — bukan
 * narasi, musik, atau efek suara. Untuk audio, buktinya ada di render video
 * E2E dan pemeriksaan stream-nya.
 *
 * Jalankan: pnpm --filter @dalang/renderer asset-url-parity [path/plan.json]
 */

import { createHash } from "node:crypto";
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseScenePlan, sceneAsset } from "@dalang/core";
import { computeFrameLayout } from "@dalang/templates/layout";
import {
  describeAttempt,
  type ParityAttempt,
  parityVerdict,
} from "../src/parity-verdict";
import { describeDiff, diffPng } from "../src/png-diff";
import { renderPlanStills } from "../src/render";

// Bawaannya relatif AKAR REPO, bukan cwd: skrip ini dipanggil lewat
// `pnpm --filter`, yang menjalankannya dari folder paketnya.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PLAN = process.argv[2]
  ? resolve(repoRoot, process.argv[2])
  : join(repoRoot, "examples/borobudur-60s/plan.json");
/**
 * Frame dipilih dari PLAN, bukan ditulis tangan: titik tengah scene-scene yang
 * benar-benar punya aset ter-resolve. Nomor frame tetap akan lulus paritas pada
 * kartu judul yang tidak memuat aset apa pun — yaitu lulus tanpa menguji apa
 * pun. Maksimal tiga supaya gerbangnya tetap cepat.
 *
 * Scene yang punya LAPISAN ber-aset (ADR-0025) didahulukan: lapisan memakai
 * `useAssetSrc()` yang sama, jadi ia punya bahaya yang sama — satu pemanggil
 * `staticFile()` yang terlewat di sana membuat render cloud kehilangan
 * sisipannya, dan tidak ada unit test yang bisa melihat itu. Kalau scene
 * berlapisan tidak ikut terpilih, jalur itu tidak pernah diuji.
 */
const framesWithAssets = (planPath: string): number[] => {
  const plan = parseScenePlan(JSON.parse(readFileSync(planPath, "utf8")));
  const layout = computeFrameLayout(plan);
  const punyaLapisan = (scene: (typeof plan.scenes)[number]): boolean =>
    scene.layers.some((layer) => plan.renderState.layerAssets[layer.id] !== undefined);
  return plan.scenes
    .map((scene, index) => ({ scene, index }))
    .filter(({ scene }) => sceneAsset(plan, scene) !== undefined || punyaLapisan(scene))
    .sort((a, b) => Number(punyaLapisan(b.scene)) - Number(punyaLapisan(a.scene)))
    .slice(0, 3)
    .map(({ index }) =>
      Math.round((layout.sceneStarts[index] ?? 0) + (layout.sceneFrames[index] ?? 2) / 2),
    );
};

const FRAMES = framesWithAssets(PLAN);
if (FRAMES.length === 0) {
  throw new Error(
    `Plan ${PLAN} tidak punya satu pun aset ter-resolve — gerbang paritas tidak bisa menguji apa-apa dengannya.`,
  );
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
};

const planDir = dirname(PLAN);
const servedPaths: string[] = [];

const server = createServer((req, res) => {
  const rel = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "").replace(
    /^\/+/,
    "",
  );
  const abs = join(planDir, normalize(rel));
  if (!abs.startsWith(planDir) || !existsSync(abs) || !statSync(abs).isFile()) {
    res.writeHead(404).end();
    return;
  }
  servedPaths.push(rel);
  res.writeHead(200, {
    "content-type": MIME[extname(abs)] ?? "application/octet-stream",
  });
  createReadStream(abs).pipe(res);
});

const port = await new Promise<number>((done) => {
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    done(typeof address === "object" && address ? address.port : 0);
  });
});
const baseUrl = `http://127.0.0.1:${port}`;

const outDir = await mkdtemp(join(tmpdir(), "dalang-parity-"));
const fingerprint = (file: string) => ({
  hash: createHash("sha256").update(readFileSync(file)).digest("hex"),
  bytes: statSync(file).size,
});

/**
 * Render satu himpunan frame lewat KEDUA jalur aset dan kembalikan sidiknya.
 * `tag` memisahkan berkas antar percobaan supaya ulangan tidak menimpa bukti
 * percobaan pertama.
 */
const renderBothPaths = async (
  frames: number[],
  tag: string,
): Promise<Map<number, ParityAttempt>> => {
  await renderPlanStills({
    planPath: PLAN,
    frames,
    outputLocationFor: (frame) => join(outDir, `${tag}-lokal-${frame}.png`),
    scale: 0.25,
  });
  await renderPlanStills({
    planPath: PLAN,
    frames,
    outputLocationFor: (frame) => join(outDir, `${tag}-url-${frame}.png`),
    scale: 0.25,
    assetBaseUrl: baseUrl,
  });
  return new Map(
    frames.map((frame) => [
      frame,
      {
        local: fingerprint(join(outDir, `${tag}-lokal-${frame}.png`)),
        url: fingerprint(join(outDir, `${tag}-url-${frame}.png`)),
      },
    ]),
  );
};

/**
 * Bukti yang bisa DILIHAT, bukan cuma sha256 yang berbeda.
 *
 * Vonis gerbang ini benar tapi diagnosisnya buta: "132759 byte vs 132736 byte"
 * tidak bisa membedakan gambar yang hilang dari sepuhan tepi yang bergeser satu
 * tingkat, padahal penanganan keduanya berlawanan. Jadi saat selisihnya
 * berulang, dua hal disimpan: hitungan piksel (lewat `diffPng`) dan berkas
 * PNG-nya sendiri di folder yang diunggah CI sebagai artefak.
 */
// Folder tetap di akar repo, bukan variabel lingkungan: satu tempat yang
// selalu sama membuat langkah unggah CI dan orang yang mencarinya di mesin
// sendiri menyebut path yang persis sama.
const artefakDir = join(repoRoot, "artefak-paritas");

const simpanBukti = (frame: number, tags: string[]): string[] => {
  mkdirSync(artefakDir, { recursive: true });
  const disimpan: string[] = [];
  for (const tag of tags) {
    for (const jalur of ["lokal", "url"]) {
      const sumber = join(outDir, `${tag}-${jalur}-${frame}.png`);
      if (!existsSync(sumber)) continue;
      const tujuan = join(artefakDir, `aset-f${frame}-${tag}-${jalur}.png`);
      copyFileSync(sumber, tujuan);
      disimpan.push(tujuan);
    }
  }
  return disimpan;
};

/** Satu baris hitungan piksel untuk satu percobaan. */
const bedaPiksel = (frame: number, tag: string): string => {
  try {
    return describeDiff(
      diffPng(
        readFileSync(join(outDir, `${tag}-lokal-${frame}.png`)),
        readFileSync(join(outDir, `${tag}-url-${frame}.png`)),
      ),
    );
  } catch (error) {
    return `gagal dibandingkan piksel: ${error instanceof Error ? error.message : String(error)}`;
  }
};

try {
  const first = await renderBothPaths(FRAMES, "p1");

  // Tanpa pemeriksaan ini gerbangnya hampa: plan tanpa aset akan lulus
  // paritas byte tanpa membuktikan apa pun tentang jalur URL.
  if (servedPaths.length === 0) {
    throw new Error(
      `Tidak ada aset yang diminta lewat HTTP dari ${PLAN} — gerbang ini tidak menguji apa-apa. Pakai plan yang punya aset di renderState.`,
    );
  }

  const mismatched = FRAMES.filter(
    (frame) => parityVerdict(first.get(frame) as ParityAttempt) !== "identik",
  );

  // Frame yang berselisih dirender SEKALI LAGI sebelum divonis. Aset yang benar
  // -benar tidak sampai akan hilang lagi; derau runner tidak.
  const second: Map<number, ParityAttempt> =
    mismatched.length > 0 ? await renderBothPaths(mismatched, "p2") : new Map();

  for (const frame of mismatched) {
    const attempt1 = first.get(frame) as ParityAttempt;
    const attempt2 = second.get(frame) as ParityAttempt;
    const verdict = parityVerdict(attempt1, attempt2);
    if (verdict === "berbeda") {
      const bukti = simpanBukti(frame, ["p1", "p2"]);
      throw new Error(
        `Frame ${frame}: render lokal dan render lewat URL BERBEDA, dua kali berturut-turut.\n` +
          describeAttempt("percobaan 1", attempt1) +
          "\n" +
          `    piksel      : ${bedaPiksel(frame, "p1")}\n` +
          describeAttempt("percobaan 2", attempt2) +
          "\n" +
          `    piksel      : ${bedaPiksel(frame, "p2")}\n` +
          `  aset terlayani: ${[...new Set(servedPaths)].join(", ")}\n` +
          `  bukti gambar : ${bukti.join(", ") || "(gagal disimpan)"}\n` +
          "Aset yang benar-benar hilang menggagalkan render, bukan menggeser byte " +
          "(lihat catatan di kepala berkas ini), jadi selisih yang lolos sampai sini " +
          "adalah perbedaan RASTERISASI. Bidang luas dengan selisih kanal besar " +
          "berarti isi gambarnya berbeda; pecahan persen dengan selisih kecil berarti " +
          "sepuhan tepi bergeser satu tingkat di lingkungan ini.",
      );
    }
    console.warn(
      `Frame ${frame}: percobaan pertama berselisih, ulangannya identik — derau runner, bukan cacat jalur aset.\n` +
        describeAttempt("percobaan 1", attempt1),
    );
  }

  const unique = [...new Set(servedPaths)];
  console.log(
    `Paritas aset OK — ${FRAMES.length} frame identik, ${unique.length} aset dilayani lewat HTTP: ${unique.join(", ")}`,
  );
} finally {
  server.close();
  await rm(outDir, { recursive: true, force: true });
}
