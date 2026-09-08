import type { IconCandidate, IconProvider } from "@dalang/pipeline";
import { type FetchImpl, fetchJson, fetchText } from "../http";

/**
 * Iconify — pustaka ikon terbuka lewat API PUBLIK TANPA KUNCI (ADR-0018).
 *
 * Dipilih menggantikan icon-icons.com, yang tidak punya API resmi dan yang
 * syarat pakainya justru melarang persis apa yang dibutuhkan integrasi:
 * akses lewat bot/script, memasukkan ikonnya ke database aplikasi, dan
 * menyajikannya untuk diunduh pengguna.
 *
 * JEBAKAN YANG HARUS DIJAGA KODE INI: lisensi Iconify melekat PER SET, bukan
 * per ikon, dan tidak semua set bebas. Dari 237 set yang ada, dua di antaranya
 * NonCommercial. Karena itu setiap kandidat membawa `commercialSafe`, dan
 * pencarian membuang set NonCommercial secara bawaan — supaya "gampang
 * dipakai" tidak pernah berarti "diam-diam melanggar".
 */

export const ICONIFY_BASE_URL = "https://api.iconify.design";

/**
 * SPDX yang aman untuk video komersial. Sengaja daftar-putih, bukan
 * daftar-hitam: lisensi baru yang belum dikenal diperlakukan sebagai TIDAK
 * aman sampai ditinjau, bukan sebaliknya.
 */
export const COMMERCIAL_SAFE_SPDX: readonly string[] = [
  "MIT",
  "Apache-2.0",
  "CC0-1.0",
  "ISC",
  "BSD-3-Clause",
  "BSD-2-Clause",
  "Unlicense",
  "OFL-1.1",
  "CC-BY-4.0",
  "CC-BY-3.0",
  "CC-BY-SA-4.0",
  "MPL-2.0",
];

/** Lisensi yang mewajibkan kredit ditampilkan. */
const ATTRIBUTION_SPDX = /^(CC-BY|OFL|Apache-2\.0|MPL)/i;

/**
 * Penanda NonCommercial. Diperiksa terpisah dan lebih dulu: apa pun yang
 * mengandung "-NC-" tidak boleh lolos walau kebetulan ada di daftar putih.
 */
const NON_COMMERCIAL = /-NC(-|$)|NonCommercial/i;

export interface IconifyLicense {
  title?: string;
  spdx?: string;
  url?: string;
}

export interface IconifyInfo {
  name?: string;
  author?: { name?: string; url?: string };
  license?: IconifyLicense;
}

/** Keputusan lisensi untuk satu set — murni, jadi bisa diuji sendiri. */
export const judgeIconLicense = (
  license: IconifyLicense | undefined,
): { commercialSafe: boolean; needsAttribution: boolean } => {
  const spdx = license?.spdx ?? "";
  const title = license?.title ?? "";
  if (NON_COMMERCIAL.test(spdx) || NON_COMMERCIAL.test(title)) {
    return { commercialSafe: false, needsAttribution: true };
  }
  const commercialSafe = COMMERCIAL_SAFE_SPDX.includes(spdx);
  return { commercialSafe, needsAttribution: ATTRIBUTION_SPDX.test(spdx) };
};

export interface IconifyOptions {
  baseUrl?: string;
  fetchImpl?: FetchImpl;
  /** Ikut sertakan set NonCommercial (bawaan: tidak). */
  includeNonCommercial?: boolean;
}

export const createIconifyIcons = ({
  baseUrl = ICONIFY_BASE_URL,
  fetchImpl,
  includeNonCommercial = false,
}: IconifyOptions = {}): IconProvider => {
  const search = async (query: string, limit: number): Promise<IconCandidate[]> => {
    const params = new URLSearchParams({
      query,
      // Iconify menolak limit di bawah 32.
      limit: String(Math.max(32, limit)),
    });
    const json = await fetchJson<{
      icons?: string[];
      collections?: Record<string, IconifyInfo | undefined>;
    }>(`${baseUrl}/search?${params}`, {}, "Iconify pencarian", { fetchImpl });

    const candidates: IconCandidate[] = [];
    for (const iconId of json.icons ?? []) {
      const setPrefix = iconId.split(":")[0] ?? "";
      const info = json.collections?.[setPrefix];
      const { commercialSafe, needsAttribution } = judgeIconLicense(info?.license);
      if (!commercialSafe && !includeNonCommercial) continue;
      candidates.push({
        providerId: "iconify",
        iconId,
        setPrefix,
        setName: info?.name ?? setPrefix,
        license: info?.license?.title ?? "tidak diketahui",
        ...(info?.license?.spdx ? { licenseSpdx: info.license.spdx } : {}),
        ...(info?.license?.url ? { licenseUrl: info.license.url } : {}),
        ...(info?.author?.name ? { author: info.author.name } : {}),
        ...(info?.author?.url ? { authorUrl: info.author.url } : {}),
        needsAttribution,
        commercialSafe,
      });
      if (candidates.length >= limit) break;
    }
    return candidates;
  };

  const fetchSvg = async (
    iconId: string,
    options: { color?: string; height?: number } = {},
  ): Promise<string> => {
    const [prefix, name] = iconId.split(":");
    if (!prefix || !name) {
      throw new Error(`Id ikon tidak sah: "${iconId}" (harus "set:nama")`);
    }
    const params = new URLSearchParams();
    // "#" WAJIB ter-encode; kalau tidak, semuanya jadi fragment URL.
    if (options.color) params.set("color", options.color);
    if (options.height) params.set("height", String(options.height));
    const query = params.toString();
    return fetchText(
      `${baseUrl}/${prefix}/${name}.svg${query ? `?${query}` : ""}`,
      {},
      "Iconify SVG",
      { fetchImpl },
    );
  };

  return { id: "iconify", label: "Iconify", search, fetchSvg };
};
