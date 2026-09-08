import type { SfxCandidate, SfxProvider } from "@dalang/pipeline";
import { type FetchImpl, fetchBytes, fetchJson } from "../http";

/**
 * Openverse (WordPress Foundation) — efek suara berlisensi terbuka lewat API
 * RESMI, kunci OPSIONAL (ADR-0018).
 *
 * Dipilih menggantikan MyInstants, yang tidak punya API resmi, yang syarat
 * pakainya membatasi ke penggunaan pribadi non-komersial, dan yang isinya
 * potongan game/film/musik milik pihak lain — MyInstants sendiri host, bukan
 * pemilik, jadi ia tidak bisa melisensikan apa pun kepada kita.
 *
 * Openverse juga lebih bersih daripada Freesound untuk kasus ini: lisensi
 * SUARA di Freesound boleh saja CC0, tetapi syarat pemakaian API-nya sendiri
 * gratis hanya untuk keperluan NON-KOMERSIAL. Openverse tidak punya batasan
 * itu, dan malah menyediakan string kredit siap tempel.
 */

export const OPENVERSE_BASE_URL = "https://api.openverse.org/v1";

/**
 * Bawaan paling aman: hanya CC0 dan Public Domain Mark — bebas dipakai
 * komersial, tanpa kewajiban kredit, tanpa syarat berbagi-serupa.
 */
export const OPENVERSE_SAFE_LICENSES = "cc0,pdm";

interface OpenverseAudio {
  id?: string;
  title?: string;
  url?: string;
  license?: string;
  license_version?: string;
  license_url?: string;
  /** String kredit siap tempel yang disusun Openverse sendiri. */
  attribution?: string;
  creator?: string;
  foreign_landing_url?: string;
  filetype?: string;
  duration?: number;
  alt_files?: Array<{ url?: string; filetype?: string }>;
}

/** Lisensi yang mengandung "nc" tidak boleh masuk video komersial. */
const isCommercialSafe = (license: string): boolean =>
  license !== "" && !license.toLowerCase().includes("nc");

/** Openverse memberi durasi dalam MILIDETIK. */
const toSeconds = (durationMs: number | undefined): number | undefined =>
  typeof durationMs === "number" && durationMs > 0
    ? Number((durationMs / 1000).toFixed(2))
    : undefined;

export interface OpenverseOptions {
  /** Opsional — hanya menaikkan batas laju, tidak membuka fitur. */
  accessToken?: string;
  licenses?: string;
  baseUrl?: string;
  fetchImpl?: FetchImpl;
}

export const createOpenverseSfx = ({
  accessToken,
  licenses = OPENVERSE_SAFE_LICENSES,
  baseUrl = OPENVERSE_BASE_URL,
  fetchImpl,
}: OpenverseOptions = {}): SfxProvider => {
  const headers: Record<string, string> = accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : {};

  const search = async (query: string, limit: number): Promise<SfxCandidate[]> => {
    const params = new URLSearchParams({
      q: query,
      license: licenses,
      page_size: String(Math.min(Math.max(limit, 1), 20)),
    });
    const json = await fetchJson<{ results?: OpenverseAudio[] }>(
      `${baseUrl}/audio/?${params}`,
      { headers },
      "Openverse audio",
      { fetchImpl },
    );

    const candidates: SfxCandidate[] = [];
    for (const audio of json.results ?? []) {
      if (!audio.id || !audio.url) continue;
      const license = audio.license ?? "";
      // Sabuk pengaman kedua: walau permintaan sudah menyaring lisensi, hasil
      // yang tidak aman tetap dibuang di sisi kita.
      if (!isCommercialSafe(license)) continue;
      const durationSec = toSeconds(audio.duration);
      candidates.push({
        providerId: "openverse",
        assetId: `openverse:${audio.id}`,
        title: audio.title ?? audio.id,
        downloadUrl: audio.url,
        fileExt: (audio.filetype ?? "mp3").toLowerCase(),
        ...(durationSec === undefined ? {} : { durationSec }),
        license: audio.license_version ? `${license} ${audio.license_version}` : license,
        ...(audio.attribution ? { attribution: audio.attribution } : {}),
        ...(audio.creator ? { author: audio.creator } : {}),
        ...(audio.foreign_landing_url ? { sourceUrl: audio.foreign_landing_url } : {}),
        commercialSafe: true,
      });
      if (candidates.length >= limit) break;
    }
    return candidates;
  };

  return {
    id: "openverse",
    label: "Openverse",
    search,
    download: (candidate) =>
      fetchBytes(candidate.downloadUrl, { headers }, "Unduhan Openverse", { fetchImpl }),
  };
};
