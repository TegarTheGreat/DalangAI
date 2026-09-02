import { SITE_ASSET_DIRS } from "@dalang/templates/paths";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";

/**
 * Penyaji media untuk @remotion/player. Di luar bundler Remotion,
 * `staticFile("x")` mengembalikan path root `/x` (diverifikasi dari source
 * remotion 4.0.518) — jadi cukup mount:
 *
 *   /fonts/*, /music/*          → templates/public (aset situs: font, bed musik)
 *   /assets/*                   → folder plan (aset lokal proyek)
 *   /.dalang/{tts,assets,renders,proxies}/* → keluaran pipeline & render
 *
 * dan komponen preset berjalan APA ADANYA di Player (tanpa perubahan).
 * File privat `.dalang` lain (pipeline.db, chat-history.json, patch-log.json)
 * TIDAK pernah tersaji. serveStatic menolak `..`/backslash setelah decode dan
 * mendukung Range 206 (dibutuhkan seeking audio/video).
 */

const DALANG_PUBLIC = /^\/\.dalang\/(tts|assets|renders|proxies)\//;

export const registerMedia = (
  app: Hono,
  options: { templatesPublicDir: string; planDir: string },
): void => {
  // Setiap ASET SITUS dipasang dari daftar yang sama dengan yang dipakai
  // renderer. Sebelumnya hanya /fonts/* yang dipasang, sehingga bed musik
  // pustaka 404 di preview padahal berbunyi di hasil render.
  for (const dir of SITE_ASSET_DIRS) {
    app.use(`/${dir}/*`, serveStatic({ root: options.templatesPublicDir }));
  }
  app.use("/assets/*", serveStatic({ root: options.planDir }));
  app.use("/.dalang/*", async (c, next) => {
    if (!DALANG_PUBLIC.test(c.req.path)) {
      return c.json({ error: "Tidak tersedia" }, 404);
    }
    return serveStatic({ root: options.planDir })(c, next);
  });
};
