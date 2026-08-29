import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { templatesRoot } from "@dalang/templates/paths";

/**
 * Content fingerprint of everything that influences the webpack bundle:
 * templates source + static public files (fonts) + core source + both
 * package.json files (pins the Remotion version). Same fingerprint ⇒ the
 * cached bundle is valid; any edit ⇒ new fingerprint ⇒ rebuild.
 *
 * `public/assets` is excluded on purpose: that folder only ever holds staged
 * demo assets for the Studio (gitignored) and per-plan assets are overlaid at
 * render time — they are inputs of a render, not of the bundle.
 */

const IGNORED_DIRS = new Set(["node_modules", ".cache"]);

const hashPath = (
  hash: ReturnType<typeof createHash>,
  base: string,
  path: string,
  excludeRel: Set<string>,
): void => {
  const rel = relative(base, path).split(sep).join("/");
  if (excludeRel.has(rel)) return;

  const stat = statSync(path);
  if (stat.isDirectory()) {
    if (IGNORED_DIRS.has(rel.split("/").at(-1) ?? "")) return;
    const entries = readdirSync(path).sort();
    for (const entry of entries) {
      hashPath(hash, base, join(path, entry), excludeRel);
    }
    return;
  }
  hash.update(rel);
  hash.update("\0");
  hash.update(readFileSync(path));
  hash.update("\0");
};

export interface FingerprintInput {
  /** Base for stable relative naming inside the hash. */
  base: string;
  /** Files or directories to include (missing ones are skipped). */
  paths: string[];
  /** Base-relative POSIX paths to skip. */
  exclude?: string[];
}

export const computeFingerprint = ({
  base,
  paths,
  exclude = [],
}: FingerprintInput): string => {
  const hash = createHash("sha256");
  const excludeRel = new Set(exclude);
  for (const path of paths) {
    if (!existsSync(path)) continue;
    hashPath(hash, base, path, excludeRel);
  }
  return hash.digest("hex").slice(0, 16);
};

/** Fingerprint for the Dalang templates bundle (see module doc). */
export const computeBundleFingerprint = (): string => {
  const workspaceRoot = join(templatesRoot, "..", "..");
  const coreRoot = join(workspaceRoot, "packages", "core");
  return computeFingerprint({
    base: workspaceRoot,
    paths: [
      join(templatesRoot, "src"),
      join(templatesRoot, "public"),
      join(templatesRoot, "package.json"),
      join(coreRoot, "src"),
      join(coreRoot, "package.json"),
    ],
    exclude: ["packages/templates/public/assets"],
  });
};
