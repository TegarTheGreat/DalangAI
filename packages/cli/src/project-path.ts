import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Satu aturan path proyek untuk SELURUH perintah.
 *
 * `dalang studio proyekku/` sudah menerima folder sejak awal, sementara
 * `render`/`validate`/`still`/`generate` menuntut `proyekku/plan.json` dan
 * menjawab "EISDIR" kalau diberi foldernya. Perbedaan itu tidak punya alasan:
 * satu proyek Dalang adalah satu folder, dan menyebut foldernya harus cukup
 * di mana pun.
 */
export const planPathOf = (pathArg: string): string => {
  const abs = resolve(pathArg);
  if (existsSync(abs) && statSync(abs).isDirectory()) return join(abs, "plan.json");
  return abs;
};
