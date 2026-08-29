import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copies the demo example's assets into public/ so Remotion Studio can serve
 * them via staticFile() with the same relative paths the renderer stages
 * ("assets/…"). public/assets/ is gitignored — the examples folder stays the
 * single source of truth.
 */

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..", "..", "..", "examples", "borobudur-60s", "assets");
const target = join(here, "..", "public", "assets");

if (!existsSync(source)) {
  console.error(`Demo assets tidak ditemukan: ${source}`);
  process.exit(1);
}
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
console.log(`Demo assets di-stage ke ${target}`);
