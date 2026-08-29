import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";

/**
 * Penyaji media untuk @remotion/player. Di luar bundler Remotion,
 * `staticFile("x")` mengembalikan path root `/x` (diverifikasi dari source
 * remotion 4.0.518) — jadi cukup mount:
 *
 *   /fonts/*                    → templates/public (font vendored)
 *   /assets/*                   → folder plan (aset lokal proyek)
 *   /.dalang/{tts,assets,renders}/* → keluaran pipeline & render
 *
 * dan komponen preset berjalan APA ADANYA di Player (tanpa perubahan).
 * File privat `.dalang` lain (pipeline.db, chat-history.json, patch-log.json)
 * TIDAK pernah tersaji. serveStatic menolak `..`/backslash setelah decode dan
 * mendukung Range 206 (dibutuhkan seeking audio/video).
 */

const DALANG_PUBLIC = /^\/\.dalang\/(tts|assets|renders)\//;

export const registerMedia = (
  app: Hono,
  options: { templatesPublicDir: string; planDir: string },
): void => {
  app.use("/fonts/*", serveStatic({ root: options.templatesPublicDir }));
  app.use("/assets/*", serveStatic({ root: options.planDir }));
  app.use("/.dalang/*", async (c, next) => {
    if (!DALANG_PUBLIC.test(c.req.path)) {
      return c.json({ error: "Tidak tersedia" }, 404);
    }
    return serveStatic({ root: options.planDir })(c, next);
  });
};
