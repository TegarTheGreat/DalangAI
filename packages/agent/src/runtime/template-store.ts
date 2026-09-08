import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BUILT_IN_TEMPLATES, parseTemplatePack, type TemplatePack } from "@dalang/core";
import { atomicWriteFile } from "@dalang/pipeline";

/**
 * Registri template terpasang (ADR-0037, roadmap §10.2).
 *
 * Satu folder di rumah Dalang (`$DALANG_HOME/templates`, bawaan
 * `~/.dalang/templates`), satu berkas JSON per template. Bentuk yang sama
 * dengan memori preferensi (ADR-0029), dan alasannya juga sama: template
 * adalah milik ORANGNYA, bukan milik satu folder proyek — yang memasang
 * template lalu membuat proyek di folder lain tetap melihatnya.
 *
 * Folder biasa berisi JSON, bukan basis data. Yang dipertaruhkan kecil dan
 * yang didapat besar: template bisa disalin, dikirim lewat surel, dimasukkan
 * git, dan dibaca mata — tiga hal yang paling dibutuhkan barang yang memang
 * untuk dibagikan.
 */

export interface InstalledTemplate {
  pack: TemplatePack;
  /** Path berkasnya; null untuk template bawaan yang ikut dengan Dalang. */
  file: string | null;
  builtIn: boolean;
}

/** Berkas di folder registri yang gagal dibaca, berikut sebabnya. */
export interface BrokenTemplate {
  file: string;
  reason: string;
}

export const defaultTemplateDir = (env: NodeJS.ProcessEnv = process.env): string =>
  join(env.DALANG_HOME ?? join(homedir(), ".dalang"), "templates");

/**
 * Semua template yang bisa dipakai: bawaan lebih dulu, lalu yang terpasang.
 *
 * Berkas rusak TIDAK menggagalkan daftarnya — ia dilaporkan terpisah. Satu
 * template salah ketik yang membuat seluruh daftar kosong akan terbaca sebagai
 * "fitur ini tidak jalan", dan yang sebenarnya rusak cuma satu berkas.
 *
 * Template terpasang yang id-nya sama dengan bawaan MENANG: pemakai yang
 * sengaja memasang versinya sendiri sedang menyatakan pilihan, dan registri
 * yang tetap mengembalikan bawaan akan terlihat seperti pemasangannya gagal.
 */
export const listTemplates = (
  dir: string,
): { templates: InstalledTemplate[]; broken: BrokenTemplate[] } => {
  const installed: InstalledTemplate[] = [];
  const broken: BrokenTemplate[] = [];

  if (existsSync(dir)) {
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith(".json")) continue;
      const file = join(dir, name);
      try {
        installed.push({
          pack: parseTemplatePack(JSON.parse(readFileSync(file, "utf8"))),
          file,
          builtIn: false,
        });
      } catch (error) {
        broken.push({ file, reason: (error as Error).message.split("\n")[0] ?? "rusak" });
      }
    }
  }

  const overridden = new Set(installed.map((item) => item.pack.manifest.id));
  const builtIn = BUILT_IN_TEMPLATES.filter(
    (pack) => !overridden.has(pack.manifest.id),
  ).map((pack) => ({ pack, file: null, builtIn: true }));

  return { templates: [...builtIn, ...installed], broken };
};

export const findTemplate = (dir: string, id: string): InstalledTemplate | undefined =>
  listTemplates(dir).templates.find((item) => item.pack.manifest.id === id);

/**
 * Pasang sebuah paket. Nama berkasnya dari `manifest.id`, yang skema-nya sudah
 * batasi ke huruf kecil, angka, dan tanda hubung — jadi tidak ada paket yang
 * bisa menulis ke `../../` betapa pun isinya.
 */
export const installTemplate = (dir: string, pack: TemplatePack): string => {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${pack.manifest.id}.json`);
  atomicWriteFile(file, `${JSON.stringify(pack, null, 2)}\n`);
  return file;
};

/**
 * Copot template terpasang. Yang BAWAAN tidak bisa dicopot dan mengatakannya:
 * gagal diam-diam di sini berarti orang mengira template-nya hilang lalu
 * bingung kenapa ia muncul lagi.
 */
export const removeTemplate = (dir: string, id: string): { removed: string } => {
  const file = join(dir, `${id}.json`);
  if (!existsSync(file)) {
    const builtIn = BUILT_IN_TEMPLATES.some((pack) => pack.manifest.id === id);
    throw new Error(
      builtIn
        ? `Template "${id}" adalah bawaan Dalang dan tidak bisa dicopot. Pasang template lain dengan id yang sama untuk menggantinya.`
        : `Template "${id}" tidak terpasang.`,
    );
  }
  rmSync(file);
  return { removed: file };
};
