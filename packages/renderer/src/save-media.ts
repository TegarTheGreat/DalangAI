import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { assertSafeRelative } from "./stage";

/**
 * Simpan satu berkas media ke dalam folder proyek dan kembalikan path
 * relatifnya terhadap plan (ADR-0018).
 *
 * Menerima dua bentuk sumber:
 *  - `data:` URI — dipakai untuk SVG ikon, yang isinya sudah di tangan dan
 *    tidak perlu perjalanan jaringan kedua;
 *  - http(s) — diunduh.
 *
 * Nama berkas SELALU dibersihkan dan hasil akhirnya diperiksa ulang dengan
 * `assertSafeRelative`, sehingga nama dari layanan luar tidak pernah bisa
 * menulis ke luar folder proyek.
 */

/** Ambang wajar untuk aset tempelan; melindungi dari unduhan raksasa. */
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

/**
 * Bersihkan satu SEGMEN path.
 *
 * Titik di awal dibuang lebih dulu, dan itu bukan kosmetik: tanpa langkah itu
 * nilai "." atau ".." lolos utuh sebagai segmen, sehingga `assets/../x.svg`
 * memindahkan berkas keluar dari folder assets ke akar proyek. Batas PROYEK
 * tetap dijaga `assertSafeRelative`, tapi berkas media tidak boleh bisa
 * dialihkan lokasinya oleh nama yang datang dari layanan luar.
 */
const sanitize = (name: string): string => {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[.-]+/, "")
    .replace(/-+$/g, "")
    .slice(0, 80);
  return cleaned === "" ? "aset" : cleaned;
};

const decodeDataUri = (url: string): Uint8Array => {
  const comma = url.indexOf(",");
  if (comma === -1) throw new Error("data URI tidak sah");
  const meta = url.slice(0, comma);
  const payload = url.slice(comma + 1);
  if (meta.includes(";base64")) {
    return new Uint8Array(Buffer.from(payload, "base64"));
  }
  return new Uint8Array(Buffer.from(decodeURIComponent(payload), "utf8"));
};

export interface SaveMediaOptions {
  planPath: string;
  url: string;
  /** Sub-folder di bawah `assets/`, mis. "icons" atau "sfx". */
  folder: string;
  name: string;
  fileExt: string;
  fetchImpl?: typeof fetch;
}

export const saveMediaToProject = async ({
  planPath,
  url,
  folder,
  name,
  fileExt,
  fetchImpl = fetch,
}: SaveMediaOptions): Promise<string> => {
  const relative = `assets/${sanitize(folder)}/${sanitize(name)}.${sanitize(fileExt)}`;
  // Sabuk pengaman: nama dari layanan luar tidak boleh keluar folder proyek.
  assertSafeRelative(relative);

  const absolute = join(dirname(resolve(planPath)), relative);
  mkdirSync(dirname(absolute), { recursive: true });

  let bytes: Uint8Array;
  if (url.startsWith("data:")) {
    bytes = decodeDataUri(url);
  } else {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) {
      throw new Error(`Unduhan media HTTP ${response.status} untuk ${url}`);
    }
    bytes = new Uint8Array(await response.arrayBuffer());
  }

  if (bytes.byteLength === 0) throw new Error(`Berkas kosong dari ${url}`);
  if (bytes.byteLength > MAX_MEDIA_BYTES) {
    throw new Error(
      `Berkas ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB melebihi batas ${MAX_MEDIA_BYTES / 1024 / 1024} MB`,
    );
  }

  writeFileSync(absolute, bytes);
  return relative;
};
