import { type ClipAudio, loudnessGain, type ScenePlan } from "@dalang/core";
import type { FrameLayout } from "./layout";

/**
 * Amplop audio per klip (ADR-0026, roadmap §9.4).
 *
 * SATU implementasi untuk semua yang berbunyi: suara aset visual, suara
 * lapisan, trek audio tambahan, dan bed musik. Sebelum ini hanya musik yang
 * punya fade dan ducking, dan rumusnya terkubur di `music.ts` — sehingga
 * menambahkan suara ke B-roll berarti menyalin rumus itu, lalu punya dua
 * rumus yang harus tetap sama selamanya.
 *
 * Murni & deterministik per frame: preview di Player dan hasil render memakai
 * fungsi yang sama persis. Preview yang lebih keras daripada hasil render
 * adalah cacat yang tidak bisa DILIHAT, cuma didengar — biasanya setelah
 * videonya terlanjur diunggah.
 */

/** Ramp kosinus 0..1; lembut di kedua ujung, tanpa patahan yang terdengar. */
export const cosRamp = (t: number): number => {
  const clamped = Math.min(Math.max(t, 0), 1);
  return 0.5 - 0.5 * Math.cos(clamped * Math.PI);
};

/** Panjang landai naik/turun ducking, dalam frame. */
export const DUCK_RAMP_FRAMES = 15;
/** Faktor volume saat narasi berbicara. */
export const DUCK_FACTOR = 0.35;

export interface DuckWindow {
  from: number;
  to: number;
}

/**
 * Rentang frame GLOBAL tempat narasi berbunyi.
 *
 * Syaratnya dua-duanya: naskahnya tidak kosong DAN berkas narasinya sudah ada
 * di renderState. Scene yang naskahnya sudah ditulis tapi suaranya belum
 * dibuat tidak boleh membuat musik dan B-roll mengecil — di video itu akan
 * terdengar sebagai lubang yang tidak ada sebabnya.
 */
export const duckWindows = (plan: ScenePlan, layout: FrameLayout): DuckWindow[] => {
  const windows: DuckWindow[] = [];
  plan.scenes.forEach((scene, index) => {
    if (scene.narration.trim() === "") return;
    if (!plan.renderState.narrationAudio[scene.id]) return;
    const from = layout.sceneStarts[index] ?? 0;
    windows.push({ from, to: from + (layout.sceneFrames[index] ?? 0) });
  });
  return windows;
};

/** Faktor ducking pada satu frame global (1 = tidak diduck). */
export const duckAt = (frame: number, windows: readonly DuckWindow[]): number => {
  let duck = 1;
  for (const window of windows) {
    if (frame < window.from - DUCK_RAMP_FRAMES || frame > window.to + DUCK_RAMP_FRAMES) {
      continue;
    }
    const enter = cosRamp((frame - (window.from - DUCK_RAMP_FRAMES)) / DUCK_RAMP_FRAMES);
    const exit = cosRamp((window.to + DUCK_RAMP_FRAMES - frame) / DUCK_RAMP_FRAMES);
    const depth = Math.min(enter, exit);
    duck = Math.min(duck, 1 - depth * (1 - DUCK_FACTOR));
  }
  return duck;
};

export interface ClipVolumeOptions {
  audio: ClipAudio;
  /** Hasil ukur berkasnya; undefined = belum diukur, jadi tidak dinormalisasi. */
  lufs?: number | undefined;
  /** Kanal sumbernya saat diukur — mono naik 3,01 LU di campuran stereo. */
  channels?: number | undefined;
  targetLufs: number | null;
  /** Frame GLOBAL tempat klip ini mulai — ducking hidup di waktu global. */
  startFrame: number;
  /** Panjang klip dalam frame. */
  frames: number;
  fps: number;
  ducks: readonly DuckWindow[];
}

/**
 * Amplop volume satu klip sebagai fungsi frame LOKAL klipnya.
 *
 * Lokal, bukan global, karena itulah yang diberikan Remotion ke `volume` di
 * dalam sebuah `Sequence` — dan menyamakan keduanya adalah cara paling mudah
 * untuk mendapat fade yang menyala di detik yang salah. Ducking tetap dihitung
 * di waktu GLOBAL, jadi `startFrame` wajib.
 *
 * Urutannya: gain normalisasi (statis) x volume x fade x ducking. Normalisasi
 * lebih dulu supaya `volume` selalu berarti hal yang sama — "seberapa keras
 * dibanding sumber lain yang sudah disamakan", bukan "seberapa keras dibanding
 * berkas ini yang kebetulan direkam pelan".
 */
export const buildClipVolume = ({
  audio,
  lufs,
  channels,
  targetLufs,
  startFrame,
  frames,
  fps,
  ducks,
}: ClipVolumeOptions): ((frame: number) => number) => {
  const base =
    audio.volume * (audio.normalize ? loudnessGain(lufs, targetLufs, channels) : 1);
  if (base <= 0) return () => 0;

  const fadeInFrames = Math.round(audio.fadeInSec * fps);
  const fadeOutFrames = Math.round(audio.fadeOutSec * fps);
  const windows = audio.ducking ? ducks : [];

  return (frame: number): number => {
    const fadeIn = fadeInFrames > 0 ? cosRamp(frame / fadeInFrames) : 1;
    const fadeOut = fadeOutFrames > 0 ? cosRamp((frames - frame) / fadeOutFrames) : 1;
    const duck = windows.length > 0 ? duckAt(startFrame + frame, windows) : 1;
    // Remotion menolak volume negatif, dan pembulatan kosinus bisa menghasilkan
    // -0 di ujung; `max(0, ...)` menutup keduanya sekaligus.
    return Math.max(0, base * fadeIn * fadeOut * duck);
  };
};

/**
 * Volume narasi: HANYA penguatan normalisasi, tanpa amplop.
 *
 * Narasi tidak diberi fade dan tidak pernah diduck — ia justru yang membuat
 * segala sesuatu yang lain mengecil. Yang tetap dibutuhkannya adalah
 * normalisasi: suara TTS datang pada kenyaringan yang berbeda-beda antar
 * penyedia dan antar suara, dan itulah justru sumber yang PALING penting untuk
 * disamakan — semua level lain di video ditata relatif terhadapnya.
 *
 * Sempat tidak ada sama sekali: tahap ukur menuliskan `lufs` narasi ke
 * renderState, tapi tidak ada yang membacanya, sehingga satu-satunya sumber
 * yang tidak pernah dinormalisasi adalah yang paling banyak terdengar.
 */
export const narrationVolume = (
  plan: ScenePlan,
  narration: { lufs?: number | undefined; channels?: number | undefined } | undefined,
): number =>
  narration
    ? loudnessGain(narration.lufs, plan.meta.loudnessTarget, narration.channels)
    : 1;

/**
 * Apakah klip ini sama sekali tidak berbunyi.
 *
 * Dipakai untuk memasang `muted` alih-alih `volume={0}`: elemen media yang
 * ditandai bisu tidak perlu menyiapkan jalur audio sama sekali, dan itu
 * perbedaan nyata saat satu scene punya tiga pemutar video.
 */
export const isSilent = (audio: ClipAudio): boolean => audio.volume <= 0;
