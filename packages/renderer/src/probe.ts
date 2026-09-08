import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getSilentParts, getVideoMetadata } from "@remotion/renderer";
import { assertSafeRelative } from "./stage";

/**
 * ADR-0017: baca metadata video lokal lewat ffprobe yang sudah dibundel
 * Remotion — tanpa dependensi biner tambahan.
 *
 * Path diperlakukan SAMA dengan aset renderState: relatif terhadap folder
 * plan, tanpa `..` dan tanpa path absolut, supaya sebuah plan tidak pernah
 * bisa membaca file di luar foldernya sendiri.
 */

export interface LocalVideoInfo {
  durationSec: number;
  width: number;
  height: number;
}

/** Resolusi path aset yang dipakai bersama semua pemeriksa media lokal. */
const safeAbsolute = (planPath: string, fileRelativeToPlan: string): string | null => {
  try {
    assertSafeRelative(fileRelativeToPlan);
  } catch {
    return null;
  }
  const absolute = join(dirname(resolve(planPath)), fileRelativeToPlan);
  return existsSync(absolute) ? absolute : null;
};

export const probeLocalVideo = async (
  planPath: string,
  fileRelativeToPlan: string,
): Promise<LocalVideoInfo | null> => {
  const absolute = safeAbsolute(planPath, fileRelativeToPlan);
  if (absolute === null) return null;
  try {
    const meta = await getVideoMetadata(absolute);
    if (!meta.durationInSeconds) return null;
    return {
      durationSec: meta.durationInSeconds,
      width: meta.width,
      height: meta.height,
    };
  } catch {
    return null;
  }
};

/** Satu rentang waktu di dalam rekaman. */
export interface MediaSpan {
  startSec: number;
  endSec: number;
}

export interface SilenceReport {
  durationSec: number;
  /** Jeda hening — kandidat titik potong alami. */
  silences: MediaSpan[];
  /** Rentang bersuara di antara jeda — kandidat potongan. */
  audible: MediaSpan[];
}

/**
 * Ambang bawaan untuk BICARA, bukan bawaan ffmpeg. Bawaan ffmpeg
 * (-60 dB / 2 detik) terlalu longgar: pada podcast ia hampir tidak pernah
 * menemukan apa pun karena ruangan selalu berdesir. -35 dB menangkap jeda
 * ruangan sungguhan, dan 0,35 detik kira-kira jeda antar kalimat penutur —
 * cukup panjang untuk batas potong, cukup pendek untuk tidak melewatkan
 * pergantian kalimat.
 */
export const SILENCE_NOISE_DB = -35;
export const SILENCE_MIN_SEC = 0.35;

/**
 * Cari jeda hening di sebuah rekaman (ADR-0017).
 *
 * BATAS YANG PERLU JUJUR: ini mengukur AMPLITUDO, bukan makna. Ia tahu di
 * mana orang berhenti bicara, TIDAK tahu apa yang dikatakan. Gunanya adalah
 * menempatkan batas potong pada jeda alami penutur alih-alih memotong di
 * tengah napas — bukan untuk memilih momen menarik. Memilih momen tetap
 * butuh transkrip dari manusia.
 */
export const detectSilence = async (
  planPath: string,
  fileRelativeToPlan: string,
  options: { noiseThresholdInDecibels?: number; minDurationInSeconds?: number } = {},
): Promise<SilenceReport | null> => {
  const absolute = safeAbsolute(planPath, fileRelativeToPlan);
  if (absolute === null) return null;
  try {
    const result = await getSilentParts({
      src: absolute,
      noiseThresholdInDecibels: options.noiseThresholdInDecibels ?? SILENCE_NOISE_DB,
      minDurationInSeconds: options.minDurationInSeconds ?? SILENCE_MIN_SEC,
      logLevel: "error",
    });
    const toSpan = (part: {
      startInSeconds: number;
      endInSeconds: number;
    }): MediaSpan => ({
      startSec: Number(part.startInSeconds.toFixed(3)),
      endSec: Number(part.endInSeconds.toFixed(3)),
    });
    return {
      durationSec: result.durationInSeconds,
      silences: result.silentParts.map(toSpan),
      audible: result.audibleParts.map(toSpan),
    };
  } catch {
    return null;
  }
};
