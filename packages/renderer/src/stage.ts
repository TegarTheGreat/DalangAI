import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import type { ScenePlan } from "@dalang/core";
import { templatesPublicDir } from "@dalang/templates/paths";

/**
 * Assemble the public dir served to the composition for one render:
 *  1. the templates' own static assets (fonts), then
 *  2. every file renderState references, copied relative to the plan file.
 *
 * renderState file paths are the contract: they are interpreted relative to
 * the plan's directory on disk and served under the same relative path via
 * staticFile(). Absolute paths and `..` escapes are rejected.
 */

export interface StagedPublicDir {
  dir: string;
  cleanup: () => void;
}

const assertSafeRelative = (file: string): void => {
  if (isAbsolute(file) || normalize(file).split(/[\\/]/)[0] === "..") {
    throw new Error(
      `Path aset di renderState harus relatif terhadap folder plan (tanpa ".."): "${file}"`,
    );
  }
};

export const stagePublicDir = (
  planPath: string,
  plan: ScenePlan,
): StagedPublicDir => {
  const dir = mkdtempSync(join(tmpdir(), "dalang-stage-"));
  cpSync(templatesPublicDir, dir, { recursive: true });

  const planDir = dirname(resolve(planPath));
  const files = [
    ...Object.values(plan.renderState.resolvedAssets).map((a) => a.file),
    ...Object.values(plan.renderState.narrationAudio).map((a) => a.file),
  ];

  for (const file of files) {
    assertSafeRelative(file);
    const source = join(planDir, file);
    if (!existsSync(source)) {
      throw new Error(
        `Aset yang direferensikan renderState tidak ditemukan: ${source}`,
      );
    }
    const target = join(dir, file);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target);
  }

  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
};
