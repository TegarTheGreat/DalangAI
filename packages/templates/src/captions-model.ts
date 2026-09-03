import {
  estimateWordTimestamps,
  NARRATION_LEAD_IN_SEC,
  narrationWindowSec,
  primaryClip,
  type Scene,
  type ScenePlan,
  transcriptForScene,
  transcriptToWordTimestamps,
  type WordTimestamp,
} from "@dalang/core";
import {
  createTikTokStyleCaptions,
  type Caption as RemotionCaption,
} from "@remotion/captions";

/**
 * Pure caption timing model — no React, fully unit-tested.
 *
 * Word timestamps are audio-relative (0-based, see the core contract). This
 * module owns the placement inside the scene: everything is shifted by the
 * narration lead-in, identically for real TTS timestamps and for the
 * deterministic estimate — so swapping the estimate for real TTS output in
 * Fase 1 changes timing fidelity, never the code path.
 */

export const PAGE_COMBINE_MS = 1100;
/** How long the last page lingers after the narration ends. */
export const LAST_PAGE_HOLD_FRAMES = 14;

export interface CaptionToken {
  text: string;
  /** Scene-relative milliseconds. */
  fromMs: number;
  toMs: number;
}

export interface CaptionPageModel {
  /** Scene-relative frame the page appears on. */
  startFrame: number;
  durationInFrames: number;
  /** Scene-relative milliseconds — compare against elapsed scene time. */
  startMs: number;
  tokens: CaptionToken[];
}

const toRemotionCaptions = (
  words: WordTimestamp[],
  offsetMs: number,
): RemotionCaption[] =>
  words.map((word, index) => ({
    text: `${index === 0 ? "" : " "}${word.word}`,
    startMs: word.startSec * 1000 + offsetMs,
    endMs: word.endSec * 1000 + offsetMs,
    timestampMs: ((word.startSec + word.endSec) / 2) * 1000 + offsetMs,
    confidence: null,
  }));

/**
 * Dari mana kata-kata caption datang, dan dengan geseran berapa (ADR-0021).
 *
 * Ada TIGA sumber, dan urutannya bukan selera:
 *
 *  1. word timestamp TTS — narasi yang Dalang buat sendiri, paling tepat;
 *  2. estimasi deterministik dari teks narasi — dipakai sebelum TTS jalan;
 *  3. TRANSKRIP rekaman — satu-satunya sumber untuk scene yang menampilkan
 *     orang bicara tanpa narasi tulis. Inilah "caption untuk footage orang".
 *
 * Geserannya beda: narasi disisipkan setelah jeda pembuka (NARRATION_LEAD_IN),
 * sedangkan rekaman sudah berbunyi sejak frame pertama scene — memberinya
 * geseran yang sama akan membuat caption tertinggal sekian ratus milidetik dari
 * bibir orangnya.
 */
const captionWords = (
  scene: Scene,
  plan: ScenePlan,
  sceneDurationFrames: number,
  fps: number,
): { words: WordTimestamp[]; offsetMs: number } => {
  if (scene.narration.trim() !== "") {
    const real = plan.renderState.narrationAudio[scene.id]?.wordTimestamps;
    return {
      words:
        real && real.length > 0
          ? real
          : estimateWordTimestamps(
              scene.narration,
              narrationWindowSec(sceneDurationFrames / fps),
            ),
      offsetMs: NARRATION_LEAD_IN_SEC * 1000,
    };
  }

  const transcript = transcriptForScene(plan, scene.id);
  if (!transcript) return { words: [], offsetMs: 0 };

  const speed = primaryClip(scene).speed;
  const fromSec = primaryClip(scene).trimStartSec;
  // Rentang rekaman yang benar-benar terpakai: durasi scene DIKALI kecepatan,
  // karena scene 5 detik pada 2x memakan 10 detik rekaman.
  const toSec = fromSec + (sceneDurationFrames / fps) * (speed > 0 ? speed : 1);
  return {
    words: transcriptToWordTimestamps(transcript, fromSec, toSec, { speed }),
    offsetMs: 0,
  };
};

export const buildCaptionPages = ({
  scene,
  plan,
  sceneDurationFrames,
  fps,
}: {
  scene: Scene;
  plan: ScenePlan;
  sceneDurationFrames: number;
  fps: number;
}): CaptionPageModel[] => {
  if (!scene.caption.enabled) return [];

  const { words, offsetMs } = captionWords(scene, plan, sceneDurationFrames, fps);
  if (words.length === 0) return [];

  const { pages } = createTikTokStyleCaptions({
    captions: toRemotionCaptions(words, offsetMs),
    combineTokensWithinMilliseconds: PAGE_COMBINE_MS,
  });

  const models: CaptionPageModel[] = [];
  pages.forEach((page, index) => {
    const next = pages[index + 1];
    const startFrame = Math.round((page.startMs / 1000) * fps);
    const endFrame = next
      ? Math.round((next.startMs / 1000) * fps)
      : Math.min(
          Math.round(((page.startMs + page.durationMs) / 1000) * fps) +
            LAST_PAGE_HOLD_FRAMES,
          sceneDurationFrames,
        );
    const durationInFrames = Math.min(endFrame, sceneDurationFrames) - startFrame;
    if (durationInFrames <= 0 || startFrame >= sceneDurationFrames) return;
    models.push({
      startFrame,
      durationInFrames,
      startMs: page.startMs,
      tokens: page.tokens.map((token) => ({
        text: token.text,
        fromMs: token.fromMs,
        toMs: token.toMs,
      })),
    });
  });
  return models;
};
