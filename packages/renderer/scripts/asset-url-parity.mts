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
 * BATAS YANG PERLU DINYATAKAN: still tidak memuat audio, jadi gerbang ini
 * membuktikan jalur GAMBAR (latar scene, screenshot, ikon, stiker) — bukan
 * narasi, musik, atau efek suara. Untuk audio, buktinya ada di render video
 * E2E dan pemeriksaan stream-nya.
 *
 * Jalankan: pnpm --filter @dalang/renderer asset-url-parity [path/plan.json]
 */

import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseScenePlan } from "@dalang/core";
import { computeFrameLayout } from "@dalang/templates/layout";
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
 */
const framesWithAssets = (planPath: string): number[] => {
  const plan = parseScenePlan(JSON.parse(readFileSync(planPath, "utf8")));
  const layout = computeFrameLayout(plan);
  return plan.scenes
    .map((scene, index) => ({ scene, index }))
    .filter(({ scene }) => plan.renderState.resolvedAssets[scene.id] !== undefined)
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
const digest = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

try {
  await renderPlanStills({
    planPath: PLAN,
    frames: FRAMES,
    outputLocationFor: (frame) => join(outDir, `lokal-${frame}.png`),
    scale: 0.25,
  });

  await renderPlanStills({
    planPath: PLAN,
    frames: FRAMES,
    outputLocationFor: (frame) => join(outDir, `url-${frame}.png`),
    scale: 0.25,
    assetBaseUrl: baseUrl,
  });

  // Tanpa pemeriksaan ini gerbangnya hampa: plan tanpa aset akan lulus
  // paritas byte tanpa membuktikan apa pun tentang jalur URL.
  if (servedPaths.length === 0) {
    throw new Error(
      `Tidak ada aset yang diminta lewat HTTP dari ${PLAN} — gerbang ini tidak menguji apa-apa. Pakai plan yang punya aset di renderState.`,
    );
  }

  for (const frame of FRAMES) {
    const localHash = digest(join(outDir, `lokal-${frame}.png`));
    const urlHash = digest(join(outDir, `url-${frame}.png`));
    if (localHash !== urlHash) {
      throw new Error(
        `Frame ${frame}: render lokal dan render lewat URL BERBEDA.\n` +
          `  staticFile   : ${localHash}\n` +
          `  assetBaseUrl : ${urlHash}\n` +
          `  aset terlayani: ${[...new Set(servedPaths)].join(", ")}\n` +
          "Biasanya berarti ada pemanggil staticFile() untuk aset PLAN yang belum dipindah ke useAssetSrc().",
      );
    }
  }

  const unique = [...new Set(servedPaths)];
  console.log(
    `Paritas aset OK — ${FRAMES.length} frame identik, ${unique.length} aset dilayani lewat HTTP: ${unique.join(", ")}`,
  );
} finally {
  server.close();
  await rm(outDir, { recursive: true, force: true });
}
