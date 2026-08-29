import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Filesystem locations of this package, for Node-side consumers (the
 * renderer bundles `templatesEntry` and stages `templatesPublicDir`).
 * This module must stay free of `remotion` imports — it runs in plain Node.
 */

const here = dirname(fileURLToPath(import.meta.url));

export const templatesRoot = join(here, "..");
export const templatesEntry = join(templatesRoot, "src", "index.ts");
export const templatesPublicDir = join(templatesRoot, "public");
