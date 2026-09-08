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

/**
 * Sub-folder `public/` yang merupakan ASET SITUS: ikut ter-bundle bersama
 * komposisi dan harus bisa diambil `staticFile()` di mana pun render berjalan
 * — termasuk di preview Player milik Studio.
 *
 * SATU daftar untuk semua pemakainya, dan itu bukan kerapian: sebelumnya
 * renderer menyalin seluruh isi `public/` (kecuali staging demo) sementara
 * Studio hanya memasang `/fonts/*`. Akibatnya musik latar berbunyi di hasil
 * render tapi 404 di preview — fitur yang tampak jadi, padahal separuh mati,
 * dan tidak ada satu pun test yang bisa melihatnya.
 */
export const SITE_ASSET_DIRS = ["fonts", "music"] as const;

/**
 * Folder staging demo Studio di dalam `public/`. Sengaja BUKAN aset situs:
 * isinya milik proyek yang sedang dibuka, dan tidak boleh bocor ke cache
 * bundle yang dipakai bersama.
 */
export const PUBLIC_STAGING_DIR = "assets";
