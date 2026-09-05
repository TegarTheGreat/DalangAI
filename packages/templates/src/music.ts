import { loudnessGain, type ScenePlan } from "@dalang/core";
import { cosRamp, duckAt, duckWindows } from "./audio-model";
import type { FrameLayout } from "./layout";

/**
 * Musik latar (ADR-0014) — mengimplementasikan `plan.audio.music` yang sudah
 * dicadangkan skema §5.1 sejak v0. Bed musik di-loop sepanjang video dengan:
 *  - fade-in/fade-out global,
 *  - DUCKING otomatis di bawah scene bernarasi (ramp kosinus halus),
 * semuanya deterministik per frame — preview Player dan render final identik.
 *
 * Sejak ADR-0026 fade dan ducking-nya BUKAN lagi rumus milik berkas ini:
 * keduanya dipinjam dari `audio-model`, yang juga melayani suara aset visual,
 * lapisan, dan trek audio tambahan. Panjang fade juga tidak lagi konstanta —
 * ia datang dari `music.fadeInSec`/`fadeOutSec`, dengan bawaan yang sama
 * persis seperti konstanta lamanya.
 */

export interface BundledMusic {
  id: string;
  /** Path relatif public dir templates (dipakai staticFile). */
  file: string;
  label: string;
  /**
   * Kenyaringan terintegrasi bed ini, LUFS (ADR-0026).
   *
   * Angkanya DIUKUR, bukan ditaksir: bed pustaka disintesis deterministik dan
   * ikut di repo, jadi nilainya tetap selamanya — dan sebuah test mengukur
   * ulang berkasnya lalu menuntut angka ini cocok. Dengan begitu bed pustaka
   * tidak perlu melewati tahap ukur sama sekali.
   */
  lufs: number;
  /**
   * Kanal berkasnya. Bed pustaka MONO, dan itu bukan detail sepele: di
   * campuran stereo ia terdengar 3,01 LU lebih keras daripada angka ukurnya,
   * jadi tanpa keterangan ini setiap bed akan dinormalisasi 3 dB terlalu
   * keras terhadap sasaran proyek.
   */
  channels: number;
}

/**
 * Pustaka ter-bundle (public/music/, CC0 — disintesis deterministik, lihat
 * LICENSE.md). Dirujuk dari plan sebagai assetId "pustaka:<id>".
 */
export const BUNDLED_MUSIC: readonly BundledMusic[] = [
  {
    id: "tenang",
    file: "music/tenang.wav",
    label: "Tenang (pad hangat)",
    lufs: -18.71,
    channels: 1,
  },
  {
    id: "cerah",
    file: "music/cerah.wav",
    label: "Cerah (pad mayor)",
    lufs: -18.55,
    channels: 1,
  },
] as const;

export const MUSIC_LIBRARY_PREFIX = "pustaka:";

/**
 * Berkas musik hasil resolusi, beserta ASALNYA.
 *
 * `bundled` bukan detail administratif: bed pustaka ikut ter-bundle bersama
 * komposisi (aset situs), sedangkan musik unggahan hidup di folder proyek
 * (aset plan). Di render cloud keduanya dialamatkan dengan cara yang berbeda
 * (lihat `asset-src.ts`), jadi pemanggil harus bisa membedakannya.
 */
export interface ResolvedMusic {
  file: string;
  bundled: boolean;
  /** Hasil ukur kenyaringan bed pustaka; undefined untuk musik unggahan. */
  lufs?: number;
  channels?: number;
}

/**
 * assetId musik → berkas + asalnya, atau null bila id pustaka tidak dikenal
 * (komponen lalu tidak memutar apa-apa — tanpa crash render, tapi
 * validate/critique yang memberi tahu).
 */
export const resolveMusicFile = (assetId: string): ResolvedMusic | null => {
  if (assetId.startsWith(MUSIC_LIBRARY_PREFIX)) {
    const id = assetId.slice(MUSIC_LIBRARY_PREFIX.length);
    const found = BUNDLED_MUSIC.find((m) => m.id === id);
    return found
      ? { file: found.file, bundled: true, lufs: found.lufs, channels: found.channels }
      : null;
  }
  return { file: assetId, bundled: false };
};

/**
 * Envelope volume musik per frame GLOBAL (musik membentang seluruh video, jadi
 * di sini frame lokal dan frame global memang sama).
 *
 * `lufs` adalah hasil ukur bed-nya: bed pustaka membawanya di
 * `BUNDLED_MUSIC`, musik unggahan mendapatkannya dari tahap ukur. Tanpa hasil
 * ukur, normalisasi dilewati — bukan ditebak.
 */
export const buildMusicVolume = (
  plan: ScenePlan,
  layout: FrameLayout,
  fps: number,
  lufs?: number,
  channels?: number,
): ((frame: number) => number) => {
  const music = plan.audio.music;
  if (!music) return () => 0;
  const base =
    music.volume *
    (music.normalize ? loudnessGain(lufs, plan.meta.loudnessTarget, channels) : 1);
  if (base <= 0) return () => 0;

  const fadeInFrames = Math.round(music.fadeInSec * fps);
  const fadeOutFrames = Math.round(music.fadeOutSec * fps);
  const windows = music.ducking ? duckWindows(plan, layout) : [];

  return (frame: number): number => {
    const fadeIn = fadeInFrames > 0 ? cosRamp(frame / fadeInFrames) : 1;
    const fadeOut =
      fadeOutFrames > 0 ? cosRamp((layout.totalFrames - frame) / fadeOutFrames) : 1;
    const duck = windows.length > 0 ? duckAt(frame, windows) : 1;
    return Math.max(0, base * fadeIn * fadeOut * duck);
  };
};
