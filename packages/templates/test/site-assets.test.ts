import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLIC_STAGING_DIR, SITE_ASSET_DIRS, templatesPublicDir } from "../src/paths";

/**
 * Penjaga pergeseran aset situs.
 *
 * Latar belakangnya nyata: `public/` berisi `fonts/` dan `music/`, renderer
 * menyalin keduanya, tetapi Studio hanya memasang `/fonts/*`. Akibatnya musik
 * latar berbunyi di hasil render dan 404 di preview — fitur yang tampak jadi,
 * separuh mati, dan tidak terlihat oleh satu pun test.
 *
 * Test ini membandingkan DAFTAR dengan ISI FOLDER yang sebenarnya, jadi
 * menambah sub-folder public baru tanpa mendaftarkannya akan gagal di sini,
 * bukan diam-diam hilang di preview.
 */

const publicDirs = (): string[] =>
  readdirSync(templatesPublicDir).filter((entry) =>
    statSync(join(templatesPublicDir, entry)).isDirectory(),
  );

describe("aset situs templates", () => {
  it("setiap sub-folder public terdaftar sebagai aset situs atau staging", () => {
    const known = new Set<string>([...SITE_ASSET_DIRS, PUBLIC_STAGING_DIR]);
    const unregistered = publicDirs().filter((dir) => !known.has(dir));
    expect(unregistered).toEqual([]);
  });

  it("setiap aset situs yang didaftarkan benar-benar ada", () => {
    const actual = new Set(publicDirs());
    for (const dir of SITE_ASSET_DIRS) {
      expect(actual.has(dir)).toBe(true);
    }
  });

  /** Staging demo bukan aset situs: isinya milik proyek yang sedang dibuka. */
  it("folder staging tidak ikut jadi aset situs", () => {
    expect((SITE_ASSET_DIRS as readonly string[]).includes(PUBLIC_STAGING_DIR)).toBe(
      false,
    );
  });
});
