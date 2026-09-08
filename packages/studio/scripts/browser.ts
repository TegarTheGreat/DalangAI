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

/**
 * Ekspresi yang menunggu SEMUA animasi CSS selesai — dipakai kedua gerbang UI
 * lewat `page.evaluate`.
 *
 * Kenapa ada: `.inspector-panel` masuk dengan `drawer-in-right`, yang keyframe
 * awalnya `translate: 14px 0` selama 180 ms dengan `fill-mode: both`. Mengukur
 * di dalam jendela itu memberi kotak yang bergeser ke kanan, dan gerbang tata
 * letak pernah merah di CI dengan bunyi persis "panel Properti keluar layar
 * (+14px)" — angka keyframe-nya sendiri. Bukan cacat tata letak: cacat
 * PENGUKURAN yang balapan dengan animasi.
 *
 * Gerbang interaksi punya bahaya yang sama dan lebih buruk akibatnya: kotak
 * yang bergeser membuat pointer mendarat di tempat yang salah, jadi seretan
 * bisa meleset dari pegangannya tanpa satu pun pesan yang menjelaskan kenapa.
 *
 * Menunggu lewat `sleep` yang lebih panjang hanya menggeser peluangnya; yang
 * dipakai di sini janji `animation.finished` milik peramban, jadi ia menunggu
 * TEPAT selama animasinya berjalan. Animasi tak berujung (pemuat berputar)
 * dikecualikan — menunggunya berarti menggantung selamanya — dan seluruh
 * penantian dibatasi satu detik.
 *
 * Dibuktikan terpisah terhadap halaman beranimasi 700 ms berisi satu animasi
 * berujung dan satu yang tidak: ditunggu 698 ms, yang tak berujung dilewati,
 * dan kotak yang diukur bergeser 14 piksel ke tempatnya.
 */
export const SETTLE_ANIMATIONS = `(() => {
  const all = typeof document.getAnimations === "function" ? document.getAnimations() : [];
  const habis = all.filter((anim) => {
    const timing = anim.effect && anim.effect.getComputedTiming();
    return timing && Number.isFinite(timing.iterations) && Number.isFinite(timing.endTime);
  });
  return Promise.race([
    Promise.all(habis.map((anim) => anim.finished.catch(() => null))),
    new Promise((resolve) => setTimeout(resolve, 1000)),
  ]).then(() => habis.length);
})()`;
