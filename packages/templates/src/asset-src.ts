import { createContext, useCallback, useContext } from "react";
import { staticFile } from "remotion";

/**
 * Dari mana berkas sebuah render diambil (ADR-0019).
 *
 * DUA JENIS BERKAS, DUA NASIB YANG BERBEDA — dan membedakannya adalah inti
 * dari seluruh modul ini:
 *
 *  - **Aset situs** (font ter-vendor, bed musik pustaka) ikut ter-bundle
 *    bersama komposisinya. Ia sama untuk semua proyek, jadi ia tetap memakai
 *    `staticFile()` di mana pun render berjalan.
 *  - **Aset plan** (suara narasi, footage ter-resolve, ikon, stiker, efek
 *    suara, musik unggahan) berbeda untuk setiap proyek dan setiap render.
 *
 * Di render lokal keduanya sama saja: `copyPlanAssets` menumpuk aset plan ke
 * dalam public dir bundle, jadi `staticFile()` menemukan keduanya. Di render
 * cloud tidak: situsnya dipasang SEKALI lalu dipakai berkali-kali, sehingga
 * menyisipkan aset plan ke dalamnya berarti memasang ulang seluruh situs untuk
 * setiap render. Karena itu aset plan dialamatkan lewat URL dasar yang
 * diberikan saat render, bukan lewat public dir.
 *
 * Nilai bawaannya null, artinya "pakai staticFile" — jadi preview Player dan
 * render lokal berjalan persis seperti sebelumnya tanpa mengetahui modul ini
 * ada.
 */

const AssetBaseUrlContext = createContext<string | null>(null);

export const AssetBaseUrlProvider = AssetBaseUrlContext.Provider;

/**
 * Gabungkan URL dasar dengan path aset relatif terhadap plan.
 *
 * Murni supaya bisa diuji sebagai string, bukan diperiksa dengan mata di
 * video. Setiap segmen di-encode: nama dari layanan luar sudah dibersihkan
 * saat disimpan, tetapi plan boleh disunting tangan dan URL yang rusak akan
 * gagal diam-diam sebagai berkas yang tidak ditemukan.
 */
export const joinAssetUrl = (baseUrl: string, file: string): string => {
  const segments = file.split("/").filter((part) => part !== "" && part !== ".");
  if (segments.includes("..")) {
    // Backstop: staging sudah menolak ini, tetapi sebuah plan yang disunting
    // tangan tidak boleh bisa menyusun URL ke luar folder asetnya.
    throw new Error(`Path aset tidak boleh memuat "..": "${file}"`);
  }
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return base + segments.map(encodeURIComponent).join("/");
};

/** Pengalamat aset PLAN untuk render yang sedang berjalan. */
export const useAssetSrc = (): ((file: string) => string) => {
  const baseUrl = useContext(AssetBaseUrlContext);
  return useCallback(
    (file: string) => (baseUrl === null ? staticFile(file) : joinAssetUrl(baseUrl, file)),
    [baseUrl],
  );
};
