import type { ScenePlan } from "@dalang/core";
import type { FrameLayout } from "./layout";

/**
 * Musik latar (ADR-0014) — mengimplementasikan `plan.audio.music` yang sudah
 * dicadangkan skema §5.1 sejak v0. Bed musik di-loop sepanjang video dengan:
 *  - fade-in/fade-out global,
 *  - DUCKING otomatis di bawah scene bernarasi (ramp kosinus halus),
 * semuanya deterministik per frame — preview Player dan render final identik.
 */

export interface BundledMusic {
  id: string;
  /** Path relatif public dir templates (dipakai staticFile). */
  file: string;
  label: string;
}

/**
 * Pustaka ter-bundle (public/music/, CC0 — disintesis deterministik, lihat
 * LICENSE.md). Dirujuk dari plan sebagai assetId "pustaka:<id>".
 */
export const BUNDLED_MUSIC: readonly BundledMusic[] = [
  { id: "tenang", file: "music/tenang.wav", label: "Tenang (pad hangat)" },
  { id: "cerah", file: "music/cerah.wav", label: "Cerah (pad mayor)" },
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
    return found ? { file: found.file, bundled: true } : null;
  }
  return { file: assetId, bundled: false };
};

const FADE_IN_FRAMES = 30;
const FADE_OUT_FRAMES = 60;
const DUCK_RAMP_FRAMES = 15;
/** Faktor volume saat narasi berbicara. */
const DUCK_FACTOR = 0.35;

const cosRamp = (t: number): number => {
  const clamped = Math.min(Math.max(t, 0), 1);
  return 0.5 - 0.5 * Math.cos(clamped * Math.PI);
};

/**
 * Envelope volume musik per frame global.
 * Jendela duck = rentang scene yang PUNYA audio narasi di renderState dan
 * naskahnya tidak kosong; ramp turun/naik kosinus di tepinya.
 */
export const buildMusicVolume = (
  plan: ScenePlan,
  layout: FrameLayout,
): ((frame: number) => number) => {
  const music = plan.audio.music;
  if (!music) return () => 0;
  const base = music.volume;

  const duckWindows: Array<{ from: number; to: number }> = [];
  if (music.ducking) {
    plan.scenes.forEach((scene, index) => {
      if (scene.narration.trim() === "") return;
      if (!plan.renderState.narrationAudio[scene.id]) return;
      const from = layout.sceneStarts[index] ?? 0;
      duckWindows.push({ from, to: from + (layout.sceneFrames[index] ?? 0) });
    });
  }

  return (frame: number): number => {
    const fadeIn = cosRamp(frame / FADE_IN_FRAMES);
    const fadeOut = cosRamp((layout.totalFrames - frame) / FADE_OUT_FRAMES);

    let duck = 1;
    for (const w of duckWindows) {
      if (frame < w.from - DUCK_RAMP_FRAMES || frame > w.to + DUCK_RAMP_FRAMES) {
        continue;
      }
      const enter = cosRamp((frame - (w.from - DUCK_RAMP_FRAMES)) / DUCK_RAMP_FRAMES);
      const exit = cosRamp((w.to + DUCK_RAMP_FRAMES - frame) / DUCK_RAMP_FRAMES);
      const depth = Math.min(enter, exit);
      duck = Math.min(duck, 1 - depth * (1 - DUCK_FACTOR));
    }

    return Math.max(0, base * fadeIn * fadeOut * duck);
  };
};
