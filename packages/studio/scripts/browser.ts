import { findBrowserExecutable } from "@dalang/renderer";
import { openBrowser } from "@remotion/renderer";

/**
 * Membuka Chromium untuk gerbang UI dengan PERCOBAAN ULANG. Di runner CI,
 * sambungan ke peramban sesekali tidak terbentuk dalam 25 detik tanpa sebab
 * yang ada di kode ini (pesan dbus di lognya derau) — dan satu percobaan yang
 * gagal tidak boleh berbiaya enam menit dan satu job merah. Chromium yang
 * SAMA dengan render smoke test, jadi CI tidak mengunduh peramban kedua.
 */
export const launchBrowser = async (
  attempts = 3,
): Promise<Awaited<ReturnType<typeof openBrowser>>> => {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await openBrowser("chrome", {
        logLevel: "error",
        browserExecutable: findBrowserExecutable() ?? null,
      });
    } catch (error) {
      lastError = error;
      const line = error instanceof Error ? error.message.split("\n")[0] : String(error);
      console.error(
        `  peramban gagal dibuka (percobaan ${attempt}/${attempts}): ${line}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

/**
 * Pastikan proses KELUAR setelah gerbang selesai atau gagal: server studio
 * yang masih hidup (mis. karena peramban gagal dibuka sebelum blok finally)
 * pernah menahan job CI sampai batas waktunya, enam menit untuk satu galat
 * yang sudah tercetak di detik ke-25. Timer di-unref: kalau loop sudah
 * kosong, proses keluar sendiri lebih dulu dengan kode yang sama.
 */
export const exitSoon = (): void => {
  setTimeout(() => process.exit(process.exitCode ?? 0), 1500).unref();
};
