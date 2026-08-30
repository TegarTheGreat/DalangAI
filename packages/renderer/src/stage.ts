import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { orphanMediaAssetIds, type ScenePlan } from "@dalang/core";

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
 * Copy every file the plan's renderState references into the target public
 * dir, preserving relative paths. Returns the copied relative paths.
 */
export const copyPlanAssets = (
  planPath: string,
  plan: ScenePlan,
  targetPublicDir: string,
): string[] => {
  const planDir = dirname(resolve(planPath));
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
    ...Object.values(plan.renderState.resolvedAssets).map((asset) => asset.file),
    ...Object.values(plan.renderState.narrationAudio).map((audio) => audio.file),
    // ADR-0018: grafis tempelan dan efek suara punya lumbung berkas sendiri.
    // Melupakan keduanya di sini berarti render gagal memuat berkasnya — dan
    // itu TIDAK terlihat oleh test mana pun, hanya oleh render sungguhan.
    ...live(plan.renderState.graphicAssets, orphans.graphics),
    ...live(plan.renderState.sfxAssets, orphans.sfx),
  ];
  // Musik proyek (ADR-0014): file milik plan ikut di-stage; id "pustaka:*"
  // sudah ada di public templates, tidak perlu disalin.
  const music = plan.audio.music;
  if (music && !music.assetId.startsWith("pustaka:")) {
    files.push(music.assetId);
  }

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
    if (entry === "assets") continue;
    cpSync(join(templatesPublicDir, entry), join(dir, entry), {
      recursive: true,
    });
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
};
