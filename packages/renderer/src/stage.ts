import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { orphanMediaAssetIds, type ScenePlan } from "@dalang/core";
import { PUBLIC_STAGING_DIR } from "@dalang/templates/paths";

/**
 * Render-input staging.
 *
 * renderState file paths are the contract: they are interpreted relative to
 * the plan's directory on disk and served under the same relative path via
 * staticFile(). Absolute paths and `..` escapes are rejected so a plan can
 * never read outside its own folder.
 */

export const assertSafeRelative = (file: string): void => {
  if (isAbsolute(file) || normalize(file).split(/[\\/]/)[0] === "..") {
    throw new Error(
      `Path aset di renderState harus relatif terhadap folder plan (tanpa ".."): "${file}"`,
    );
  }
};

/**
 * Setiap berkas milik PLAN yang dibutuhkan render, sebagai path relatif
 * terhadap folder plan (ADR-0019).
 *
 * SATU jawaban untuk pertanyaan "berkas apa saja yang dibutuhkan plan ini",
 * dipakai oleh SEMUA RenderTarget: target lokal menyalinnya ke public dir
 * bundle, target cloud mengunggahnya ke penyimpanan objek. Kalau kedua target
 * menyusun daftarnya sendiri-sendiri, keduanya pasti berbeda cepat atau lambat
 * — persis seperti `graphicAssets` yang dulu terlewat di penyalinan lokal dan
 * baru ketahuan lewat render sungguhan, bukan lewat test.
 *
 * Aset SITUS (font, bed musik "pustaka:*") sengaja TIDAK ada di sini: keduanya
 * ikut ter-bundle bersama komposisi.
 */
export const planAssetFiles = (plan: ScenePlan): string[] => {
  // ADR-0018: entri grafis/cue yang grafisnya sudah dihapus tetap tertinggal di
  // renderState (sengaja — supaya undo mengembalikannya utuh). Entri seperti
  // itu tidak boleh ikut dipentaskan: berkasnya tidak dipakai render, dan bila
  // pengguna sudah menghapusnya dari disk, menuntutnya ada akan menggagalkan
  // render yang sebenarnya sehat.
  const orphans = orphanMediaAssetIds(plan);
  const live = (
    store: Record<string, { file: string }>,
    orphanIds: readonly string[],
  ): string[] =>
    Object.entries(store)
      .filter(([id]) => !orphanIds.includes(id))
      .map(([, asset]) => asset.file);

  const files = [
    ...Object.values(plan.renderState.clipAssets).map((asset) => asset.file),
    ...Object.values(plan.renderState.narrationAudio).map((audio) => audio.file),
    // ADR-0018: grafis tempelan dan efek suara punya lumbung berkas sendiri.
    // Melupakan keduanya di sini berarti render gagal memuat berkasnya — dan
    // itu TIDAK terlihat oleh test mana pun, hanya oleh render sungguhan.
    ...live(plan.renderState.graphicAssets, orphans.graphics),
    // ADR-0025: lapisan video juga punya lumbung berkasnya sendiri.
    ...live(plan.renderState.layerAssets, orphans.layers),
    ...live(plan.renderState.sfxAssets, orphans.sfx),
    // ADR-0026: trek audio tambahan juga punya lumbung berkasnya sendiri.
    ...live(plan.renderState.trackAssets, orphans.tracks),
  ];
  // Musik proyek (ADR-0014): file milik plan ikut di-stage; id "pustaka:*"
  // sudah ada di public templates, tidak perlu disalin.
  const music = plan.audio.music;
  if (music && !music.assetId.startsWith("pustaka:")) {
    files.push(music.assetId);
  }
  // Satu berkas boleh dirujuk beberapa scene; menyalin/mengunggahnya sekali
  // saja sudah cukup.
  return [...new Set(files)];
};

/**
 * Copy every file the plan's renderState references into the target public
 * dir, preserving relative paths. Returns the copied relative paths.
 */
export const copyPlanAssets = (
  planPath: string,
  plan: ScenePlan,
  targetPublicDir: string,
): string[] => {
  const planDir = dirname(resolve(planPath));
  const files = planAssetFiles(plan);

  for (const file of files) {
    assertSafeRelative(file);
    const source = join(planDir, file);
    if (!existsSync(source)) {
      throw new Error(`Aset yang direferensikan renderState tidak ditemukan: ${source}`);
    }
    const target = join(targetPublicDir, file);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target);
  }
  return files;
};

export interface StagedDir {
  dir: string;
  cleanup: () => void;
}

/**
 * A clean copy of the templates' public dir for bundling: static template
 * files (fonts) only — the gitignored `assets/` staging area for Studio demos
 * is excluded so demo content can never leak into the bundle cache.
 */
export const stageTemplatesPublic = (templatesPublicDir: string): StagedDir => {
  const dir = mkdtempSync(join(tmpdir(), "dalang-public-"));
  for (const entry of readdirSync(templatesPublicDir)) {
    if (entry === PUBLIC_STAGING_DIR) continue;
    cpSync(join(templatesPublicDir, entry), join(dir, entry), {
      recursive: true,
    });
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
};
