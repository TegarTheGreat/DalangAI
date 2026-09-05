import {
  primaryClip,
  type Scene,
  type ScenePlan,
  type WordTimestamp,
} from "./scene-plan";
import { countSyllables, SYLLABLES_PER_SECOND } from "./syllables";

/**
 * Deterministic timing resolution (PRD §7: AI plans, execution is
 * deterministic). Given the same plan + renderState, timings are always
 * identical — no model involved.
 *
 * Rules for `duration: "auto"`:
 *  1. If TTS audio exists for the scene → audio duration + padding.
 *  2. Else → estimate from narration SYLLABLE count (ADR-0017). Indonesian
 *     word length varies enormously through affixation, so counting words
 *     underestimates affix-heavy or number-bearing narration; see
 *     `syllables.ts` for the measured basis.
 *  3. Text-free scenes (e.g. template-anim without narration) get a fixed
 *     sensible default.
 */

/**
 * Legacy word-based pace, kept only as a documented reference point for the
 * calibration note in `syllables.ts`. Timing no longer uses it.
 */
export const WORDS_PER_SECOND = 2.4;
/** Breathing room appended after the narration ends. */
export const SCENE_PADDING_SEC = 0.7;
/** Silence before the narration starts inside a scene. */
export const NARRATION_LEAD_IN_SEC = 0.25;
export const MIN_SCENE_SEC = 2.2;
/** Duration for narration-less scenes (title cards, dividers). */
export const SILENT_SCENE_SEC = 3;

export const countWords = (text: string): number =>
  text.trim().split(/\s+/).filter(Boolean).length;

export const estimateNarrationSeconds = (narration: string, speed = 1): number => {
  const syllables = countSyllables(narration);
  if (syllables === 0) return 0;
  return syllables / (SYLLABLES_PER_SECOND * speed);
};

/**
 * Jumlah durasi klip sebuah scene (ADR-0033 §2).
 *
 * Berarti HANYA saat klipnya lebih dari satu; klip tunggal mengisi seluruh
 * scene dan `durationSec`-nya memang diabaikan.
 */
export const sumClipDurationsSec = (scene: Scene): number =>
  scene.clips.reduce((total, clip) => total + (clip.durationSec ?? 0), 0);

export const resolveSceneDurationSec = (scene: Scene, plan: ScenePlan): number => {
  /**
   * ADR-0033 §2 — begitu ada dua klip, waktu datang dari POTONGANNYA. Ini
   * diperiksa lebih dulu daripada `scene.duration` bukan karena keduanya bisa
   * bersaing (skema menolak angka tetap bersamaan dengan klip jamak), tapi
   * supaya urutan bacanya sama dengan urutan aturannya: potongan dulu, baru
   * yang lain.
   */
  if (scene.clips.length > 1) return sumClipDurationsSec(scene);
  if (typeof scene.duration === "number") return scene.duration;

  const audio = plan.renderState.narrationAudio[scene.id];
  const speed = plan.audio.voice?.speed ?? 1;
  const narrationSec = audio
    ? audio.durationSec
    : estimateNarrationSeconds(scene.narration, speed);

  if (narrationSec === 0) return SILENT_SCENE_SEC;
  return Math.max(
    MIN_SCENE_SEC,
    NARRATION_LEAD_IN_SEC + narrationSec + SCENE_PADDING_SEC,
  );
};

export interface SceneTiming {
  id: string;
  index: number;
  startSec: number;
  durationSec: number;
}

/** Letak satu klip di dalam scene-nya; `startSec` dihitung dari AWAL SCENE. */
export interface ClipTiming {
  id: string;
  index: number;
  startSec: number;
  durationSec: number;
}

/**
 * Susunan klip di dalam satu scene (ADR-0033 §2).
 *
 * Satu klip mengisi SELURUH scene — `durationSec`-nya diabaikan, persis
 * perilaku sebelum klip ada. Dua klip atau lebih memakai durasi masing-masing,
 * dan jumlahnya adalah durasi scene itu sendiri.
 *
 * `sceneDurationSec` diterima sebagai argumen, bukan dihitung ulang di sini,
 * supaya pemanggil yang sudah punya linimasa scene tidak menghitung dua kali —
 * dan supaya renderer bisa memberi durasi yang sudah dibulatkan ke bingkai.
 */
export const computeClipTimings = (
  scene: Scene,
  sceneDurationSec: number,
): ClipTiming[] => {
  if (scene.clips.length === 1) {
    return [
      {
        id: primaryClip(scene).id,
        index: 0,
        startSec: 0,
        durationSec: sceneDurationSec,
      },
    ];
  }
  let cursor = 0;
  return scene.clips.map((clip, index) => {
    const durationSec = clip.durationSec ?? 0;
    const timing: ClipTiming = { id: clip.id, index, startSec: cursor, durationSec };
    cursor += durationSec;
    return timing;
  });
};

export interface Timeline {
  timings: SceneTiming[];
  totalSec: number;
}

/**
 * Sequential timeline without transition overlap. Presets that crossfade
 * scenes compute their own overlapped frame layout from these durations.
 */
export const computeTimeline = (plan: ScenePlan): Timeline => {
  let cursor = 0;
  const timings = plan.scenes.map((scene, index) => {
    const durationSec = resolveSceneDurationSec(scene, plan);
    const timing: SceneTiming = {
      id: scene.id,
      index,
      startSec: cursor,
      durationSec,
    };
    cursor += durationSec;
    return timing;
  });
  return { timings, totalSec: cursor };
};

/**
 * The narration window inside a scene: how many seconds of speech fit between
 * the lead-in and the closing padding. Presets use this both to place real TTS
 * audio and to size estimated timestamps, so the two paths stay in sync.
 */
export const narrationWindowSec = (sceneDurationSec: number): number =>
  Math.max(0.5, sceneDurationSec - NARRATION_LEAD_IN_SEC - SCENE_PADDING_SEC * 0.5);

/**
 * Synthetic word timestamps for caption sync before real TTS timestamps exist
 * (or when a provider has none — see R-3). Words are allocated proportionally
 * to their character length across `availableSec`.
 *
 * CONTRACT: timestamps are relative to the start of the narration itself
 * (0-based) — the same frame of reference as real TTS word timestamps, which
 * are relative to the audio file. Placement inside the scene (the lead-in
 * offset) is the preset's responsibility, so real and estimated timestamps are
 * interchangeable.
 */
export const estimateWordTimestamps = (
  narration: string,
  availableSec: number,
): WordTimestamp[] => {
  const words = narration.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const windowSec = Math.max(availableSec, 0.5);
  const weights = words.map((word) => word.length + 1);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  let cursor = 0;
  return words.map((word, index) => {
    const share = (weights[index] ?? 1) / totalWeight;
    const startSec = cursor;
    const endSec = index === words.length - 1 ? windowSec : cursor + share * windowSec;
    cursor = endSec;
    return {
      word,
      startSec: Number(startSec.toFixed(3)),
      endSec: Number(endSec.toFixed(3)),
    };
  });
};
