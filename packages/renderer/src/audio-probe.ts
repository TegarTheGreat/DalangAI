import { readFileSync, writeFileSync } from "node:fs";
import {
  type AudioProbe,
  type AudioProbeResult,
  isPcmWav,
  wavFormatCode,
  wavFormatName,
} from "@dalang/pipeline";
import { extractAudio, openBrowser } from "@remotion/renderer";
import { findBrowserExecutable } from "./browser";

/**
 * Implementasi port `AudioProbe` (ADR-0026) di atas Remotion.
 *
 * Ada di paket renderer, bukan pipeline, karena di sinilah Remotion memang
 * sudah jadi dependensi. Pipeline hanya tahu portnya — jadi mengukur
 * kenyaringan tidak menyeret seluruh tumpukan render ke dalam tahap yang cuma
 * butuh PCM.
 *
 * BERLAPIS, dan urutannya bukan selera:
 *
 *   1. `extractAudio` milik Remotion. MURAH — tanpa browser — tapi ia
 *      MENYALIN ALIRAN, tidak mendekode ("It does not convert the audio to a
 *      different format", kata dokumennya sendiri). Untuk sumber WAV/PCM
 *      hasilnya PCM; untuk MP4 hasilnya AAC yang DIBUNGKUS kontainer WAV —
 *      berkas .wav yang sah dan sama sekali tidak bisa diukur. Karena itu
 *      keluarannya DIPERIKSA, bukan dipercaya.
 *   2. Chromium yang sudah dipakai merender, lewat `decodeAudioData`. Ia
 *      mendekode MP3, FLAC, Ogg/Opus, dan WAV di mana pun; AAC/MP4 hanya pada
 *      build ber-kodek proprietary (Chrome, dan Chrome Headless Shell yang
 *      diunduh Remotion sendiri) — Chromium biasa menolaknya.
 *   3. Menyerah dengan JUJUR: `{ ok: false, reason }`, bukan lemparan.
 *
 * Lapisan 1 sendirian pernah menjadi seluruh implementasi ini, dan komentarnya
 * mengklaim `extractAudio` menghasilkan PCM "dari media apa pun". Itu keliru,
 * dan akibatnya bukan hasil yang meleset sedikit melainkan tahap ukur yang
 * gagal untuk hampir semua materi nyata — stok video, musik MP3, keluaran TTS.
 */

/** Ambang kewarasan: WAV hasil salin-aliran jauh lebih kecil daripada PCM. */
const BROWSER_MAX_BYTES = 256 * 1024 * 1024;

interface PageLike {
  evaluate(script: string): Promise<unknown>;
  close(): Promise<void>;
}

interface BrowserLike {
  newPage(options: unknown): Promise<PageLike>;
  close(options: { silent: boolean }): Promise<void>;
}

type DecodeReply = { ok: true; wav: string } | { ok: false; reason: string };

/**
 * Dekoder yang dijalankan DI DALAM halaman, dikirim sebagai TEKS.
 *
 * Bukan sebagai fungsi. `page.evaluate(fn)` menyerialkan fungsinya dengan
 * `toString()`, dan yang ikut terserialkan adalah hasil transformasi
 * bundler — esbuild/tsx membungkus fungsi bernama dengan pembantu `__name`
 * yang tidak ada di dalam halaman. Hasilnya `ReferenceError: __name is not
 * defined` pada saat jalan, bukan saat kompilasi, dan hanya pada jalur yang
 * jarang dilewati. Teks tidak bisa ditransformasi diam-diam.
 *
 * PCM-nya dikembalikan utuh — semua kanal, laju aslinya — karena kenyaringan
 * stereo TIDAK sama dengan mono: dua kanal identik menjumlahkan daya, +3 LU.
 * Menggabungkan kanal di sini untuk menghemat transfer akan membuat seluruh
 * materi stereo dinormalisasi 3 dB terlalu keras.
 */
const decodeScript = (base64: string): string => `(async () => {
  const bin = atob(${JSON.stringify(base64)});
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  let audio;
  try {
    audio = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(bytes.buffer);
  } catch (error) {
    return { ok: false, reason: "Chromium tidak bisa mendekodenya (" + String(error) + ")" };
  }

  const channels = audio.numberOfChannels;
  const frames = audio.length;
  const dataBytes = frames * channels * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const tulis = (offset, teks) => {
    for (let i = 0; i < teks.length; i++) view.setUint8(offset + i, teks.charCodeAt(i));
  };
  tulis(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  tulis(8, "WAVE");
  tulis(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  tulis(36, "data");
  view.setUint32(40, dataBytes, true);

  const data = [];
  for (let i = 0; i < channels; i++) data.push(audio.getChannelData(i));
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const value = Math.max(-1, Math.min(1, data[channel][frame] || 0));
      view.setInt16(offset, Math.round(value * 32767), true);
      offset += 2;
    }
  }

  const out = new Uint8Array(buffer);
  let biner = "";
  for (let i = 0; i < out.length; i += 0x8000) {
    biner += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
  }
  return { ok: true, wav: btoa(biner) };
})()`;

export const remotionAudioProbe = (): AudioProbe => {
  // Browser dibuka MALAS dan dipakai ulang: sebagian besar proyek tidak pernah
  // membutuhkannya (narasi WAV), dan yang membutuhkannya biasanya butuh untuk
  // beberapa berkas sekaligus.
  let browser: BrowserLike | null = null;
  const ensurePage = async (): Promise<PageLike> => {
    browser ??= (await openBrowser("chrome", {
      logLevel: "error",
      browserExecutable: findBrowserExecutable(),
    })) as unknown as BrowserLike;
    return browser.newPage({ context: null, logLevel: "error", indent: false });
  };

  return {
    id: "remotion",

    toWav: async (sourcePath, wavPath): Promise<AudioProbeResult> => {
      // --- Lapisan 1: salin-aliran, lalu PERIKSA hasilnya ------------------
      let streamCopyFormat: number | null = null;
      try {
        await extractAudio({
          videoSource: sourcePath,
          audioOutput: wavPath,
          logLevel: "error",
        });
        const bytes = readFileSync(wavPath);
        if (isPcmWav(bytes)) return { ok: true };
        streamCopyFormat = wavFormatCode(bytes);
      } catch {
        // Berkas tanpa jalur audio sama sekali sampai di sini; lapisan
        // berikutnya akan mengatakannya dengan kalimat yang lebih berguna.
      }

      // --- Lapisan 2: dekode di Chromium -----------------------------------
      const source = readFileSync(sourcePath);
      if (source.byteLength > BROWSER_MAX_BYTES) {
        return {
          ok: false,
          reason: `berkasnya ${Math.round(source.byteLength / 1024 / 1024)} MB — terlalu besar untuk didekode lewat browser`,
        };
      }

      let page: PageLike | null = null;
      try {
        page = await ensurePage();
        const reply = (await page.evaluate(
          decodeScript(source.toString("base64")),
        )) as DecodeReply;
        if (!reply.ok) {
          const asal =
            streamCopyFormat !== null
              ? `audionya ${wavFormatName(streamCopyFormat)}; `
              : "";
          return { ok: false, reason: `${asal}${reply.reason}` };
        }
        writeFileSync(wavPath, Buffer.from(reply.wav, "base64"));
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          reason: `gagal mendekode lewat browser: ${error instanceof Error ? error.message : String(error)}`,
        };
      } finally {
        await page?.close().catch(() => undefined);
      }
    },

    close: async () => {
      await browser?.close({ silent: true }).catch(() => undefined);
      browser = null;
    },
  };
};
